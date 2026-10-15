import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { ReviewModule } from '../src/components/review/review.module';
import { ReviewService } from '../src/components/review/review.service';
import { ReservationModule } from '../src/components/reservation/reservation.module';
import { Review, Reviews } from '../src/libs/dto/review/review';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { MyReservations } from '../src/libs/dto/reservation/my-reservations';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
import * as availability from '../src/libs/availability';

const fields = '_id rating content memberId trainerId programId createdAt updatedAt';
const createMutation = 'mutation($input: ReviewInput!) { createReview(input: $input) { ' + fields + ' } }';
const readQuery =
	'query($input: ReviewsInquiry!) { getReviews(input: $input) { list { ' +
	fields +
	' memberData { _id memberNick memberFullName memberImage } } metaCounter { total } averageRating } }';
const bookingsQuery =
	'query($input: ReservationsInquiry!) { getMyReservations(input: $input) { list { _id reservationStatus reviewId } metaCounter { total } } }';
interface Result {
	data?: { createReview?: Review; getReviews?: Reviews; getMyReservations?: MyReservations };
	errors?: { message: string; extensions?: { originalError?: { statusCode: number } } }[];
}
function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

// Owned loopback replica set only; deliberately no AppModule, DatabaseModule or application URI.
describe('Reviews v1 against real Nest GraphQL and disposable Mongo', () => {
	let app: INestApplication | undefined, mongo: MongoMemoryReplSet | undefined;
	let members: Model<Member>, programs: Model<Program>, reservations: Model<Reservation>, reviews: Model<Review>;
	let service: ReviewService;
	let user: Member, otherUser: Member, trainer: Member, admin: Member;
	let program: Program, otherProgram: Program;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const requestGraphQL = async (query: string, variables: object, viewer: Member | null = user): Promise<Result> => {
		const operation = request(app!.getHttpServer() as Server).post('/graphql');
		if (viewer) operation.set('Authorization', 'Bearer ' + app!.get(JwtService).sign({ sub: String(viewer._id) }));
		const response = await operation.send({ query, variables });
		expect([200, 400]).toContain(response.status);
		return response.body as Result;
	};
	const fixture = (change: Partial<Reservation> = {}) =>
		reservations.create({
			memberId: user._id,
			trainerId: trainer._id,
			programId: program._id,
			reservationDate: '2030-01-07',
			startTime: '09:00',
			endTime: '10:00',
			reservationStatus: ReservationStatus.COMPLETED,
			specialRequest: 'Private booking request',
			...change,
		});
	const create = (id: Types.ObjectId, change: object = {}, viewer: Member | null = user) =>
		requestGraphQL(
			createMutation,
			{ input: { reservationId: String(id), rating: 5, content: '  Helpful session  ', ...change } },
			viewer,
		);
	const read = (id = program._id, page = 1, limit = 10) =>
		requestGraphQL(readQuery, { input: { page, limit, search: { programId: String(id) } } }, null);
	const bookings = (period?: string, viewer: Member = user) =>
		requestGraphQL(bookingsQuery, { input: { page: 1, limit: 100, search: period ? { period } : {} } }, viewer);
	const failed = (result: Result, text?: string) => {
		expect(result.errors?.length).toBeGreaterThan(0);
		expect(result.data?.createReview).toBeFalsy();
		if (text) expect(result.errors![0].message).toContain(text);
	};
	const listed = (result: Result) => {
		expect(result.errors).toBeUndefined();
		expect(result.data?.getReviews).toBeDefined();
		return result.data!.getReviews!;
	};
	const snapshot = async () =>
		JSON.stringify(
			await Promise.all(
				[members, programs, reservations, reviews].map((model) => model.collection.find({}).sort({ _id: 1 }).toArray()),
			),
		);
	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: {
				count: 1,
				ip: '127.0.0.1',
				storageEngine: 'wiredTiger',
				dbName: 'gymflow_reviews_' + new Types.ObjectId().toHexString(),
			},
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				ReviewModule,
				ReservationModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req }: GraphQLAuthContext) => ({ req }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'isolated-review-test-key' }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		const connection = module.get<Connection>(getConnectionToken());
		members = connection.model<Member>('Member');
		programs = connection.model<Program>('Program');
		reservations = connection.model<Reservation>('Reservation');
		reviews = connection.model<Review>('Review');
		service = module.get(ReviewService);
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		if (previousDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = previousDownload;
	});
	beforeEach(async () => {
		jest.spyOn(availability, 'getSeoulDateTime').mockReturnValue({ reservationDate: '2030-01-08', time: '08:00' });
		await Promise.all([
			members.deleteMany({}),
			programs.deleteMany({}),
			reservations.deleteMany({}),
			reviews.deleteMany({}),
		]);
		[user, otherUser, trainer, admin] = await members.create([
			{
				memberNick: 'review-client',
				memberPhone: 'review-1',
				memberPassword: 'private',
				memberType: MemberType.USER,
				memberFullName: 'Client name',
				memberImage: 'client.jpg',
				memberAddress: 'Private address',
				memberDesc: 'Private profile',
			},
			{
				memberNick: 'other-review-client',
				memberPhone: 'review-2',
				memberPassword: 'private',
				memberType: MemberType.USER,
			},
			{
				memberNick: 'review-trainer',
				memberPhone: 'review-3',
				memberPassword: 'private',
				memberType: MemberType.TRAINER,
			},
			{ memberNick: 'review-admin', memberPhone: 'review-4', memberPassword: 'private', memberType: MemberType.ADMIN },
		]);
		const base = {
			memberId: trainer._id,
			programCategory: ProgramCategory.YOGA,
			programLocation: ProgramLocation.SEOUL,
			programAddress: 'Training room',
			programPrice: 0,
			programDuration: 60,
			programImages: ['program.jpg'],
			programType: ProgramType.PT_1ON1,
			programCapacity: 1,
		};
		[program, otherProgram] = await programs.create([
			{ ...base, programName: 'Reviewed program' },
			{ ...base, programName: 'Other program' },
		]);
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('exposes exact create/read signatures, narrow inputs, safe types and only additive booking state', () => {
		const schema = app!.get(GraphQLSchemaHost).schema;
		const mutation = schema.getMutationType()!.getFields().createReview;
		const query = schema.getQueryType()!.getFields().getReviews;
		expect(String(mutation.type)).toBe('Review!');
		expect(mutation.args.map((arg) => [arg.name, String(arg.type)])).toEqual([['input', 'ReviewInput!']]);
		expect(String(query.type)).toBe('Reviews!');
		expect(query.args.map((arg) => [arg.name, String(arg.type)])).toEqual([['input', 'ReviewsInquiry!']]);
		const inputs = (name: string) => (schema.getType(name) as GraphQLInputObjectType).getFields();
		expect(Object.entries(inputs('ReviewInput')).map(([name, field]) => [name, String(field.type)])).toEqual([
			['reservationId', 'String!'],
			['rating', 'Int!'],
			['content', 'String!'],
		]);
		expect(Object.keys(inputs('ReviewsInquiry')).sort()).toEqual(['limit', 'page', 'search']);
		expect(Object.keys(inputs('ReviewSearch'))).toEqual(['programId']);
		expect(String(inputs('ReviewSearch').programId.type)).toBe('String!');
		const objects = (name: string) => (schema.getType(name) as GraphQLObjectType).getFields();
		expect(Object.keys(objects('Review')).sort()).toEqual([...fields.split(' '), 'memberData'].sort());
		expect(Object.keys(objects('ReviewMemberSummary')).sort()).toEqual([
			'_id',
			'memberFullName',
			'memberImage',
			'memberNick',
		]);
		expect(Object.keys(objects('Reviews')).sort()).toEqual(['averageRating', 'list', 'metaCounter']);
		expect(String(objects('Reviews').averageRating.type)).toBe('Float');
		expect(String(objects('MyReservation').reviewId.type)).toBe('String');
		expect(objects('Reservation').reviewId).toBeUndefined();
		expect(Object.keys(schema.getMutationType()!.getFields()).filter((name) => /Review/.test(name))).toEqual([
			'createReview',
		]);
	});
	it.each([1, 5])(
		'creates rating %s, derives all IDs, trims and preserves booking/counters/timestamps',
		async (rating) => {
			const record = await fixture();
			const beforeReservation = await reservations.findById(record._id).lean();
			const beforeUser = await members.findById(user._id).lean();
			const beforeProgram = await programs.findById(program._id).lean();
			const result = await create(record._id, { rating });
			expect(result.errors).toBeUndefined();
			expect(result.data!.createReview).toMatchObject({
				rating,
				content: 'Helpful session',
				memberId: String(user._id),
				trainerId: String(trainer._id),
				programId: String(program._id),
			});
			expect(await reservations.findById(record._id).lean()).toEqual(beforeReservation);
			expect(await members.findById(user._id).lean()).toEqual({ ...beforeUser, __v: 1 });
			expect(await programs.findById(program._id).lean()).toEqual({ ...beforeProgram, __v: 1 });
			expect((await reviews.findOne().lean())!.reservationId).toEqual(record._id);
		},
	);
	it.each([
		{ rating: 0 },
		{ rating: 6 },
		{ rating: 1.5 },
		{ content: '' },
		{ content: '   ' },
		{ content: 'x'.repeat(101) },
		{ reservationId: 'bad' },
	])('rejects invalid GraphQL input %# without writes', async (change) => {
		const record = await fixture(),
			before = await snapshot();
		failed(await create(record._id, change));
		expect(await snapshot()).toBe(before);
	});
	it.each(['guest', 'trainer', 'admin', 'blocked', 'deleted', 'missing', 'changedRole'])(
		'denies %s actor',
		async (kind) => {
			const record = await fixture();
			let viewer: Member | null = user;
			if (kind === 'guest') viewer = null;
			if (kind === 'trainer') viewer = trainer;
			if (kind === 'admin') viewer = admin;
			if (kind === 'blocked' || kind === 'deleted')
				await members.updateOne(
					{ _id: user._id },
					{ memberStatus: kind === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
				);
			if (kind === 'missing') await members.deleteOne({ _id: user._id });
			if (kind === 'changedRole') await members.updateOne({ _id: user._id }, { memberType: MemberType.TRAINER });
			const before = await snapshot();
			failed(await create(record._id, {}, viewer));
			expect(await snapshot()).toBe(before);
		},
	);
	it.each([
		ReservationStatus.PENDING,
		ReservationStatus.CONFIRMED,
		ReservationStatus.CANCELLED,
		ReservationStatus.NO_SHOW,
	])('rejects %s including merely elapsed reservations', async (reservationStatus) => {
		const record = await fixture({ reservationStatus }),
			before = await snapshot();
		failed(await create(record._id), 'completed');
		expect(await snapshot()).toBe(before);
	});
	it('rejects foreign and missing reservations without revealing or changing them', async () => {
		const record = await fixture({ memberId: otherUser._id }),
			before = await snapshot();
		failed(await create(record._id), 'not found');
		failed(await create(new Types.ObjectId()), 'not found');
		expect(await snapshot()).toBe(before);
	});
	it.each(['program', 'trainer', 'ownership'])(
		'rejects missing/inconsistent parent %s with full rollback',
		async (kind) => {
			const record = await fixture();
			if (kind === 'program') await programs.deleteOne({ _id: program._id });
			if (kind === 'trainer') await members.deleteOne({ _id: trainer._id });
			if (kind === 'ownership') await programs.updateOne({ _id: program._id }, { memberId: otherUser._id });
			const before = await snapshot();
			failed(await create(record._id));
			expect(await snapshot()).toBe(before);
		},
	);
	it('does not introduce ACTIVE-parent visibility requirements or delete historical reviews', async () => {
		const record = await fixture();
		await programs.updateOne({ _id: program._id }, { programStatus: ProgramStatus.DELETE });
		await members.updateOne({ _id: trainer._id }, { memberStatus: MemberStatus.DELETE });
		expect((await create(record._id)).errors).toBeUndefined();
		await programs.deleteOne({ _id: program._id });
		await members.deleteOne({ _id: trainer._id });
		expect(listed(await read()).metaCounter).toEqual([{ total: 1 }]);
		expect(await reviews.countDocuments()).toBe(1);
	});
	it.each(['memberId', 'trainerId', 'programId'])('rejects client injection of %s', async (name) => {
		const record = await fixture(),
			before = await snapshot();
		failed(await create(record._id, { [name]: String(otherUser._id) }));
		expect(await snapshot()).toBe(before);
	});
	it('rejects sequential duplicates and rolls back all fences', async () => {
		const record = await fixture();
		expect((await create(record._id)).errors).toBeUndefined();
		const before = await snapshot();
		failed(await create(record._id), 'already has a review');
		expect(await snapshot()).toBe(before);
	});
	it('database unique index independently rejects duplicates and service translates real E11000', async () => {
		const record = await fixture();
		expect((await create(record._id)).errors).toBeUndefined();
		const stored = await reviews.findOne().lean();
		await expect(reviews.create({ ...stored, _id: new Types.ObjectId() })).rejects.toMatchObject({ code: 11000 });
		const before = await snapshot();
		// Conceal the friendly precheck once, so the real database index must arbitrate.
		jest.spyOn(reviews.collection, 'findOne').mockResolvedValueOnce(null);
		const result = await create(record._id);
		failed(result, 'already has a review');
		expect(result.errors![0].extensions?.originalError?.statusCode).toBe(409);
		expect(await snapshot()).toBe(before);
		const indexes = await reviews.collection.indexes();
		expect(indexes.find((index) => index.name === 'reservationId_1')!.unique).toBe(true);
	});
	it('parallel GraphQL duplicates persist exactly one and increment fences once', async () => {
		const record = await fixture();
		const results = await Promise.all([create(record._id), create(record._id), create(record._id)]);
		expect(results.filter((result) => result.data?.createReview)).toHaveLength(1);
		expect(results.filter((result) => result.errors)).toHaveLength(2);
		expect(await reviews.countDocuments({ reservationId: record._id })).toBe(1);
		expect((await members.collection.findOne({ _id: user._id }))!.__v).toBe(1);
		expect((await programs.collection.findOne({ _id: program._id }))!.__v).toBe(1);
	});
	it('different completed reservations for the same user/program can both be reviewed concurrently', async () => {
		const first = await fixture(),
			second = await fixture();
		const results = await Promise.all([create(first._id), create(second._id)]);
		for (const result of results) expect(result.errors).toBeUndefined();
		expect(await reviews.countDocuments()).toBe(2);
	});
	it.each(['blocked', 'deleted', 'role', 'missing'])(
		'revalidates concurrent USER %s after transaction snapshot',
		async (kind) => {
			const record = await fixture(),
				entered = barrier(),
				resume = barrier();
			const original = reservations.collection.findOne.bind(
				reservations.collection,
			) as typeof reservations.collection.findOne;
			jest
				.spyOn(reservations.collection, 'findOne')
				.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
					const result = await original(...args);
					entered.release();
					await resume.promise;
					return result;
				});
			const pending = create(record._id);
			await entered.promise;
			try {
				if (kind === 'missing') await members.deleteOne({ _id: user._id });
				else
					await members.updateOne(
						{ _id: user._id },
						kind === 'role'
							? { memberType: MemberType.TRAINER }
							: { memberStatus: kind === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
					);
			} finally {
				resume.release();
			}
			failed(await pending);
			expect(await reviews.countDocuments()).toBe(0);
			expect((await programs.collection.findOne({ _id: program._id }))!.__v).toBe(0);
		},
	);
	it.each(['program', 'trainer', 'ownership'])(
		'rejects concurrent parent %s removal/change after snapshot',
		async (kind) => {
			const record = await fixture(),
				entered = barrier(),
				resume = barrier();
			const original = reservations.collection.findOne.bind(
				reservations.collection,
			) as typeof reservations.collection.findOne;
			jest
				.spyOn(reservations.collection, 'findOne')
				.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
					const result = await original(...args);
					entered.release();
					await resume.promise;
					return result;
				});
			const pending = create(record._id);
			await entered.promise;
			try {
				if (kind === 'program') await programs.deleteOne({ _id: program._id });
				if (kind === 'trainer') await members.deleteOne({ _id: trainer._id });
				if (kind === 'ownership') await programs.updateOne({ _id: program._id }, { memberId: otherUser._id });
			} finally {
				resume.release();
			}
			failed(await pending);
			expect(await reviews.countDocuments()).toBe(0);
			expect((await members.collection.findOne({ _id: user._id }))!.__v).toBe(0);
		},
	);
	it('an aborted real review insert rolls back document and every parent/account fence', async () => {
		const record = await fixture(),
			before = await snapshot();
		const original = reviews.collection.insertOne.bind(reviews.collection) as typeof reviews.collection.insertOne;
		jest.spyOn(reviews.collection, 'insertOne').mockImplementationOnce(async (...args: Parameters<typeof original>) => {
			await original(...args);
			throw new Error('Forced review abort');
		});
		await expect(
			service.createReview(user._id, { reservationId: String(record._id), rating: 5, content: 'Valid' }),
		).rejects.toThrow('Forced review abort');
		expect(await snapshot()).toBe(before);
	});
	it('program scope, newest tie-break ordering, pagination and aggregates precede pagination', async () => {
		const created: Review[] = [];
		for (const rating of [1, 3, 5]) {
			const record = await fixture();
			expect((await create(record._id, { rating })).errors).toBeUndefined();
			created.push((await reviews.findOne({ reservationId: record._id }).lean())!);
		}
		const other = await fixture({ programId: otherProgram._id });
		expect((await create(other._id, { rating: 2 })).errors).toBeUndefined();
		await reviews.collection.updateMany(
			{ programId: program._id },
			{ $set: { createdAt: new Date('2030-01-01T00:00:00Z') } },
		);
		const expected = created
			.map((item) => String(item._id))
			.sort()
			.reverse();
		for (let page = 1; page <= 3; page++) {
			const result = listed(await read(program._id, page, 1));
			expect(result.list.map((item) => String(item._id))).toEqual([expected[page - 1]]);
			expect(result.metaCounter).toEqual([{ total: 3 }]);
			expect(result.averageRating).toBe(3);
		}
		const beyond = listed(await read(program._id, 9, 1));
		expect(beyond.list).toEqual([]);
		expect(beyond.averageRating).toBe(3);
		expect(beyond.metaCounter).toEqual([{ total: 3 }]);
		expect(listed(await read(otherProgram._id)).averageRating).toBe(2);
		const empty = listed(await read(new Types.ObjectId()));
		expect(empty).toEqual({ list: [], metaCounter: [{ total: 0 }], averageRating: null });
		// Newer timestamp takes priority over ObjectId tie break.
		await reviews.collection.updateOne(
			{ _id: created[0]._id },
			{ $set: { createdAt: new Date('2031-01-01T00:00:00Z') } },
		);
		expect(String(listed(await read()).list[0]._id)).toBe(String(created[0]._id));
	});
	it.each([
		{ page: 0 },
		{ limit: 101 },
		{ page: 1.5 },
		{ search: {} },
		{ search: { programId: 'bad' } },
		{ search: { trainerId: 'not-supported' } },
	])('rejects malformed/public non-program inquiry %#', async (change) => {
		const result = await requestGraphQL(
			readQuery,
			{ input: { page: 1, limit: 10, search: { programId: String(program._id) }, ...change } },
			null,
		);
		expect(result.errors?.length).toBeGreaterThan(0);
	});
	it('raw public aggregation and GraphQL expose only safe reviewer and Review fields', async () => {
		const record = await fixture();
		expect((await create(record._id)).errors).toBeUndefined();
		const raw = await service.getReviews({ page: 1, limit: 10, search: { programId: String(program._id) } });
		expect(Object.keys(raw.list[0]).sort()).toEqual([...fields.split(' '), 'memberData'].sort());
		expect(Object.keys(raw.list[0].memberData!).sort()).toEqual(['_id', 'memberFullName', 'memberImage', 'memberNick']);
		const result = listed(await read());
		expect(JSON.stringify(result)).not.toMatch(
			/Private|memberPhone|memberPassword|memberAddress|memberDesc|specialRequest|reservationId|__v/,
		);
		const before = await snapshot();
		const denied = await requestGraphQL(
			'query($input: ReviewsInquiry!) { getReviews(input: $input) { list { reservationId memberData { memberPhone } } } }',
			{ input: { page: 1, limit: 10, search: { programId: String(program._id) } } },
			null,
		);
		expect(denied.errors?.length).toBeGreaterThan(0);
		expect(await snapshot()).toBe(before);
		await members.deleteOne({ _id: user._id });
		expect(listed(await read()).list[0].memberData).toBeNull();
	});
	it('My Bookings returns exact owned reviewId/null while preserving Upcoming/History', async () => {
		const completed = await fixture(),
			noReview = await fixture();
		const elapsed = await fixture({ reservationStatus: ReservationStatus.CONFIRMED });
		const upcoming = await fixture({ reservationStatus: ReservationStatus.PENDING, reservationDate: '2030-01-09' });
		const foreign = await fixture({ memberId: otherUser._id });
		expect((await create(completed._id)).errors).toBeUndefined();
		expect((await create(foreign._id, {}, otherUser)).errors).toBeUndefined();
		const review = await reviews.findOne({ reservationId: completed._id }).lean();
		const result = await bookings();
		expect(result.errors).toBeUndefined();
		const list = result.data!.getMyReservations!.list;
		expect(list).toHaveLength(4);
		expect(list.find((row) => String(row._id) === String(completed._id))!.reviewId).toBe(String(review!._id));
		for (const record of [noReview, elapsed, upcoming])
			expect(list.find((row) => String(row._id) === String(record._id))!.reviewId).toBeNull();
		expect((await bookings('UPCOMING')).data!.getMyReservations!.list.map((row) => String(row._id))).toEqual([
			String(upcoming._id),
		]);
		expect((await bookings('HISTORY')).data!.getMyReservations!.metaCounter).toEqual([{ total: 3 }]);
		expect((await bookings(undefined, otherUser)).data!.getMyReservations!.list).toHaveLength(1);
	});
	it('a malformed foreign-owner Review cannot affect an owned reservation reviewId', async () => {
		const record = await fixture();
		await reviews.create({
			reservationId: record._id,
			memberId: otherUser._id,
			trainerId: trainer._id,
			programId: program._id,
			rating: 5,
			content: 'Foreign owner',
		});
		expect((await bookings()).data!.getMyReservations!.list[0].reviewId).toBeNull();
	});
});
