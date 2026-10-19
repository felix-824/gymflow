import { MongooseModuleOptions } from '@nestjs/mongoose';
import { Connection, mongo } from 'mongoose';
import AuthSessionSchema from '../schemas/AuthSession.model';
import FollowSchema from '../schemas/Follow.model';
import LikeSchema from '../schemas/Like.model';
import MemberSchema from '../schemas/Member.model';
import ProgramCreateRequestSchema from '../schemas/ProgramCreateRequest.model';
import ReviewSchema from '../schemas/Review.model';
import TrainerScheduleSchema from '../schemas/TrainerSchedule.model';
import ViewSchema from '../schemas/View.model';
import TrainerApplicationSchema from '../schemas/TrainerApplication.model';
import { isDeepStrictEqual } from 'node:util';

const operationTimeoutMS = 30000;

class MongoReadinessError extends Error {}

export function productionMongoDatabase(uri: string | undefined): string {
	if (!uri || uri === 'undefined') throw new MongoReadinessError('MONGO_PROD is required in production');
	let options: mongo.MongoClient['options'];
	try {
		if (uri !== uri.trim() || !/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error();
		// Parse with the installed driver, without connecting or exposing parser diagnostics.
		options = new mongo.MongoClient(uri).options;
	} catch {
		throw new MongoReadinessError('MONGO_PROD must be a valid MongoDB connection string');
	}
	const database = options.dbName;
	if (
		!database ||
		['admin', 'local', 'config', 'test'].includes(database.toLowerCase()) ||
		Buffer.byteLength(database) >= 64 ||
		database.includes('/') ||
		database.includes('\\') ||
		database.includes('\0') ||
		/[.\s"$*<>:|?]/.test(database)
	)
		throw new MongoReadinessError('MONGO_PROD must select an explicit usable application database');
	if (options.readPreference.mode !== 'primary' || options.writeConcern?.w === 0)
		throw new MongoReadinessError('MONGO_PROD must use primary reads and acknowledged writes for transactions');
	if (options.readConcern?.level && !['local', 'majority', 'snapshot'].includes(options.readConcern.level))
		throw new MongoReadinessError('MONGO_PROD read concern must support transactions');
	return database;
}

export const criticalMongoIndexes = [
	ProgramCreateRequestSchema,
	ReviewSchema,
	TrainerScheduleSchema,
	FollowSchema,
	LikeSchema,
	ViewSchema,
	MemberSchema,
	AuthSessionSchema,
	TrainerApplicationSchema,
].flatMap((schema) =>
	schema
		.indexes()
		.filter(([, options]) => options.unique || options.expireAfterSeconds !== undefined)
		.map(([key, options]) => ({
			collection: schema.get('collection')!,
			key: key as Record<string, 1 | -1>,
			options: {
				...(options.unique ? { unique: true } : {}),
				...(options.sparse ? { sparse: true } : {}),
				...(options.expireAfterSeconds !== undefined ? { expireAfterSeconds: options.expireAfterSeconds } : {}),
				...(options.partialFilterExpression ? { partialFilterExpression: options.partialFilterExpression } : {}),
			} satisfies mongo.CreateIndexesOptions,
		})),
);

type CriticalIndex = (typeof criticalMongoIndexes)[number];

function compatibleIndex(actual: mongo.IndexDescriptionInfo, required: CriticalIndex): boolean {
	return (
		JSON.stringify(Object.entries(actual.key)) === JSON.stringify(Object.entries(required.key)) &&
		Boolean(actual.unique) === Boolean(required.options.unique) &&
		Boolean(actual.sparse) === Boolean(required.options.sparse) &&
		actual.expireAfterSeconds === required.options.expireAfterSeconds &&
		isDeepStrictEqual(actual.partialFilterExpression, required.options.partialFilterExpression) &&
		(!actual.collation || actual.collation.locale === 'simple')
	);
}

export async function ensureCriticalMongoIndexes(connection: Connection): Promise<void> {
	if (!connection.db) throw new MongoReadinessError('MONGO_PROD connection is not ready');
	for (const required of criticalMongoIndexes) {
		const collection = connection.db.collection(required.collection);
		const label = required.collection + ' (' + Object.keys(required.key).join(', ') + ')';
		try {
			let indexes: mongo.IndexDescriptionInfo[];
			try {
				indexes = (await collection
					.listIndexes({ maxTimeMS: operationTimeoutMS })
					.toArray()) as mongo.IndexDescriptionInfo[];
			} catch (error) {
				if (!(error instanceof mongo.MongoServerError) || error.code !== 26) throw error;
				indexes = [];
			}
			const matching = indexes.filter(
				(index) => JSON.stringify(Object.entries(index.key)) === JSON.stringify(Object.entries(required.key)),
			);
			const existing = matching.find((index) => compatibleIndex(index, required));
			if (matching.length && !existing)
				throw new MongoReadinessError(
					'MONGO_PROD incompatible critical index: ' + label + '; operator action required',
				);
			// Identical createIndex is a no-op once ready, and also waits for a concurrent build.
			// Never use syncIndexes/dropIndexes: conflicting indexes and duplicate records belong to the operator.
			await collection.createIndex(required.key, {
				...required.options,
				...(existing ? { name: existing.name } : {}),
				maxTimeMS: operationTimeoutMS,
			});
			const ready = (await collection
				.listIndexes({ maxTimeMS: operationTimeoutMS })
				.toArray()) as mongo.IndexDescriptionInfo[];
			if (!ready.some((index) => compatibleIndex(index, required)))
				throw new MongoReadinessError('MONGO_PROD missing or incompatible critical index: ' + label);
		} catch (error) {
			if (error instanceof MongoReadinessError) throw error;
			throw new MongoReadinessError(
				'MONGO_PROD critical index initialization failed: ' +
					label +
					'; check duplicates, index options and permissions; operator action required',
			);
		}
	}
}

interface MongoHello {
	setName?: string;
	msg?: string;
	isWritablePrimary?: boolean;
	ismaster?: boolean;
	maxWireVersion?: number;
	logicalSessionTimeoutMinutes?: number;
	readOnly?: boolean;
}

async function verifyTransactionTopology(connection: Connection): Promise<void> {
	const admin = connection.db!.admin();
	let hello: MongoHello;
	try {
		hello = await admin.command({ hello: 1 }, { readPreference: 'primary', timeoutMS: operationTimeoutMS });
	} catch (error) {
		if (!(error instanceof mongo.MongoServerError) || error.code !== 59) throw error;
		hello = await admin.command({ isMaster: 1 }, { readPreference: 'primary', timeoutMS: operationTimeoutMS });
	}
	const router = hello.msg === 'isdbgrid';
	if (
		(!hello.setName && !router) ||
		!(hello.isWritablePrimary ?? hello.ismaster) ||
		hello.readOnly ||
		typeof hello.logicalSessionTimeoutMinutes !== 'number' ||
		hello.logicalSessionTimeoutMinutes <= 0 ||
		(hello.maxWireVersion ?? 0) < (router ? 8 : 7)
	)
		throw new MongoReadinessError(
			'MONGO_PROD requires a writable transaction-capable replica set or mongos with logical sessions',
		);
}

async function verifyReadOnlyTransaction(connection: Connection): Promise<void> {
	const session = await connection.startSession();
	try {
		session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary' });
		// No record can match: MongoDB requires _id. No business data or disposable collection is written.
		// An actual transactional command also checks FCV/storage-engine/permission support that hello cannot prove.
		await connection
			.db!.collection('programCreateRequests')
			.findOne({ _id: { $exists: false } }, { session, projection: { _id: 1 }, maxTimeMS: operationTimeoutMS });
		await session.commitTransaction();
	} catch {
		throw new MongoReadinessError(
			'MONGO_PROD read-only transaction verification failed; check transaction support and database permissions',
		);
	} finally {
		if (session.inTransaction()) await session.abortTransaction().catch(() => undefined);
		await session.endSession().catch(() => undefined);
	}
}

export async function readyProductionMongo(connection: Connection, database: string): Promise<Connection> {
	try {
		await connection.asPromise();
		if (!connection.db || connection.name !== database)
			throw new MongoReadinessError('MONGO_PROD connected database does not match the validated application database');
		await verifyTransactionTopology(connection);
		await ensureCriticalMongoIndexes(connection);
		await verifyReadOnlyTransaction(connection);
		return connection;
	} catch (error) {
		await connection.close().catch(() => undefined);
		if (error instanceof MongoReadinessError) throw error;
		throw new MongoReadinessError(
			'MONGO_PROD connection or metadata verification failed; check configuration, connectivity and permissions',
		);
	}
}

export function mongoConnectionOptions(env: NodeJS.ProcessEnv = process.env): MongooseModuleOptions {
	if (env.NODE_ENV !== 'production') return { uri: env.MONGO_DEV };
	const database = productionMongoDatabase(env.MONGO_PROD);
	return {
		uri: env.MONGO_PROD,
		autoIndex: false,
		autoCreate: false,
		// Await inside the factory so even connection failures are sanitized before Nest's retry logger sees them.
		lazyConnection: true,
		retryAttempts: 1,
		serverSelectionTimeoutMS: 10000,
		connectTimeoutMS: 10000,
		socketTimeoutMS: operationTimeoutMS,
		waitQueueTimeoutMS: operationTimeoutMS,
		connectionFactory: (connection: Connection) => readyProductionMongo(connection, database),
	};
}
