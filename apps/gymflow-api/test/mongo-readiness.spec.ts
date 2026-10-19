import { Connection, mongo } from 'mongoose';
import {
	criticalMongoIndexes,
	ensureCriticalMongoIndexes,
	mongoConnectionOptions,
	productionMongoDatabase,
	readyProductionMongo,
} from '../src/database/mongo-readiness';

const secret = 'mongodb://private-user:private-password@private-host/private-db';

function fixture(
	hello: object = { setName: 'rs', isWritablePrimary: true, maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 },
) {
	const indexes = new Map<string, mongo.IndexDescriptionInfo[]>();
	for (const required of criticalMongoIndexes) {
		const current = indexes.get(required.collection) ?? [];
		current.push({
			name: Object.keys(required.key).join('_'),
			key: required.key,
			...required.options,
		});
		indexes.set(required.collection, current);
	}
	const createIndex = jest.fn((key: Record<string, number>) => Promise.resolve(Object.keys(key).join('_')));
	const findOne = jest.fn().mockResolvedValue(null);
	const command = jest.fn<Promise<object>, [object, unknown]>().mockResolvedValue(hello);
	const session = {
		startTransaction: jest.fn(),
		commitTransaction: jest.fn().mockResolvedValue(undefined),
		inTransaction: jest.fn().mockReturnValue(false),
		abortTransaction: jest.fn().mockResolvedValue(undefined),
		endSession: jest.fn().mockResolvedValue(undefined),
	};
	const connection = {
		name: 'gymflow_prod',
		asPromise: jest.fn().mockResolvedValue(undefined),
		close: jest.fn().mockResolvedValue(undefined),
		startSession: jest.fn().mockResolvedValue(session),
		db: {
			admin: () => ({ command }),
			collection: (name: string) => ({
				listIndexes: () => ({ toArray: () => Promise.resolve(indexes.get(name) ?? []) }),
				createIndex,
				findOne,
			}),
		},
	};
	return {
		connection: connection as unknown as Connection,
		indexes,
		createIndex,
		findOne,
		command,
		session,
		raw: connection,
	};
}

describe('production Mongo configuration', () => {
	it.each([undefined, '', 'undefined'])('rejects missing production URI %s', (uri) => {
		expect(() => productionMongoDatabase(uri)).toThrow('MONGO_PROD is required');
	});
	it.each([
		'http://host/gymflow',
		'mongodb://',
		'mongodb://host:invalid/gymflow',
		' mongodb://host/gymflow',
		secret + '?unknownOption=true',
	])('sanitizes invalid URI diagnostics', (uri) => {
		try {
			productionMongoDatabase(uri);
			throw new Error('expected rejection');
		} catch (error) {
			expect((error as Error).message).toBe('MONGO_PROD must be a valid MongoDB connection string');
			expect((error as Error).stack).not.toMatch(/private-user|private-password|private-host|private-db/);
		}
	});
	it.each(['', 'test', 'admin', 'local', 'config', 'bad%2Fname', 'bad%2Ename', 'bad%00name', 'x'.repeat(64)])(
		'requires a usable intentional database: %s',
		(database) => {
			expect(() => productionMongoDatabase('mongodb://127.0.0.1/' + database)).toThrow('MONGO_PROD');
		},
	);
	it.each(['readPreference=secondary', 'w=0', 'readConcernLevel=linearizable'])(
		'rejects options incompatible with application transactions: %s',
		(options) => {
			expect(() => productionMongoDatabase('mongodb://127.0.0.1/gymflow?' + options)).toThrow('MONGO_PROD');
		},
	);
	it('accepts explicit replica-set and Atlas SRV configuration without connecting', () => {
		expect(productionMongoDatabase('mongodb://127.0.0.1/gymflow_prod?replicaSet=rs')).toBe('gymflow_prod');
		expect(
			productionMongoDatabase(
				'mongodb+srv://fixture:placeholder@cluster.example.net/gymflow_prod?retryWrites=true&w=majority',
			),
		).toBe('gymflow_prod');
	});
	it.each(['development', 'test', undefined])('preserves non-production connection behavior: %s', (mode) => {
		expect(mongoConnectionOptions({ NODE_ENV: mode, MONGO_DEV: 'mongodb://127.0.0.1/test' })).toEqual({
			uri: 'mongodb://127.0.0.1/test',
		});
	});
	it('makes production initialization and bounded sanitized connection handling explicit', () => {
		const options = mongoConnectionOptions({ NODE_ENV: 'production', MONGO_PROD: 'mongodb://127.0.0.1/gymflow_prod' });
		expect(options).toMatchObject({
			autoIndex: false,
			autoCreate: false,
			lazyConnection: true,
			retryAttempts: 1,
			serverSelectionTimeoutMS: 10000,
			socketTimeoutMS: 30000,
		});
		expect(options.connectionFactory).toBeInstanceOf(Function);
	});
});

describe('production Mongo readiness', () => {
	it('derives all ten unique/TTL contracts, including trainer application eligibility', () => {
		expect(criticalMongoIndexes.map(({ collection, key, options }) => ({ collection, key, options }))).toEqual([
			{ collection: 'programCreateRequests', key: { memberId: 1, createRequestId: 1 }, options: { unique: true } },
			{ collection: 'reviews', key: { reservationId: 1 }, options: { unique: true } },
			{ collection: 'trainerSchedules', key: { memberId: 1, dayOfWeek: 1 }, options: { unique: true } },
			{ collection: 'follows', key: { followingId: 1, followerId: 1 }, options: { unique: true } },
			{ collection: 'likes', key: { memberId: 1, likeRefId: 1, likeGroup: 1 }, options: { unique: true } },
			{ collection: 'views', key: { memberId: 1, viewRefId: 1, viewGroup: 1 }, options: { unique: true } },
			{ collection: 'members', key: { memberPhone: 1 }, options: { unique: true, sparse: true } },
			{ collection: 'members', key: { memberNick: 1 }, options: { unique: true, sparse: true } },
			{ collection: 'authSessions', key: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
			{
				collection: 'trainerApplications',
				key: { memberId: 1 },
				options: { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } } },
			},
		]);
	});
	it.each([
		{ setName: 'rs', isWritablePrimary: true, maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 },
		{ msg: 'isdbgrid', isWritablePrimary: true, maxWireVersion: 8, logicalSessionTimeoutMinutes: 30 },
	])('accepts transaction-capable topology and completes a zero-write probe', async (hello) => {
		const test = fixture(hello);
		await expect(readyProductionMongo(test.connection, 'gymflow_prod')).resolves.toBe(test.connection);
		expect(test.createIndex).toHaveBeenCalledTimes(10);
		expect(test.findOne).toHaveBeenCalledWith(
			{ _id: { $exists: false } },
			expect.objectContaining({ session: test.session, projection: { _id: 1 } }),
		);
		expect(test.session.commitTransaction).toHaveBeenCalledTimes(1);
		expect(test.session.endSession).toHaveBeenCalledTimes(1);
		expect(test.raw.close).not.toHaveBeenCalled();
	});
	it.each([
		{ isWritablePrimary: true, maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 },
		{ setName: 'rs', isWritablePrimary: false, maxWireVersion: 25, logicalSessionTimeoutMinutes: 30 },
		{ setName: 'rs', isWritablePrimary: true, maxWireVersion: 6, logicalSessionTimeoutMinutes: 30 },
		{ msg: 'isdbgrid', isWritablePrimary: true, maxWireVersion: 7, logicalSessionTimeoutMinutes: 30 },
		{ setName: 'rs', isWritablePrimary: true, maxWireVersion: 25 },
		{ setName: 'rs', isWritablePrimary: true, maxWireVersion: 25, logicalSessionTimeoutMinutes: 30, readOnly: true },
	])('rejects incompatible production topology before index or transaction commands', async (hello) => {
		const test = fixture(hello);
		await expect(readyProductionMongo(test.connection, 'gymflow_prod')).rejects.toThrow('transaction-capable');
		expect(test.createIndex).not.toHaveBeenCalled();
		expect(test.raw.startSession).not.toHaveBeenCalled();
		expect(test.raw.close).toHaveBeenCalledTimes(1);
	});
	it('uses legacy metadata only when hello is unsupported', async () => {
		const test = fixture({ setName: 'rs', ismaster: true, maxWireVersion: 8, logicalSessionTimeoutMinutes: 30 });
		test.command.mockRejectedValueOnce(new mongo.MongoServerError({ code: 59, message: secret }));
		await readyProductionMongo(test.connection, 'gymflow_prod');
		expect(test.command.mock.calls.map(([command]) => command)).toEqual([{ hello: 1 }, { isMaster: 1 }]);
	});
	it('creates missing required indexes and verifies them before continuing', async () => {
		const test = fixture();
		test.indexes.clear();
		let position = 0;
		test.createIndex.mockImplementation(() => {
			const required = criticalMongoIndexes[position++];
			const current = test.indexes.get(required.collection) ?? [];
			current.push({ name: 'owned', key: required.key, ...required.options });
			test.indexes.set(required.collection, current);
			return Promise.resolve('owned');
		});
		await ensureCriticalMongoIndexes(test.connection);
		expect(test.createIndex).toHaveBeenCalledTimes(10);
	});
	it('detects an index still missing after initialization instead of declaring readiness', async () => {
		const test = fixture();
		test.indexes.clear();
		await expect(ensureCriticalMongoIndexes(test.connection)).rejects.toThrow('missing or incompatible critical index');
	});
	it.each([
		{ unique: false },
		{ sparse: true },
		{ partialFilterExpression: { active: true } },
		{ collation: { locale: 'en' } },
		{ expireAfterSeconds: 0 },
	])('rejects incompatible correctness options without attempting repair: %j', async (options) => {
		const test = fixture();
		Object.assign(test.indexes.get('programCreateRequests')![0], options);
		await expect(readyProductionMongo(test.connection, 'gymflow_prod')).rejects.toThrow('incompatible critical index');
		expect(test.createIndex).not.toHaveBeenCalled();
	});
	it('rejects incorrect auth-session TTL', async () => {
		const test = fixture();
		test.indexes.get('authSessions')![0].expireAfterSeconds = 60;
		await expect(readyProductionMongo(test.connection, 'gymflow_prod')).rejects.toThrow('authSessions (expiresAt)');
	});
	it.each([
		{ unique: false },
		{ partialFilterExpression: undefined },
		{ partialFilterExpression: { status: 'PENDING' } },
		{ partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED', 'REJECTED'] } } },
		{ sparse: true },
		{ expireAfterSeconds: 0 },
		{ collation: { locale: 'en' } },
	])('rejects incompatible trainer application index options without replacing the index: %j', async (options) => {
		const test = fixture();
		Object.assign(test.indexes.get('trainerApplications')![0], options);
		await expect(ensureCriticalMongoIndexes(test.connection)).rejects.toThrow(
			'incompatible critical index: trainerApplications',
		);
		expect(test.createIndex.mock.calls).toHaveLength(9);
		expect(test.indexes.get('trainerApplications')).toHaveLength(1);
	});
	it('sanitizes duplicate-data errors and performs no destructive repair', async () => {
		const test = fixture();
		test.createIndex.mockRejectedValueOnce(new mongo.MongoServerError({ code: 11000, message: secret }));
		let failure: Error | undefined;
		try {
			await readyProductionMongo(test.connection, 'gymflow_prod');
		} catch (error) {
			failure = error as Error;
		}
		expect(failure?.message).toContain('operator action required');
		expect(failure?.stack).not.toContain(secret);
		expect(test.findOne).not.toHaveBeenCalled();
		expect(test.indexes.get('programCreateRequests')).toHaveLength(1);
	});
	it('rejects a database selection mismatch before metadata/index operations', async () => {
		const test = fixture();
		await expect(readyProductionMongo(test.connection, 'another_database')).rejects.toThrow('does not match');
		expect(test.command).not.toHaveBeenCalled();
	});
	it('sanitizes connection and metadata failures before Nest can log them', async () => {
		for (const phase of ['connect', 'metadata']) {
			const test = fixture();
			(phase === 'connect' ? test.raw.asPromise : test.command).mockRejectedValueOnce(new Error(secret));
			await expect(readyProductionMongo(test.connection, 'gymflow_prod')).rejects.toThrow(
				'connection or metadata verification failed',
			);
			expect(test.raw.close).toHaveBeenCalledTimes(1);
		}
	});
	it('fails safely when topology advertises sessions but an actual transaction fails', async () => {
		const test = fixture();
		test.findOne.mockRejectedValueOnce(new Error(secret));
		test.session.inTransaction.mockReturnValue(true);
		await expect(readyProductionMongo(test.connection, 'gymflow_prod')).rejects.toThrow(
			'read-only transaction verification failed',
		);
		expect(test.session.abortTransaction).toHaveBeenCalledTimes(1);
		expect(test.session.endSession).toHaveBeenCalledTimes(1);
		expect(test.session.commitTransaction).not.toHaveBeenCalled();
	});
});
