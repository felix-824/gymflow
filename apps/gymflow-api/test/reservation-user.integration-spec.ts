import { fixtureAccessToken } from './auth-session.fixture';
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
import { ReservationModule } from '../src/components/reservation/reservation.module';
import { ReservationUserService } from '../src/components/reservation/reservation-user.service';
import { AvailabilityModule } from '../src/components/availability/availability.module';
import { MyReservations } from '../src/libs/dto/reservation/my-reservations';
import { ReservationSearch } from '../src/libs/dto/reservation/reservation.inquiry';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { TrainerSchedule } from '../src/libs/dto/trainer-schedule/trainer-schedule';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { ReservationPeriod } from '../src/libs/enums/reservation-query.enum';
import { trainerScheduleWeekdays } from '../src/libs/enums/trainer-schedule.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
import * as availability from '../src/libs/availability';

const date = '2030-01-08';
const realSeoulDateTime = availability.getSeoulDateTime;
const reservationFields =
	'_id memberId trainerId programId reservationDate startTime endTime reservationStatus specialRequest createdAt updatedAt';
const readQuery =
	'query($input: ReservationsInquiry!) { getMyReservations(input: $input) { list { ' +
	reservationFields +
	' programData { _id programName programImages programType programLocation programAddress } trainerData { _id memberFullName memberNick memberImage } } metaCounter { total } } }';
const cancelMutation =
	'mutation($reservationId: String!) { cancelReservation(reservationId: $reservationId) { ' +
	reservationFields +
	' } }';
const createMutation =
	'mutation($input: ReservationInput!) { createReservation(input: $input) { ' + reservationFields + ' } }';
interface Result {
	data?: {
		getMyReservations?: MyReservations;
		cancelReservation?: Reservation;
		createReservation?: Reservation;
		getProgramAvailability?: { startTime: string; endTime: string }[];
	};
	errors?: { message: string }[];
}
function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

// Every write uses an owned disposable loopback replica set; no AppModule, DatabaseModule or application URI.
describe('USER reservation read/cancel against real disposable GraphQL and MongoDB', () => {
	let mongo: MongoMemoryReplSet | undefined, app: INestApplication | undefined;
	let members: Model<Member>,
		programs: Model<Program>,
		schedules: Model<TrainerSchedule>,
		reservations: Model<Reservation>;
	let service: ReservationUserService;
	let user: Member, otherUser: Member, thirdUser: Member, trainer: Member, otherTrainer: Member, admin: Member;
	let pt: Program, group: Program, otherPt: Program;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const requestGraphQL = async (query: string, variables: object, viewer: Member | null = user): Promise<Result> => {
		const operation = request(app!.getHttpServer() as Server).post('/graphql').set('Apollo-Require-Preflight', 'true');
		if (viewer)
			operation.set('Authorization', 'Bearer ' + (await fixtureAccessToken(viewer, app)));
		const response = await operation.send({ query, variables });
		expect([200, 400]).toContain(response.status);
		return response.body as Result;
	};
	const read = (search: ReservationSearch = {}, page = 1, limit = 10, viewer: Member | null = user) =>
		requestGraphQL(readQuery, { input: { page, limit, search } }, viewer);
	const list = (result: Result) => {
		expect(result.errors).toBeUndefined();
		expect(result.data?.getMyReservations).toBeDefined();
		return result.data!.getMyReservations!;
	};
	const cancel = (id: Types.ObjectId | string, viewer: Member | null = user) =>
		requestGraphQL(cancelMutation, { reservationId: String(id) }, viewer);
	const create = (program = pt, viewer: Member = otherUser) =>
		requestGraphQL(
			createMutation,
			{ input: { programId: String(program._id), reservationDate: date, startTime: '09:00' } },
			viewer,
		);
	const failed = (result: Result, text?: string) => {
		expect(result.errors?.length).toBeGreaterThan(0);
		if (text) expect(result.errors!.map((error) => error.message).join(' ')).toContain(text);
	};
	const fixture = (change: Partial<Reservation> = {}) =>
		reservations.create({
			memberId: user._id,
			trainerId: trainer._id,
			programId: pt._id,
			reservationDate: date,
			startTime: '09:00',
			endTime: '10:00',
			reservationStatus: ReservationStatus.PENDING,
			specialRequest: 'Keep this text',
			...change,
		});
	const snapshot = async () =>
		JSON.stringify(
			await Promise.all(
				[members, programs, schedules, reservations].map((model) =>
					model.collection.find({}).sort({ _id: 1 }).toArray(),
				),
			),
		);
	const slots = async (program = pt) => {
		const result = await requestGraphQL(
			'query($input: ProgramAvailabilityInquiry!) { getProgramAvailability(input: $input) { startTime endTime } }',
			{ input: { programId: String(program._id), reservationDate: date } },
			null,
		);
		expect(result.errors).toBeUndefined();
		return result.data!.getProgramAvailability!.map((slot) => slot.startTime);
	};

	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: {
				count: 1,
				ip: '127.0.0.1',
				storageEngine: 'wiredTiger',
				dbName: 'gymflow_user_reservation_' + new Types.ObjectId().toHexString(),
			},
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				ReservationModule,
				AvailabilityModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req, res }: GraphQLAuthContext) => ({ req, res }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'isolated-user-reservation-test-key' }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		const connection = module.get<Connection>(getConnectionToken());
		members = connection.model<Member>('Member');
		programs = connection.model<Program>('Program');
		schedules = connection.model<TrainerSchedule>('TrainerSchedule');
		reservations = connection.model<Reservation>('Reservation');
		service = module.get(ReservationUserService);
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		if (previousDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = previousDownload;
	});
	beforeEach(async () => {
		jest.spyOn(availability, 'getSeoulDateTime').mockReturnValue({ reservationDate: '2030-01-07', time: '08:00' });
		await Promise.all([
			members.deleteMany({}),
			programs.deleteMany({}),
			schedules.deleteMany({}),
			reservations.deleteMany({}),
		]);
		[user, otherUser, thirdUser, trainer, otherTrainer, admin] = await members.create([
			{ memberNick: 'user-list', memberPhone: 'list-1', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'other-list', memberPhone: 'list-2', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'third-list', memberPhone: 'list-3', memberPassword: 'test', memberType: MemberType.USER },
			{
				memberNick: 'trainer-list',
				memberFullName: 'Actual trainer',
				memberImage: 'trainer.jpg',
				memberPhone: 'list-4',
				memberPassword: 'test',
				memberDesc: 'Private fixture description',
				memberType: MemberType.TRAINER,
			},
			{ memberNick: 'other-trainer', memberPhone: 'list-5', memberPassword: 'test', memberType: MemberType.TRAINER },
			{ memberNick: 'admin-list', memberPhone: 'list-6', memberPassword: 'test', memberType: MemberType.ADMIN },
		]);
		const base = {
			memberId: trainer._id,
			programCategory: ProgramCategory.YOGA,
			programLocation: ProgramLocation.SEOUL,
			programAddress: 'Actual fixture address',
			programPrice: 0,
			programDuration: 60,
			programImages: ['program.jpg'],
		};
		[pt, group, otherPt] = await programs.create([
			{ ...base, programName: 'User PT', programType: ProgramType.PT_1ON1, programCapacity: 1 },
			{ ...base, programName: 'User group', programType: ProgramType.GROUP_CLASS, programCapacity: 2 },
			{
				...base,
				memberId: otherTrainer._id,
				programName: 'User other PT',
				programType: ProgramType.PT_1ON1,
				programCapacity: 1,
			},
		]);
		await schedules.create(
			[trainer, otherTrainer].flatMap((owner) =>
				trainerScheduleWeekdays.map((dayOfWeek) => ({
					memberId: owner._id,
					dayOfWeek,
					isAvailable: true,
					startTime: '09:00',
					endTime: '12:00',
				})),
			),
		);
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('adds only the approved USER API and keeps frozen Reservation/create fields unchanged', () => {
		const schema = app!.get(GraphQLSchemaHost).schema;
		expect(String(schema.getQueryType()!.getFields().getMyReservations.type)).toBe('MyReservations!');
		expect(schema.getQueryType()!.getFields().getMyReservation).toBeUndefined();
		expect(String(schema.getMutationType()!.getFields().cancelReservation.type)).toBe('Reservation!');
		expect(
			schema
				.getMutationType()!
				.getFields()
				.cancelReservation.args.map((arg) => [arg.name, String(arg.type)]),
		).toEqual([['reservationId', 'String!']]);
		const fields = (schema.getType('ReservationsInquiry') as GraphQLInputObjectType).getFields();
		expect(Object.keys(fields).sort()).toEqual(['limit', 'page', 'search']);
		expect(String(fields.limit.type)).toBe('Int!');
		expect(Object.keys((schema.getType('ReservationSearch') as GraphQLInputObjectType).getFields())).toEqual([
			'reservationStatus',
			'period',
		]);
		expect(Object.keys((schema.getType('Reservation') as GraphQLObjectType).getFields()).sort()).toEqual(
			reservationFields.split(' ').sort(),
		);
		expect(Object.keys((schema.getType('ReservationInput') as GraphQLInputObjectType).getFields())).toEqual([
			'programId',
			'reservationDate',
			'startTime',
			'specialRequest',
		]);
	});
	it('lists only own records, paginates deterministically and counts before pagination without writes', async () => {
		const own: Reservation[] = [];
		for (const startTime of ['09:00', '10:00', '11:00'])
			own.push(
				await fixture({
					startTime,
					endTime: startTime === '11:00' ? '12:00' : startTime === '10:00' ? '11:00' : '10:00',
				}),
			);
		await fixture({ memberId: otherUser._id });
		const before = await snapshot();
		const first = list(await read({}, 1, 2)),
			second = list(await read({}, 2, 2)),
			beyond = list(await read({}, 3, 2));
		expect(first.list.map((item) => String(item._id))).toEqual([String(own[2]._id), String(own[1]._id)]);
		expect(second.list.map((item) => String(item._id))).toEqual([String(own[0]._id)]);
		expect(first.metaCounter).toEqual([{ total: 3 }]);
		expect(beyond.list).toEqual([]);
		expect(beyond.metaCounter).toEqual([{ total: 3 }]);
		expect(await snapshot()).toBe(before);
	});
	it('returns empty arrays for an empty successful list', async () => {
		expect(list(await read())).toEqual({ list: [], metaCounter: [] });
	});
	it.each(['guest', 'trainer', 'admin', 'blocked', 'deleted'])('denies %s for both operations', async (role) => {
		const record = await fixture();
		if (role === 'blocked' || role === 'deleted')
			await members.updateOne(
				{ _id: user._id },
				{ memberStatus: role === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
			);
		const viewer = role === 'guest' ? null : role === 'trainer' ? trainer : role === 'admin' ? admin : user;
		const before = await snapshot();
		failed(await read({}, 1, 10, viewer));
		failed(await cancel(record._id, viewer));
		expect(await snapshot()).toBe(before);
	});
	it.each([
		{ page: 0 },
		{ page: 1.5 },
		{ limit: 0 },
		{ limit: 101 },
		{ limit: 1.5 },
		{ search: null },
		{ search: { period: 'ALL' } },
		{ search: { reservationStatus: 'EXPIRED' } },
		{ memberId: 'client-owned' },
		{ sort: 'createdAt' },
		{ direction: 'DESC' },
	])('rejects invalid/unsupported list input %#', async (change) => {
		failed(await requestGraphQL(readQuery, { input: { page: 1, limit: 10, search: {}, ...change } }));
	});
	it.each(Object.values(ReservationStatus))('filters by %s before count', async (reservationStatus) => {
		for (const status of Object.values(ReservationStatus)) await fixture({ reservationStatus: status });
		await fixture({ memberId: otherUser._id, reservationStatus });
		const result = list(await read({ reservationStatus }));
		expect(result.list).toHaveLength(1);
		expect(result.list[0].reservationStatus).toBe(reservationStatus);
		expect(result.metaCounter).toEqual([{ total: 1 }]);
	});
	it('UPCOMING/HISTORY partition correctly, include running/end boundaries and intersect status', async () => {
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '09:30' });
		const future = await fixture({ reservationDate: '2030-01-09' });
		const running = await fixture({ reservationStatus: ReservationStatus.CONFIRMED });
		const exactEnd = await fixture({ startTime: '08:30', endTime: '09:30' });
		const overdue = await fixture({ reservationDate: '2030-01-07' });
		const cancelled = await fixture({ reservationDate: '2030-01-10', reservationStatus: ReservationStatus.CANCELLED });
		const completed = await fixture({ reservationStatus: ReservationStatus.COMPLETED });
		const noShow = await fixture({ reservationStatus: ReservationStatus.NO_SHOW });
		const before = await snapshot();
		jest.mocked(availability.getSeoulDateTime).mockClear();
		const upcoming = list(await read({ period: ReservationPeriod.UPCOMING }));
		expect(availability.getSeoulDateTime).toHaveBeenCalledTimes(1);
		expect(upcoming.list.map((item) => String(item._id))).toEqual([String(running._id), String(future._id)]);
		expect(upcoming.metaCounter).toEqual([{ total: 2 }]);
		const history = list(await read({ period: ReservationPeriod.HISTORY }));
		expect(history.list.map((item) => String(item._id)).sort()).toEqual(
			[exactEnd, overdue, cancelled, completed, noShow].map((item) => String(item._id)).sort(),
		);
		expect(history.metaCounter).toEqual([{ total: 5 }]);
		expect(
			list(await read({ period: ReservationPeriod.UPCOMING, reservationStatus: ReservationStatus.CANCELLED })).list,
		).toEqual([]);
		expect(
			list(await read({ period: ReservationPeriod.HISTORY, reservationStatus: ReservationStatus.PENDING })).metaCounter,
		).toEqual([{ total: 2 }]);
		expect(await snapshot()).toBe(before);
	});
	it('uses _id tie-breaks for descending history and ascending upcoming', async () => {
		const low = new Types.ObjectId('000000000000000000000001'),
			high = new Types.ObjectId('000000000000000000000002');
		await fixture({ _id: low });
		await fixture({ _id: high });
		expect(list(await read({ period: ReservationPeriod.UPCOMING })).list.map((item) => String(item._id))).toEqual([
			String(low),
			String(high),
		]);
		expect(list(await read()).list.map((item) => String(item._id))).toEqual([String(high), String(low)]);
		await reservations.updateMany({}, { reservationStatus: ReservationStatus.CANCELLED });
		expect(list(await read({ period: ReservationPeriod.HISTORY })).list.map((item) => String(item._id))).toEqual([
			String(high),
			String(low),
		]);
	});
	it('uses Seoul midnight, exact end and does not rewrite overdue status', async () => {
		jest.mocked(availability.getSeoulDateTime).mockReturnValue(realSeoulDateTime(new Date('2030-01-07T15:00:00Z')));
		const yesterday = await fixture({ reservationDate: '2030-01-07', startTime: '23:00', endTime: '23:59' });
		const today = await fixture({ startTime: '00:00', endTime: '01:00' });
		expect(list(await read({ period: ReservationPeriod.UPCOMING })).list.map((item) => String(item._id))).toEqual([
			String(today._id),
		]);
		expect(list(await read({ period: ReservationPeriod.HISTORY })).list.map((item) => String(item._id))).toEqual([
			String(yesterday._id),
		]);
		expect((await reservations.findById(yesterday._id).lean())!.reservationStatus).toBe(ReservationStatus.PENDING);
	});
	it.each(['program-missing', 'trainer-missing', 'program-paused', 'program-deleted', 'trainer-inactive'])(
		'retains records and totals with %s',
		async (state) => {
			await fixture();
			if (state === 'program-missing') await programs.deleteOne({ _id: pt._id });
			if (state === 'trainer-missing') await members.deleteOne({ _id: trainer._id });
			if (state === 'program-paused' || state === 'program-deleted')
				await programs.updateOne(
					{ _id: pt._id },
					{ programStatus: state === 'program-paused' ? ProgramStatus.PAUSED : ProgramStatus.DELETE },
				);
			if (state === 'trainer-inactive')
				await members.updateOne({ _id: trainer._id }, { memberStatus: MemberStatus.BLOCK });
			const result = list(await read());
			expect(result.list).toHaveLength(1);
			expect(result.metaCounter).toEqual([{ total: 1 }]);
			if (state === 'program-missing') expect(result.list[0].programData).toBeNull();
			if (state === 'trainer-missing') expect(result.list[0].trainerData).toBeNull();
		},
	);
	it('exposes only the approved current summaries, not private Member data or booking snapshots', async () => {
		await fixture();
		await programs.updateOne({ _id: pt._id }, { programName: 'Current program identity' });
		const record = list(await read()).list[0];
		expect(record.programData!.programName).toBe('Current program identity');
		expect(record.trainerData!.memberFullName).toBe('Actual trainer');
		expect(Object.keys(record.programData!).sort()).toEqual([
			'_id',
			'programAddress',
			'programImages',
			'programLocation',
			'programName',
			'programType',
		]);
		expect(Object.keys(record.trainerData!).sort()).toEqual(['_id', 'memberFullName', 'memberImage', 'memberNick']);
		const raw = (await service.getMyReservations(user._id, { page: 1, limit: 10, search: {} })).list[0];
		expect(Object.keys(raw.trainerData!).sort()).toEqual(['_id', 'memberFullName', 'memberImage', 'memberNick']);
		const schema = app!.get(GraphQLSchemaHost).schema;
		expect(Object.keys((schema.getType('ReservationTrainerSummary') as GraphQLObjectType).getFields()).sort()).toEqual([
			'_id',
			'memberFullName',
			'memberImage',
			'memberNick',
		]);
	});
	it.each([ReservationStatus.PENDING, ReservationStatus.CONFIRMED])(
		'cancels future own %s and changes only approved metadata',
		async (reservationStatus) => {
			const record = await fixture({ reservationStatus });
			const before = await reservations.collection.findOne({ _id: record._id });
			const userBefore = await members.collection.findOne({ _id: user._id }),
				trainerBefore = await members.collection.findOne({ _id: trainer._id });
			const programsBefore = await programs.collection.find({}).toArray(),
				schedulesBefore = await schedules.collection.find({}).toArray();
			const result = await cancel(record._id);
			expect(result.errors).toBeUndefined();
			expect(result.data!.cancelReservation!.reservationStatus).toBe(ReservationStatus.CANCELLED);
			const after = await reservations.collection.findOne({ _id: record._id });
			expect(after!.updatedAt).toBeInstanceOf(Date);
			expect(after).toEqual({
				...before,
				reservationStatus: ReservationStatus.CANCELLED,
				updatedAt: after!.updatedAt as Date,
			});
			expect(await members.collection.findOne({ _id: user._id })).toEqual({
				...userBefore,
				__v: Number(userBefore!.__v) + 1,
			});
			expect(await members.collection.findOne({ _id: trainer._id })).toEqual({
				...trainerBefore,
				__v: Number(trainerBefore!.__v) + 1,
			});
			expect(await programs.collection.find({}).toArray()).toEqual(programsBefore);
			expect(await schedules.collection.find({}).toArray()).toEqual(schedulesBefore);
		},
	);
	it.each([ReservationStatus.CANCELLED, ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])(
		'rejects cancellation of %s and rolls back versions',
		async (reservationStatus) => {
			const record = await fixture({ reservationStatus }),
				before = await snapshot();
			failed(await cancel(record._id), 'Only pending or confirmed');
			expect(await snapshot()).toBe(before);
		},
	);
	it.each([
		{ reservationDate: '2030-01-06' },
		{ reservationDate: '2030-01-07', startTime: '07:00', endTime: '09:00' },
		{ reservationDate: '2030-01-07', startTime: '08:00', endTime: '09:00' },
	])('rejects past/started/exact-start cancellation %#', async (change) => {
		const record = await fixture(change),
			before = await snapshot();
		failed(await cancel(record._id), 'before it starts');
		expect(await snapshot()).toBe(before);
	});
	it('rejects malformed IDs and conceals another USER reservation just like a missing ID', async () => {
		const record = await fixture({ memberId: otherUser._id }),
			before = await snapshot();
		failed(await cancel('not-an-id'), 'Invalid identifier');
		const hidden = await cancel(record._id),
			missing = await cancel(new Types.ObjectId());
		failed(hidden, 'Reservation not found');
		failed(missing, 'Reservation not found');
		expect(hidden.errors![0].message).toBe(missing.errors![0].message);
		expect(await snapshot()).toBe(before);
	});
	it.each([
		'program-paused',
		'program-deleted',
		'program-missing',
		'trainer-inactive',
		'trainer-role',
		'trainer-missing',
		'schedule-off',
	])('allows future cancellation despite %s', async (state) => {
		const record = await fixture();
		if (state === 'program-paused' || state === 'program-deleted')
			await programs.updateOne(
				{ _id: pt._id },
				{ programStatus: state === 'program-paused' ? ProgramStatus.PAUSED : ProgramStatus.DELETE },
			);
		if (state === 'program-missing') await programs.deleteOne({ _id: pt._id });
		if (state === 'trainer-inactive')
			await members.updateOne({ _id: trainer._id }, { memberStatus: MemberStatus.BLOCK });
		if (state === 'trainer-role') await members.updateOne({ _id: trainer._id }, { memberType: MemberType.USER });
		if (state === 'trainer-missing') await members.deleteOne({ _id: trainer._id });
		if (state === 'schedule-off') await schedules.updateMany({}, { isAvailable: false });
		const result = await cancel(record._id);
		expect(result.errors).toBeUndefined();
		expect(result.data!.cancelReservation!.reservationStatus).toBe(ReservationStatus.CANCELLED);
	});
	it('revalidates the USER current role inside the protected service', async () => {
		const record = await fixture();
		await members.updateOne({ _id: user._id }, { memberType: MemberType.TRAINER });
		const before = await snapshot();
		await expect(service.cancelReservation(user._id, record._id)).rejects.toThrow('active USER');
		expect(await snapshot()).toBe(before);
	});
	it('double concurrent cancel: exactly one succeeds', async () => {
		const record = await fixture();
		const results = await Promise.all([cancel(record._id), cancel(record._id)]);
		expect(results.filter((result) => result.data?.cancelReservation)).toHaveLength(1);
		expect(results.filter((result) => result.errors)).toHaveLength(1);
		expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(ReservationStatus.CANCELLED);
		expect((await members.collection.findOne({ _id: user._id }))!.__v).toBe(1);
	});
	it.each([ProgramType.PT_1ON1, ProgramType.GROUP_CLASS])('create/cancel race preserves %s capacity', async (type) => {
		const program = type === ProgramType.PT_1ON1 ? pt : group;
		const record = await fixture({ programId: program._id });
		if (type === ProgramType.GROUP_CLASS) await fixture({ programId: program._id, memberId: thirdUser._id });
		const [cancelled, created] = await Promise.all([cancel(record._id), create(program)]);
		expect(cancelled.errors).toBeUndefined();
		if (created.errors) expect((await create(program)).errors).toBeUndefined();
		const count = await reservations.countDocuments({
			programId: program._id,
			reservationStatus: { $in: availability.capacityOccupyingStatuses },
		});
		expect(count).toBe(type === ProgramType.PT_1ON1 ? 1 : 2);
	});
	it('PT cancellation frees public availability and a new USER can book', async () => {
		const record = await fixture();
		expect(await slots()).not.toContain('09:00');
		expect((await cancel(record._id)).errors).toBeUndefined();
		expect(await slots()).toContain('09:00');
		expect((await create()).errors).toBeUndefined();
	});
	it('GROUP cancellation frees one seat without any counter changes', async () => {
		const record = await fixture({ programId: group._id });
		await fixture({ programId: group._id, memberId: otherUser._id });
		expect(await slots(group)).not.toContain('09:00');
		expect((await cancel(record._id)).errors).toBeUndefined();
		expect(await slots(group)).toContain('09:00');
		expect((await create(group, thirdUser)).errors).toBeUndefined();
		expect(await slots(group)).not.toContain('09:00');
	});
	it('cancellation releases USER overlap across trainers', async () => {
		const record = await fixture();
		failed(await create(otherPt, user), 'overlapping');
		expect((await cancel(record._id)).errors).toBeUndefined();
		expect((await create(otherPt, user)).errors).toBeUndefined();
	});
	it('forced failure after real status update rolls back status and every contention version', async () => {
		const record = await fixture(),
			before = await snapshot();
		const original = reservations.collection.findOneAndUpdate.bind(
			reservations.collection,
		) as typeof reservations.collection.findOneAndUpdate;
		let changed = false;
		jest
			.spyOn(reservations.collection, 'findOneAndUpdate')
			.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
				await original(...args);
				changed = true;
				throw new Error('Forced cancellation abort');
			});
		await expect(service.cancelReservation(user._id, record._id)).rejects.toThrow('Forced cancellation abort');
		expect(changed).toBe(true);
		expect(await snapshot()).toBe(before);
	});
	it('a real retry crossing the start time rejects stale cancellation', async () => {
		const record = await fixture(),
			entered = barrier(),
			resume = barrier();
		const original = reservations.collection.findOneAndUpdate.bind(
			reservations.collection,
		) as typeof reservations.collection.findOneAndUpdate;
		const locks = jest.spyOn(members.collection, 'findOneAndUpdate');
		jest
			.spyOn(reservations.collection, 'findOneAndUpdate')
			.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
				entered.release();
				await resume.promise;
				return original(...args);
			});
		const pending = cancel(record._id);
		await entered.promise;
		try {
			await reservations.updateOne({ _id: record._id }, { $inc: { __v: 1 } });
			jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '09:00' });
		} finally {
			resume.release();
		}
		failed(await pending, 'before it starts');
		expect(locks.mock.calls.length).toBeGreaterThanOrEqual(4);
		expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(ReservationStatus.PENDING);
		expect((await members.collection.findOne({ _id: user._id }))!.__v).toBe(0);
		expect((await members.collection.findOne({ _id: trainer._id }))!.__v).toBe(0);
	});
});
