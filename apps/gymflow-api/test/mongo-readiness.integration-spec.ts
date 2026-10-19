import './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet, MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, createConnection, Types } from 'mongoose';
import { resolve } from 'node:path';
import { Server } from 'node:http';
import { ComponentsModule } from '../src/components/components.module';
import { ProgramService } from '../src/components/program/program.service';
import { DatabaseModule } from '../src/database/database.module';
import { criticalMongoIndexes } from '../src/database/mongo-readiness';

const environmentKeys = ['NODE_ENV', 'MONGO_PROD', 'MONGO_DEV', 'AUTH_ALLOWED_ORIGINS'] as const;
const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
function restoreEnvironment() {
	for (const key of environmentKeys) {
		if (previous[key] === undefined) delete process.env[key];
		else process.env[key] = previous[key];
	}
}

// Actual DatabaseModule/ProgramService, isolated owned MongoDB only; never import AppModule or load .env.
describe('production Mongo startup on a disposable replica set', () => {
	let mongo: MongoMemoryReplSet, raw: Connection;
	const apps: INestApplication[] = [];
	let sequence = 0;
	beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
		});
	});
	beforeEach(async () => {
		const uri = mongo.getUri('gymflow_readiness_' + ++sequence);
		process.env.NODE_ENV = 'production';
		process.env.MONGO_PROD = uri;
		process.env.MONGO_DEV = 'mongodb://127.0.0.1:1/never_selected';
		process.env.AUTH_ALLOWED_ORIGINS = 'https://fixture.example';
		raw = await createConnection(uri, { autoIndex: false, autoCreate: false }).asPromise();
	});
	afterEach(async () => {
		jest.restoreAllMocks();
		for (const app of apps.splice(0)) await app.close();
		await raw?.close();
		restoreEnvironment();
	});
	afterAll(async () => {
		await mongo?.stop();
		restoreEnvironment();
	});
	async function compile() {
		const module = await Test.createTestingModule({ imports: [DatabaseModule, ComponentsModule] }).compile();
		const app = module.createNestApplication({ logger: false });
		apps.push(app);
		return { app, module, connection: module.get<Connection>(getConnectionToken()) };
	}
	function legacy() {
		return {
			_id: new Types.ObjectId(),
			programName: 'Owned legacy fixture',
			programImages: ['kept.png'],
			__v: 17,
			createdAt: new Date('2025-01-01'),
			updatedAt: new Date('2025-02-01'),
		};
	}
	it('waits for all critical indexes and a real zero-write transaction before revision backfill', async () => {
		const missing = legacy(),
			revised = { ...legacy(), _id: new Types.ObjectId(), programRevision: 9 };
		await raw.db!.collection('programs').insertMany([missing, revised]);
		const backfill = jest.spyOn(ProgramService.prototype, 'onModuleInit');
		const { app, module, connection } = await compile();
		expect(connection.name).toBe('gymflow_readiness_' + sequence);
		expect(backfill).not.toHaveBeenCalled();
		expect(await raw.db!.collection('programs').findOne({ _id: missing._id })).toEqual(missing);
		for (const required of criticalMongoIndexes) {
			const indexes = await connection.db!.collection(required.collection).indexes();
			expect(indexes).toEqual(
				expect.arrayContaining([expect.objectContaining({ key: required.key, ...required.options })]),
			);
			expect(await connection.db!.collection(required.collection).countDocuments()).toBe(0);
		}
		// Deliberately do not build unrelated performance indexes during production startup.
		expect((await connection.db!.collection('reviews').indexes()).map((index) => index.key)).toEqual([
			{ _id: 1 },
			{ reservationId: 1 },
		]);
		expect((await connection.db!.collection('authSessions').indexes()).map((index) => index.key)).toEqual([
			{ _id: 1 },
			{ expiresAt: 1 },
		]);
		await app.init();
		expect(backfill).toHaveBeenCalledTimes(1);
		expect(await raw.db!.collection('programs').findOne({ _id: missing._id })).toEqual({
			...missing,
			programRevision: 0,
		});
		expect(await raw.db!.collection('programs').findOne({ _id: revised._id })).toEqual(revised);
		await module.get(ProgramService).onModuleInit();
		expect(await raw.db!.collection('programs').findOne({ _id: missing._id })).toEqual({
			...missing,
			programRevision: 0,
		});
		expect(await raw.db!.collection('programs').findOne({ _id: revised._id })).toEqual(revised);
		expect((app.getHttpServer() as Server).listening).toBe(false);
	});
	it('accepts structurally correct operator-named indexes without the backfill hook recreating them', async () => {
		await raw
			.db!.collection('programCreateRequests')
			.createIndex({ memberId: 1, createRequestId: 1 }, { unique: true, name: 'operator_owned_request_identity' });
		const { app } = await compile();
		await app.init();
		const indexes = await raw.db!.collection('programCreateRequests').indexes();
		expect(indexes.map((index) => index.name)).toEqual(['_id_', 'operator_owned_request_identity']);
	});
	it('supports two independent concurrent startup contexts without index or backfill corruption', async () => {
		const missing = legacy(),
			revised = { ...legacy(), _id: new Types.ObjectId(), programRevision: 4 };
		await raw.db!.collection('programs').insertMany([missing, revised]);
		const [first, second] = await Promise.all([compile(), compile()]);
		expect(first.connection).not.toBe(second.connection);
		await Promise.all([first.app.init(), second.app.init()]);
		expect(await raw.db!.collection('programs').findOne({ _id: missing._id })).toEqual({
			...missing,
			programRevision: 0,
		});
		expect(await raw.db!.collection('programs').findOne({ _id: revised._id })).toEqual(revised);
		for (const required of criticalMongoIndexes) {
			const indexes = await raw.db!.collection(required.collection).indexes();
			expect(indexes.filter((index) => JSON.stringify(index.key) === JSON.stringify(required.key))).toHaveLength(1);
		}
	});
	it('fails on duplicate data without deleting records, changing indexes or running backfill', async () => {
		const reservationId = new Types.ObjectId();
		const reviews = [
			{ _id: new Types.ObjectId(), reservationId, content: 'private fixture A' },
			{ _id: new Types.ObjectId(), reservationId, content: 'private fixture B' },
		];
		const missing = legacy();
		await raw.db!.collection('reviews').insertMany(reviews);
		await raw.db!.collection('programs').insertOne(missing);
		const backfill = jest.spyOn(ProgramService.prototype, 'onModuleInit');
		const logging = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		await expect(compile()).rejects.toThrow('reviews (reservationId)');
		expect(backfill).not.toHaveBeenCalled();
		expect(await raw.db!.collection('reviews').find().toArray()).toEqual(reviews);
		expect((await raw.db!.collection('reviews').indexes()).map((index) => index.key)).toEqual([{ _id: 1 }]);
		expect(await raw.db!.collection('programs').findOne({ _id: missing._id })).toEqual(missing);
		const logs = JSON.stringify(logging.mock.calls);
		expect(logs).not.toContain(reservationId.toHexString());
		expect(logs).not.toContain('private fixture');
		expect(logs).not.toContain(process.env.MONGO_PROD);
	});
	it('leaves an incompatible nonunique index and its documents unchanged and fails startup', async () => {
		const requests = raw.db!.collection('programCreateRequests');
		await requests.createIndex({ memberId: 1, createRequestId: 1 });
		const record = { _id: new Types.ObjectId(), memberId: new Types.ObjectId(), createRequestId: 'owned' };
		await requests.insertOne(record);
		const before = await requests.indexes();
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		await expect(compile()).rejects.toThrow('incompatible critical index');
		expect(await requests.indexes()).toEqual(before);
		expect(await requests.find().toArray()).toEqual([record]);
	});
	it('creates the application partial unique index and enforces combined PENDING/APPROVED uniqueness', async () => {
		await compile();
		const applications = raw.db!.collection('trainerApplications');
		const memberId = new Types.ObjectId();
		await applications.insertMany([
			{ memberId, status: 'REJECTED' },
			{ memberId, status: 'REJECTED' },
		]);
		const pending = await applications.insertOne({ memberId, status: 'PENDING' });
		await expect(applications.insertOne({ memberId, status: 'PENDING' })).rejects.toMatchObject({ code: 11000 });
		await expect(applications.insertOne({ memberId, status: 'APPROVED' })).rejects.toMatchObject({ code: 11000 });
		await applications.deleteOne({ _id: pending.insertedId });
		await applications.insertOne({ memberId, status: 'APPROVED' });
		await expect(applications.insertOne({ memberId, status: 'PENDING' })).rejects.toMatchObject({ code: 11000 });
		await expect(applications.insertOne({ memberId, status: 'APPROVED' })).rejects.toMatchObject({ code: 11000 });
		expect(await applications.countDocuments({ memberId, status: 'REJECTED' })).toBe(2);
	});
	it.each([
		{ unique: false, partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } } },
		{ unique: true },
		{ unique: true, partialFilterExpression: { status: 'PENDING' } },
		{ unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED', 'REJECTED'] } } },
		{ unique: true, sparse: true },
		{
			unique: true,
			collation: { locale: 'en' },
			partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } },
		},
	])('fails startup without repairing incompatible application index %j', async (options) => {
		const applications = raw.db!.collection('trainerApplications');
		await applications.createIndex({ memberId: 1 }, options);
		const record = {
			_id: new Types.ObjectId(),
			memberId: new Types.ObjectId(),
			status: 'PENDING',
			bio: 'private fixture',
		};
		await applications.insertOne(record);
		const before = await applications.indexes();
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		await expect(compile()).rejects.toThrow('incompatible critical index: trainerApplications');
		expect(await applications.indexes()).toEqual(before);
		expect(await applications.find().toArray()).toEqual([record]);
	});
	it('fails on duplicate eligible applications without deleting history or repairing indexes', async () => {
		const applications = raw.db!.collection('trainerApplications');
		const memberId = new Types.ObjectId();
		const records = [
			{ _id: new Types.ObjectId(), memberId, status: 'PENDING' },
			{ _id: new Types.ObjectId(), memberId, status: 'APPROVED' },
			{ _id: new Types.ObjectId(), memberId, status: 'REJECTED' },
		];
		await applications.insertMany(records);
		jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		await expect(compile()).rejects.toThrow('critical index initialization failed: trainerApplications');
		expect(await applications.find().toArray()).toEqual(records);
		expect((await applications.indexes()).map((index) => index.key)).toEqual([{ _id: 1 }]);
	});
});

describe('standalone Mongo startup compatibility', () => {
	let mongo: MongoMemoryServer;
	beforeAll(async () => {
		mongo = await MongoMemoryServer.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			instance: { ip: '127.0.0.1', storageEngine: 'wiredTiger', dbName: 'gymflow_standalone_owned' },
		});
	});
	afterEach(() => {
		jest.restoreAllMocks();
		restoreEnvironment();
	});
	afterAll(async () => {
		await mongo?.stop();
		restoreEnvironment();
	});
	it('rejects actual standalone production startup with sanitized logs', async () => {
		process.env.NODE_ENV = 'production';
		process.env.MONGO_PROD = mongo.getUri('gymflow_standalone_owned');
		const logging = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		await expect(Test.createTestingModule({ imports: [DatabaseModule] }).compile()).rejects.toThrow(
			'transaction-capable replica set or mongos',
		);
		expect(JSON.stringify(logging.mock.calls)).not.toContain(process.env.MONGO_PROD);
	});
	it.each(['development', 'test'])('retains existing standalone %s behavior', async (mode) => {
		process.env.NODE_ENV = mode;
		process.env.MONGO_DEV = mongo.getUri('gymflow_standalone_owned');
		delete process.env.MONGO_PROD;
		const module = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();
		try {
			expect(module.get<Connection>(getConnectionToken()).readyState).toBe(1);
		} finally {
			await module.close();
		}
	});
	it('sanitizes real connection failure before the Nest retry logger receives it', async () => {
		process.env.NODE_ENV = 'production';
		process.env.MONGO_PROD = 'mongodb://private-user:private-password@127.0.0.1:1/gymflow_owned';
		const logging = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		await expect(Test.createTestingModule({ imports: [DatabaseModule] }).compile()).rejects.toThrow(
			'connection or metadata verification failed',
		);
		const logs = JSON.stringify(logging.mock.calls);
		expect(logs).not.toMatch(/private-user|private-password|mongodb:\/\//);
		expect(logging).toHaveBeenCalled();
	});
});
