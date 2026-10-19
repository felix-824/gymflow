import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { resolve } from 'node:path';
import { Server } from 'node:http';
import request from 'supertest';
import { ComponentsModule } from '../src/components/components.module';
import { TrainerApplicationService } from '../src/components/trainer-application/trainer-application.service';
import { TrainerApplication } from '../src/libs/dto/trainer-application/trainer-application';
import { TrainerApplicationInput } from '../src/libs/dto/trainer-application/trainer-application.input';
import { Member } from '../src/libs/dto/member/member';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory } from '../src/libs/enums/program.enum';
import { TrainerApplicationStatus } from '../src/libs/enums/trainer-application.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
import { dependency } from './helpers';

interface Entry {
	_id: string;
	memberId: string;
	status: TrainerApplicationStatus;
	fullName: string;
	categories: ProgramCategory[];
	experienceSummary: string;
	bio: string;
	rejectionReason: string | null;
	reviewedAt: string | null;
	createdAt: string;
	updatedAt: string;
}
interface Result {
	data?: { submitTrainerApplication?: Entry; getMyTrainerApplication?: Entry | null };
	errors?: { message: string }[];
}
const fields =
	'_id memberId status fullName categories experienceSummary bio rejectionReason reviewedAt createdAt updatedAt';
const submit = 'mutation($input:TrainerApplicationInput!){submitTrainerApplication(input:$input){' + fields + '}}';
const read = '{getMyTrainerApplication{' + fields + '}}';
const input = (): TrainerApplicationInput => ({
	fullName: ' Applicant Name ',
	categories: [ProgramCategory.YOGA],
	experienceSummary: ' Five years teaching ',
	bio: ' Helping people train ',
});

// Owned loopback replica set and fixture sessions only. No AppModule, application URI or .env is loaded.
describe('Trainer applications against disposable MongoDB replica set', () => {
	let mongo: MongoMemoryReplSet, app: INestApplication, connection: Connection;
	let applications: Model<TrainerApplication>, members: Model<Member>, service: TrainerApplicationService;
	let user: Member, other: Member, trainer: Member, admin: Member;
	beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', dbName: 'trainer_application_owned' },
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				ComponentsModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req, res }: GraphQLAuthContext) => ({ req, res }),
				}),
			],
		}).compile();
		app = module.createNestApplication({ logger: false });
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
		applications = connection.model<TrainerApplication>('TrainerApplication');
		members = connection.model<Member>('Member');
		service = module.get(TrainerApplicationService);
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
	});
	afterEach(() => jest.restoreAllMocks());
	beforeEach(async () => {
		await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
		[user, other, trainer, admin] = await members.create([
			{ memberNick: 'app-user', memberPhone: 'app-1', memberPassword: 'fixture', memberType: MemberType.USER },
			{ memberNick: 'app-other', memberPhone: 'app-2', memberPassword: 'fixture', memberType: MemberType.USER },
			{ memberNick: 'app-trainer', memberPhone: 'app-3', memberPassword: 'fixture', memberType: MemberType.TRAINER },
			{ memberNick: 'app-admin', memberPhone: 'app-4', memberPassword: 'fixture', memberType: MemberType.ADMIN },
		]);
	});
	async function gql(query: string, variables: Record<string, unknown> = {}, account?: Member): Promise<Result> {
		const operation = request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true');
		if (account) operation.set('Authorization', 'Bearer ' + (await fixtureAccessToken(account, app)));
		return (await operation.send({ query, variables })).body as Result;
	}
	async function rejected(memberId = user._id, createdAt = new Date('2026-01-01')) {
		return await applications.create({
			...input(),
			memberId,
			status: TrainerApplicationStatus.REJECTED,
			rejectionReason: 'Please add experience details',
			reviewedBy: admin._id,
			reviewedAt: createdAt,
			createdAt,
		});
	}
	it('returns null initially, creates normalized owner-derived PENDING, and never promotes the applicant', async () => {
		expect((await gql(read, {}, user)).data?.getMyTrainerApplication).toBeNull();
		const response = await gql(submit, { input: input() }, user);
		expect(response.errors).toBeUndefined();
		const application = response.data!.submitTrainerApplication!;
		expect(application).toMatchObject({
			memberId: String(user._id),
			status: TrainerApplicationStatus.PENDING,
			fullName: 'Applicant Name',
			categories: [ProgramCategory.YOGA],
			experienceSummary: 'Five years teaching',
			bio: 'Helping people train',
			rejectionReason: null,
			reviewedAt: null,
		});
		expect(application._id && application.createdAt && application.updatedAt).toBeTruthy();
		expect((await gql(read, {}, user)).data?.getMyTrainerApplication).toEqual(application);
		expect((await members.findById(user._id))!.memberType).toBe(MemberType.USER);
	});
	it.each(['guest', 'BLOCK', 'DELETE', 'TRAINER', 'ADMIN', 'missing'])(
		'denies %s submission through HTTP and direct service without creating an application',
		async (kind) => {
			let actor: Member | undefined = user;
			if (kind === 'guest') actor = undefined;
			if (kind === 'TRAINER') actor = trainer;
			if (kind === 'ADMIN') actor = admin;
			if (kind === 'BLOCK' || kind === 'DELETE') await members.updateOne({ _id: user._id }, { memberStatus: kind });
			if (kind === 'missing') await members.deleteOne({ _id: user._id });
			expect((await gql(submit, { input: input() }, actor)).errors).toBeDefined();
			if (kind !== 'guest')
				await expect(service.submitTrainerApplication(actor!._id, input())).rejects.toThrow('active USER');
			expect(await applications.countDocuments({})).toBe(0);
		},
	);
	it.each([MemberStatus.BLOCK, MemberStatus.DELETE])('denies %s private reads', async (memberStatus) => {
		await rejected();
		await members.updateOne({ _id: user._id }, { memberStatus });
		expect((await gql(read, {}, user)).errors).toBeDefined();
		await expect(service.getMyTrainerApplication(user._id)).rejects.toThrow('active account');
	});
	it.each([
		{ memberStatus: MemberStatus.BLOCK },
		{ memberStatus: MemberStatus.DELETE },
		{ memberType: MemberType.TRAINER },
		{ memberType: MemberType.ADMIN },
	])('revalidates account changes after the HTTP guard has accepted the original USER: %#', async (change) => {
		jest.spyOn(applications, 'init').mockImplementationOnce(async () => {
			await members.updateOne({ _id: user._id }, change);
			return applications;
		});
		expect((await gql(submit, { input: input() }, user)).errors).toBeDefined();
		expect(await applications.countDocuments({})).toBe(0);
	});
	it('revalidates a changed database role inside submission and preserves grandfathered trainers', async () => {
		const before = await members.findById(trainer._id).lean();
		expect((await gql(read, {}, trainer)).data?.getMyTrainerApplication).toBeNull();
		expect((await gql(submit, { input: input() }, trainer)).errors).toBeDefined();
		expect(await members.findById(trainer._id).lean()).toEqual(before);
		await members.updateOne({ _id: user._id }, { memberType: MemberType.TRAINER });
		await expect(service.submitTrainerApplication(user._id, input())).rejects.toThrow('active USER');
	});
	it.each([
		{ fullName: ' ab ' },
		{ fullName: ' ' },
		{ fullName: 'a'.repeat(101) },
		{ categories: [] },
		{ categories: [ProgramCategory.YOGA, ProgramCategory.YOGA] },
		{ categories: ['OTHER'] },
		{ experienceSummary: ' ' },
		{ experienceSummary: 'a'.repeat(1001) },
		{ bio: ' ' },
		{ bio: 'a'.repeat(2001) },
		{ previousApplicationId: 'invalid' },
	])('rejects invalid input without member/application writes: %#', async (changes) => {
		const before = await members.findById(user._id).lean();
		const invalid = { ...input(), ...changes };
		expect((await gql(submit, { input: invalid }, user)).errors).toBeDefined();
		await expect(
			service.submitTrainerApplication(user._id, dependency<TrainerApplicationInput>(invalid)),
		).rejects.toThrow();
		expect(await applications.countDocuments({})).toBe(0);
		expect(await members.findById(user._id).lean()).toEqual(before);
	});
	it.each(['memberId', 'status', 'rejectionReason', 'reviewedBy', 'reviewedAt', 'createdAt', 'updatedAt', '_id'])(
		'excludes client-controlled %s from the GraphQL input',
		async (key) => {
			expect((await gql(submit, { input: { ...input(), [key]: String(other._id) } }, user)).errors).toBeDefined();
			expect(await applications.countDocuments({})).toBe(0);
		},
	);
	it('ignores server-owned fields in direct calls and derives identity from the service context', async () => {
		const application = await service.submitTrainerApplication(
			user._id,
			dependency<TrainerApplicationInput>({
				...input(),
				memberId: other._id,
				status: TrainerApplicationStatus.APPROVED,
				reviewedBy: admin._id,
				reviewedAt: new Date(),
				rejectionReason: 'injected',
				createdAt: new Date(0),
			}),
		);
		expect(application.memberId.equals(user._id)).toBe(true);
		expect(application.status).toBe(TrainerApplicationStatus.PENDING);
		expect(application.reviewedBy).toBeNull();
		expect(application.rejectionReason).toBeNull();
		expect(application.reviewedAt).toBeNull();
		expect(application.createdAt.getTime()).toBeGreaterThan(0);
	});
	it.each([TrainerApplicationStatus.PENDING, TrainerApplicationStatus.APPROVED])(
		'rejects another submission after %s',
		async (status) => {
			await applications.create({ ...input(), memberId: user._id, status });
			const before = await applications.find({}).lean();
			await expect(service.submitTrainerApplication(user._id, input())).rejects.toThrow('already exists');
			expect(await applications.find({}).lean()).toEqual(before);
		},
	);
	it('reapplies from latest rejection as a new document without changing rejected history', async () => {
		const old = await rejected();
		const before = await applications.findById(old._id).lean();
		const result = await gql(
			submit,
			{ input: { ...input(), previousApplicationId: String(old._id).toUpperCase() } },
			user,
		);
		expect(result.errors).toBeUndefined();
		expect(result.data!.submitTrainerApplication!._id).not.toBe(String(old._id));
		expect(result.data!.submitTrainerApplication!.status).toBe(TrainerApplicationStatus.PENDING);
		expect(await applications.findById(old._id).lean()).toEqual(before);
		expect(await applications.countDocuments({ memberId: user._id })).toBe(2);
		expect((await gql(read, {}, user)).data!.getMyTrainerApplication!._id).toBe(
			result.data!.submitTrainerApplication!._id,
		);
	});
	it.each(['missing', 'wrong', 'foreign', 'stale'])(
		'rejects %s reapplication predecessor and preserves records',
		async (kind) => {
			const first = await rejected();
			const latest = await rejected(user._id, new Date('2026-02-01'));
			const foreign = await rejected(other._id);
			const previousApplicationId =
				kind === 'missing'
					? undefined
					: kind === 'wrong'
						? String(new Types.ObjectId())
						: kind === 'foreign'
							? String(foreign._id)
							: String(first._id);
			const before = await applications.find({}).sort({ _id: 1 }).lean();
			await expect(service.submitTrainerApplication(user._id, { ...input(), previousApplicationId })).rejects.toThrow(
				'history changed',
			);
			expect(await applications.find({}).sort({ _id: 1 }).lean()).toEqual(before);
			expect((await service.getMyTrainerApplication(user._id))!._id.equals(latest._id)).toBe(true);
		},
	);
	it('rejects a predecessor on a first application', async () => {
		await expect(
			service.submitTrainerApplication(user._id, { ...input(), previousApplicationId: String(new Types.ObjectId()) }),
		).rejects.toThrow('history changed');
		expect(await applications.countDocuments({})).toBe(0);
	});
	it.each(['first', 'reapplication'])(
		'serializes simultaneous %s submissions into exactly one PENDING',
		async (kind) => {
			const old = kind === 'reapplication' ? await rejected() : null;
			const payload = { ...input(), ...(old ? { previousApplicationId: String(old._id) } : {}) };
			const attempts = await Promise.allSettled(
				Array.from({ length: 4 }, () => service.submitTrainerApplication(user._id, payload)),
			);
			expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
			expect(await applications.countDocuments({ memberId: user._id, status: TrainerApplicationStatus.PENDING })).toBe(
				1,
			);
			expect(await applications.countDocuments({ memberId: user._id, status: TrainerApplicationStatus.REJECTED })).toBe(
				old ? 1 : 0,
			);
		},
	);
	it('rolls back both the real applicant lock and inserted application after a transaction failure', async () => {
		const before = await members.findById(user._id).lean();
		const transaction = applications.db.transaction.bind(applications.db) as Connection['transaction'];
		jest.spyOn(applications.db, 'transaction').mockImplementationOnce((callback, options) =>
			transaction(async (session) => {
				await callback(session);
				throw new Error('Injected failure after application insert');
			}, options),
		);
		await expect(service.submitTrainerApplication(user._id, input())).rejects.toThrow('Injected failure');
		expect(await applications.countDocuments({})).toBe(0);
		expect(await members.findById(user._id).lean()).toEqual(before);
	});
	it.each([TrainerApplicationStatus.PENDING, TrainerApplicationStatus.REJECTED, TrainerApplicationStatus.APPROVED])(
		'reads own %s and never another account application',
		async (status) => {
			const application = await applications.create({ ...input(), memberId: user._id, status });
			if (status === TrainerApplicationStatus.APPROVED)
				await members.updateOne({ _id: user._id }, { memberType: MemberType.TRAINER });
			expect((await gql(read, {}, user)).data!.getMyTrainerApplication!.status).toBe(status);
			expect((await gql(read, {}, other)).data!.getMyTrainerApplication).toBeNull();
			expect(
				(await gql('{getMyTrainerApplication(memberId:"' + String(user._id) + '"){_id}}', {}, other)).errors,
			).toBeDefined();
			expect((await applications.findById(application._id))!.memberId.equals(user._id)).toBe(true);
		},
	);
	it('keeps administration and applicant data private', async () => {
		await rejected();
		expect((await gql(read)).errors).toBeDefined();
		for (const query of [
			'{getTrainerApplications{_id}}',
			'{getTrainerApplication(applicationId:"' + String(user._id) + '"){_id}}',
			'{getTrainerApplicationsByAdmin(input:{page:1,limit:10,search:{}}){list{_id}}}',
			'mutation{reviewTrainerApplication(input:{applicationId:"' + String(user._id) + '",decision:APPROVED}){_id}}',
			'{getMember(memberId:"' + String(user._id) + '"){trainerApplication{bio}}}',
			'{getMyTrainerApplication{reviewedBy}}',
		]) {
			expect((await gql(query, {}, other)).errors).toBeDefined();
		}
	});
});
