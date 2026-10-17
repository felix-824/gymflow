import { randomUUID } from 'node:crypto';
import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLInputObjectType } from 'graphql';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { ComponentsModule } from '../src/components/components.module';
import { ProgramService } from '../src/components/program/program.service';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { ProgramInput } from '../src/libs/dto/program/program.input';
import { ProgramUpdate } from '../src/libs/dto/program/program.update';
import { ProgramCategory, ProgramLocation, ProgramType } from '../src/libs/enums/program.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((done) => {
		release = done;
	});
	return { promise, release };
}

// Only the suite's owned replica set is used; no application database or media files.
describe('Program Create idempotency integrity', () => {
	let app: INestApplication, mongo: MongoMemoryReplSet, connection: Connection;
	let programs: Model<Program & { __v: number }>, members: Model<Member>;
	let service: ProgramService;
	let trainer: Member, other: Member, user: Member, admin: Member;
	const base: ProgramInput = {
		createRequestId: randomUUID(),
		programType: ProgramType.PT_1ON1,
		programCategory: ProgramCategory.MUSCLE_GAIN,
		programLocation: ProgramLocation.SEOUL,
		programName: 'Revision fixture',
		programAddress: 'Seoul studio',
		programPrice: 50000,
		programDuration: 60,
		programCapacity: 1,
		programImages: ['uploads/program/fixture.png'],
	};
	beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1', dbName: 'program_create_test' },
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri()),
				ComponentsModule,
				GraphQLModule.forRoot({
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
		programs = connection.model<Program & { __v: number }>('Program');
		members = connection.model<Member>('Member');
		service = module.get(ProgramService);
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
	});
	afterAll(async () => {
		jest.restoreAllMocks();
		await app?.close();
		await mongo?.stop();
	});
	beforeEach(async () => {
		jest.restoreAllMocks();
		await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
		[trainer, other, user, admin] = await members.create(
			['TRAINER', 'TRAINER', 'USER', 'ADMIN'].map((memberType, index) => ({
				memberType,
				memberNick: 'rev-' + index,
				memberPhone: 'rev-' + index,
				memberPassword: 'fixture-only',
			})),
		);
	});

	async function create(input = { ...base, createRequestId: randomUUID() }, viewer: Member | null = trainer) {
		let op = request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true');
		if (viewer) op = op.set('Authorization', 'Bearer ' + (await fixtureAccessToken(viewer, app)));
		return (
			await op.send({
				query: 'mutation($input:ProgramInput!){createProgram(input:$input){_id memberId programRevision programPrice}}',
				variables: { input },
			})
		).body as { data?: { createProgram: Program }; errors?: { message: string }[] };
	}
	const receiptModel = () => connection.model('ProgramCreateRequest');
	async function counts() {
		return [
			await programs.countDocuments(),
			await receiptModel().countDocuments(),
			(await members.findById(trainer._id).lean().exec())?.memberPrograms,
		];
	}
	it('requires a Create UUID only, keeps expectedRevision on Update, and creates a revision-zero Program exactly once', async () => {
		const schema = app.get(GraphQLSchemaHost).schema;
		const input = (schema.getType('ProgramInput') as GraphQLInputObjectType).getFields();
		const update = (schema.getType('ProgramUpdate') as GraphQLInputObjectType).getFields();
		expect(input.createRequestId.type.toString()).toBe('String!');
		expect(input).not.toHaveProperty('expectedRevision');
		expect(update.expectedRevision.type.toString()).toBe('Int!');
		expect(update).not.toHaveProperty('createRequestId');
		const result = await create();
		expect(result.errors).toBeUndefined();
		expect(result.data?.createProgram.programRevision).toBe(0);
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it('recovers the original committed Program after response loss, without additional writes', async () => {
		const input = { ...base, createRequestId: randomUUID() };
		const first = await create(input);
		const before = await programs.collection.findOne({ _id: new Types.ObjectId(first.data!.createProgram._id) });
		const receipt = await receiptModel().findOne().lean().exec();
		const recovered = await create(input);
		expect(recovered.data?.createProgram._id).toBe(first.data?.createProgram._id);
		expect(await programs.collection.findOne({ _id: before!._id })).toEqual(before);
		expect(await receiptModel().findOne().lean().exec()).toEqual(receipt);
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it('hashes fixed business ordering and equivalent missing optionals, ignoring metadata and UUID letter case', async () => {
		const input = { ...base, createRequestId: randomUUID() };
		const first = await create(input);
		const reordered = Object.fromEntries(Object.entries(input).reverse());
		const recovered = await service.createProgram(trainer._id, {
			...reordered,
			createRequestId: input.createRequestId.toUpperCase(),
			programDesc: null,
			memberId: other._id,
			programLikes: 999,
		} as ProgramInput);
		expect(String(recovered._id)).toBe(first.data?.createProgram._id);
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it.each(['programName', 'programPrice', 'programImages'])(
		'rejects a changed original %s without any mutation',
		async (field) => {
			const input = { ...base, createRequestId: randomUUID() };
			await create(input);
			const before = await programs.collection.find({}).toArray();
			const receipts = await receiptModel().find({}).lean().exec();
			const patch =
				field === 'programName'
					? { programName: 'Changed name' }
					: field === 'programPrice'
						? { programPrice: 60000 }
						: { programImages: ['uploads/program/another.png'] };
			expect((await create({ ...input, ...patch })).errors?.[0].message).toContain('different Program submission');
			expect(await programs.collection.find({}).toArray()).toEqual(before);
			expect(await receiptModel().find({}).lean().exec()).toEqual(receipts);
			expect(await counts()).toEqual([1, 1, 1]);
		},
	);
	it('allows another key with identical business data and scopes shared keys to different Trainers', async () => {
		const input = { ...base, createRequestId: randomUUID() };
		const first = await create(input);
		const next = await create({ ...input, createRequestId: randomUUID() });
		const foreign = await create(input, other);
		expect(new Set([first, next, foreign].map((result) => result.data!.createProgram._id)).size).toBe(3);
		expect(await counts()).toEqual([3, 3, 2]);
		expect((await members.findById(other._id).lean().exec())?.memberPrograms).toBe(1);
	});
	it('concurrent same-key requests both converge on one committed Program and one counter increment', async () => {
		const input = { ...base, createRequestId: randomUUID() },
			entered = barrier(),
			resume = barrier();
		const model = receiptModel();
		const original = model.collection.findOne.bind(model.collection) as typeof model.collection.findOne;
		let reads = 0;
		jest.spyOn(model.collection, 'findOne').mockImplementation(async (...args: Parameters<typeof original>) => {
			const result = await original(...args);
			if (++reads <= 2) {
				if (reads === 2) entered.release();
				await resume.promise;
			}
			return result;
		});
		const pending = Promise.all([create(input), create(input)]);
		await entered.promise;
		resume.release();
		const results = await pending;
		expect(results.map((result) => result.errors)).toEqual([undefined, undefined]);
		expect(results[0].data?.createProgram._id).toBe(results[1].data?.createProgram._id);
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it('validation and auth failures never consume a request key', async () => {
		const input = { ...base, createRequestId: randomUUID() };
		for (const invalid of [undefined, 'bad', '', null])
			expect((await create({ ...input, createRequestId: invalid } as unknown as ProgramInput)).errors).toBeDefined();
		expect((await create({ ...input, programCapacity: 2 })).errors).toBeDefined();
		for (const viewer of [null, user, admin]) expect((await create(input, viewer)).errors).toBeDefined();
		expect(await counts()).toEqual([0, 0, 0]);
		expect((await create(input)).errors).toBeUndefined();
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it.each(['receipt', 'program', 'counter'])('rolls back all state after an actual %s write fails', async (target) => {
		const input = { ...base, createRequestId: randomUUID() };
		const collection =
			target === 'receipt'
				? receiptModel().collection
				: target === 'program'
					? programs.collection
					: members.collection;
		if (target === 'counter') {
			const original = collection.findOneAndUpdate.bind(collection) as typeof collection.findOneAndUpdate;
			jest
				.spyOn(collection, 'findOneAndUpdate')
				.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
					await original(...args);
					throw new Error('Injected counter failure');
				});
		} else {
			const original = collection.insertOne.bind(collection) as typeof collection.insertOne;
			jest.spyOn(collection, 'insertOne').mockImplementationOnce(async (...args: Parameters<typeof original>) => {
				await original(...args);
				throw new Error('Injected write failure');
			});
		}
		await expect(service.createProgram(trainer._id, input)).rejects.toThrow('failure');
		expect(await counts()).toEqual([0, 0, 0]);
		jest.restoreAllMocks();
		await service.createProgram(trainer._id, input);
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it('recovery after a business edit returns the same identity/current revision without reverting it', async () => {
		const input = { ...base, createRequestId: randomUUID() };
		const first = await service.createProgram(trainer._id, input);
		await service.updateProgram(trainer._id, { _id: first._id, expectedRevision: 0, programPrice: 70000 });
		const recovered = await service.createProgram(trainer._id, input);
		expect([String(recovered._id), recovered.programRevision, recovered.programPrice]).toEqual([
			String(first._id),
			1,
			70000,
		]);
		expect(await counts()).toEqual([1, 1, 1]);
	});
	it.each(['soft', 'hard', 'missing'])(
		'never re-creates an original that is %s deleted/missing; receipt survives',
		async (kind) => {
			const input = { ...base, createRequestId: randomUUID() };
			const first = await service.createProgram(trainer._id, input);
			if (kind === 'missing') await programs.deleteOne({ _id: first._id });
			else {
				await service.updateProgramByAdmin({
					_id: first._id,
					expectedRevision: 0,
					programStatus: 'DELETE' as ProgramUpdate['programStatus'],
				});
				if (kind === 'hard') await service.removeProgramByAdmin(first._id);
			}
			const before = await counts();
			expect((await create(input)).errors?.[0].message).toContain('original Program is unavailable');
			expect(await counts()).toEqual(before);
			expect(await receiptModel().countDocuments()).toBe(1);
		},
	);
	it('initializes and enforces the unique compound index without TTL or name uniqueness', async () => {
		await create();
		const indexes = await receiptModel().collection.indexes();
		expect(indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: { memberId: 1, createRequestId: 1 },
					unique: true,
				}),
			]),
		);
		expect(indexes.every((index) => !('expireAfterSeconds' in index))).toBe(true);
		const receipt = await receiptModel().findOne().lean().exec();
		const { _id, ...fields } = receipt!;
		void _id;
		await expect(receiptModel().create(fields)).rejects.toMatchObject({ code: 11000 });
		expect(await counts()).toEqual([1, 1, 1]);
	});
});
