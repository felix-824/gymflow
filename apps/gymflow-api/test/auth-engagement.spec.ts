import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberService } from '../src/components/member/member.service';
import { RolesGuard } from '../src/components/auth/guards/roles.guard';
import { ProgramResolver } from '../src/components/program/program.resolver';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { LikeService } from '../src/components/like/like.service';
import { ViewService } from '../src/components/view/view.service';
import { LikeGroup } from '../src/libs/enums/like.enum';
import { ViewGroup } from '../src/libs/enums/view.enum';
import LikeSchema from '../src/schemas/Like.model';
import ViewSchema from '../src/schemas/View.model';
import { lookupAuthMemberLiked } from '../src/libs/config';
import { MemberResolver } from '../src/components/member/member.resolver';
import type { FileUpload } from 'graphql-upload';
import { uploadDirectory } from '../src/libs/upload';

import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Member } from '../src/libs/dto/member/member';
import { MemberInput } from '../src/libs/dto/member/member.input';
import { MemberSelfUpdate } from '../src/libs/dto/member/member.update';
import { dependency, query } from './helpers';
const id = new Types.ObjectId();
describe('Current-account authorization and safe member updates', () => {
	it('uses only identity claims and reloads the current account role', async () => {
		const jwt = {
			signAsync: jest.fn(),
			verifyAsync: jest.fn().mockResolvedValue({ sub: id.toHexString(), memberType: MemberType.TRAINER }),
		};
		const db = {
			findOne: jest.fn(() => query({ _id: id, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE })),
		};
		const auth = new AuthService(dependency<JwtService>(jwt), dependency(db));
		await auth.createToken(dependency<Member>({ _id: id, memberPhone: 'private', memberPassword: 'private' }));
		expect(jwt.signAsync).toHaveBeenCalledWith({ sub: id.toHexString() });
		expect((await auth.verifyToken('token')).memberType).toBe(MemberType.USER);
		expect(db.findOne).toHaveBeenCalledWith({ _id: id.toHexString(), memberStatus: MemberStatus.ACTIVE });
	});
	it('rejects missing/blocked accounts and invalid tokens', async () => {
		const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: id.toHexString() }) };
		const auth = new AuthService(dependency<JwtService>(jwt), dependency({ findOne: () => query(null) }));
		await expect(auth.verifyToken('old-token')).rejects.toThrow('active account');
		jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
		await expect(auth.verifyToken('invalid')).rejects.toThrow('active account');
	});
	it.each([MemberType.USER, MemberType.ADMIN])('denies %s at trainer-only resolver', async (role) => {
		const guard = new RolesGuard(
			new Reflector(),
			dependency({ verifyToken: () => Promise.resolve({ memberType: role }) }),
		);
		const req = { headers: { authorization: 'Bearer token' }, body: {} };
		const context = {
			getHandler: () => Object.getOwnPropertyDescriptor(ProgramResolver.prototype, 'createProgram')?.value as object,
			getClass: () => ProgramResolver,
			getArgs: () => [null, {}, { req }, {}],
			getType: () => 'graphql',
		};
		await expect(guard.canActivate(dependency<ExecutionContext>(context))).rejects.toThrow('Role not permitted');
	});
	it('allows a current TRAINER', async () => {
		const guard = new RolesGuard(
			new Reflector(),
			dependency({
				verifyToken: () => Promise.resolve({ memberType: MemberType.TRAINER }),
			}),
		);
		const req = { headers: { authorization: 'Bearer token' }, body: {} };
		await expect(
			guard.canActivate(
				dependency<ExecutionContext>({
					getHandler: () =>
						Object.getOwnPropertyDescriptor(ProgramResolver.prototype, 'createProgram')?.value as object,
					getClass: () => ProgramResolver,
					getArgs: () => [null, {}, { req }, {}],
					getType: () => 'graphql',
				}),
			),
		).resolves.toBe(true);
	});
	it('rejects public ADMIN signup before persistence', async () => {
		const create = jest.fn();
		const service = new MemberService(
			dependency({ create }),
			dependency({}),
			dependency({}),
			dependency({}),
			dependency({}),
		);
		await expect(service.signup(dependency<MemberInput>({ memberType: MemberType.ADMIN }))).rejects.toThrow(
			'Invalid signup role',
		);
		expect(create).not.toHaveBeenCalled();
	});
	it.each([MemberType.USER, MemberType.TRAINER])('permits %s signup and hashes passwords', async (memberType) => {
		const create = jest.fn().mockResolvedValue({ _id: id });
		const hashPassword = jest.fn().mockResolvedValue('hashed');
		const service = new MemberService(
			dependency({ create }),
			dependency({}),
			dependency({ hashPassword, createToken: () => Promise.resolve('token') }),
			dependency({}),
			dependency({}),
		);
		await service.signup({ memberType, memberNick: 'tester', memberPhone: '123', memberPassword: 'secret' });
		expect(create).toHaveBeenCalledWith(expect.objectContaining({ memberType, memberPassword: 'hashed' }));
	});
	it('strips role/status/identity from self update and hashes changed passwords', async () => {
		const findOneAndUpdate = jest.fn((_filter: unknown, _update: unknown) => {
			void _filter;
			void _update;
			return query({ _id: id });
		});
		const service = new MemberService(
			dependency({ findOneAndUpdate }),
			dependency({}),
			dependency({ hashPassword: () => Promise.resolve('hashed'), createToken: () => Promise.resolve('token') }),
			dependency({}),
			dependency({}),
		);
		await service.updateMember(id, {
			_id: 'other',
			memberType: MemberType.ADMIN,
			memberStatus: MemberStatus.BLOCK,
			memberPassword: 'newpass',
			memberNick: 'valid',
		} as unknown as MemberSelfUpdate);
		expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ memberPassword: 'hashed', memberNick: 'valid' });
	});
});

describe('Reusable engagement', () => {
	it.each([LikeGroup.PROGRAM, LikeGroup.MEMBER, LikeGroup.ARTICLE])('isolates %s likes by group', async (likeGroup) => {
		const db = {
			findOneAndDelete: jest.fn(() => query(null)),
			create: jest.fn(),
			exists: jest.fn(() => query({ _id: id })),
		};
		const service = new LikeService(dependency(db));
		const input = { memberId: id, likeRefId: id, likeGroup };
		await expect(service.toggleLike(input)).resolves.toBe(1);
		expect(db.findOneAndDelete).toHaveBeenCalledWith(input);
		expect(await service.checkLikeExistence(input)).toEqual([{ memberId: id, likeRefId: id, myFavorite: true }]);
		expect(db.exists).toHaveBeenCalledWith(input);
	});
	it('does not increment a counter when a concurrent like already exists', async () => {
		const service = new LikeService(
			dependency({
				findOneAndDelete: () => query(null),
				create: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 })),
			}),
		);
		await expect(service.toggleLike({ memberId: id, likeRefId: id, likeGroup: LikeGroup.PROGRAM })).resolves.toBe(0);
	});
	it('returns -1 only when an existing like was actually removed', async () => {
		const create = jest.fn();
		const service = new LikeService(dependency({ findOneAndDelete: () => query({ _id: id }), create }));
		await expect(service.toggleLike({ memberId: id, likeRefId: id, likeGroup: LikeGroup.PROGRAM })).resolves.toBe(-1);
		expect(create).not.toHaveBeenCalled();
	});
	it.each([ViewGroup.PROGRAM, ViewGroup.MEMBER, ViewGroup.ARTICLE])('records one unique %s view', async (viewGroup) => {
		const create = jest
			.fn()
			.mockResolvedValueOnce({ _id: id })
			.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }));
		const service = new ViewService(dependency({ create }));
		const input = { memberId: id, viewRefId: id, viewGroup };
		await expect(service.recordView(input)).resolves.toEqual({ _id: id });
		await expect(service.recordView(input)).resolves.toBeNull();
		expect(create).toHaveBeenCalledWith(input);
	});
	it('includes groups in schema uniqueness and aggregation lookups', () => {
		expect(LikeSchema.indexes()[0][0]).toHaveProperty('likeGroup', 1);
		expect(ViewSchema.indexes()[0][0]).toHaveProperty('viewGroup', 1);
		expect(JSON.stringify(lookupAuthMemberLiked(id, '$_id', LikeGroup.ARTICLE))).toContain('ARTICLE');
	});
	it.each(['../program', 'property', 'PROGRAM', 'program/../../outside'])(
		'rejects upload target %s before writing',
		async (target) => {
			await expect(uploadDirectory(target)).rejects.toThrow('Invalid upload target');
		},
	);
	it('awaits upload promises and propagates single/multiple stream failures', async () => {
		const resolver = new MemberResolver(dependency({}));
		const broken: FileUpload = {
			filename: 'broken.png',
			mimetype: 'image/png',
			encoding: '7bit',
			createReadStream: () => {
				throw new Error('stream failed');
			},
		};
		await expect(resolver.imageUploader(Promise.resolve(broken), 'program')).rejects.toThrow('stream failed');
		await expect(resolver.imagesUploader([Promise.resolve(broken)], 'program')).rejects.toThrow('stream failed');
	});
});
