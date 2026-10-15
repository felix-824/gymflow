import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLEnumType, GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { ReservationModule } from '../src/components/reservation/reservation.module';
import { ReservationTrainerService } from '../src/components/reservation/reservation-trainer.service';
import { AvailabilityModule } from '../src/components/availability/availability.module';
import { TrainerReservations } from '../src/libs/dto/reservation/trainer-reservations';
import { TrainerReservationSearch } from '../src/libs/dto/reservation/trainer-reservation.inquiry';
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
const statuses = Object.values(ReservationStatus);
const realSeoulDateTime = availability.getSeoulDateTime;
const reservationFields =
	'_id memberId trainerId programId reservationDate startTime endTime reservationStatus specialRequest createdAt updatedAt';
const readQuery =
	'query($input: TrainerReservationsInquiry!) { getTrainerReservations(input: $input) { list { ' +
	reservationFields +
	' programData { _id programName programImages programType programLocation programAddress } memberData { _id memberNick memberFullName memberImage } } metaCounter { total } } }';
const updateMutation =
	'mutation($input: TrainerReservationUpdate!) { updateTrainerReservation(input: $input) { ' +
	reservationFields +
	' } }';
const cancelMutation =
	'mutation($reservationId: String!) { cancelReservation(reservationId: $reservationId) { ' +
	reservationFields +
	' } }';
const createMutation =
	'mutation($input: ReservationInput!) { createReservation(input: $input) { ' + reservationFields + ' } }';
interface Result {
	data?: {
		getTrainerReservations?: TrainerReservations;
		updateTrainerReservation?: Reservation;
		cancelReservation?: Reservation;
		createReservation?: Reservation;
		getMyReservations?: { list: Reservation[]; metaCounter: { total: number }[] };
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
const legal = [
	{ from: ReservationStatus.PENDING, to: ReservationStatus.CONFIRMED, time: '08:00' },
	{ from: ReservationStatus.PENDING, to: ReservationStatus.CANCELLED, time: '08:00' },
	{ from: ReservationStatus.CONFIRMED, to: ReservationStatus.CANCELLED, time: '08:00' },
	{ from: ReservationStatus.CONFIRMED, to: ReservationStatus.COMPLETED, time: '10:00' },
	{ from: ReservationStatus.CONFIRMED, to: ReservationStatus.NO_SHOW, time: '10:00' },
];
const illegal = statuses.flatMap((from) =>
	statuses.filter((to) => !legal.some((edge) => edge.from === from && edge.to === to)).map((to) => ({ from, to })),
);

// Only this suite's owned loopback replica set is used. Never import AppModule/DatabaseModule or application URIs.
describe('TRAINER reservation lifecycle against real GraphQL and disposable replica set', () => {
	let mongo: MongoMemoryReplSet | undefined, app: INestApplication | undefined;
	let members: Model<Member>,
		programs: Model<Program>,
		schedules: Model<TrainerSchedule>,
		reservations: Model<Reservation>;
	let service: ReservationTrainerService;
	let user: Member, otherUser: Member, trainer: Member, otherTrainer: Member, admin: Member;
	let pt: Program, group: Program, otherPt: Program;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const requestGraphQL = async (query: string, variables: object, viewer: Member | null = trainer): Promise<Result> => {
		const operation = request(app!.getHttpServer() as Server).post('/graphql');
		if (viewer)
			operation.set('Authorization', 'Bearer ' + app!.get(JwtService).sign({ sub: viewer._id.toHexString() }));
		const response = await operation.send({ query, variables });
		expect([200, 400]).toContain(response.status);
		return response.body as Result;
	};
	const read = (search: TrainerReservationSearch = {}, page = 1, limit = 10, viewer: Member | null = trainer) =>
		requestGraphQL(readQuery, { input: { page, limit, search } }, viewer);
	const list = (result: Result) => {
		expect(result.errors).toBeUndefined();
		expect(result.data?.getTrainerReservations).toBeDefined();
		return result.data!.getTrainerReservations!;
	};
	const update = (id: Types.ObjectId | string, status: ReservationStatus, viewer: Member | null = trainer) =>
		requestGraphQL(updateMutation, { input: { _id: String(id), reservationStatus: status } }, viewer);
	const userCancel = (id: Types.ObjectId) => requestGraphQL(cancelMutation, { reservationId: String(id) }, user);
	const create = (program = pt, viewer: Member = otherUser) =>
		requestGraphQL(
			createMutation,
			{ input: { programId: String(program._id), reservationDate: date, startTime: '09:00' } },
			viewer,
		);
	const failed = (result: Result, message?: string) => {
		expect(result.errors?.length).toBeGreaterThan(0);
		if (message) expect(result.errors!.map((error) => error.message).join(' ')).toContain(message);
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
			specialRequest: 'Preserve this request',
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
				dbName: 'gymflow_trainer_reservation_' + new Types.ObjectId().toHexString(),
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
					context: ({ req }: GraphQLAuthContext) => ({ req }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'isolated-trainer-reservation-test-key' }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		const connection = module.get<Connection>(getConnectionToken());
		members = connection.model<Member>('Member');
		programs = connection.model<Program>('Program');
		schedules = connection.model<TrainerSchedule>('TrainerSchedule');
		reservations = connection.model<Reservation>('Reservation');
		service = module.get(ReservationTrainerService);
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		if (previousDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = previousDownload;
	});
	beforeEach(async () => {
		jest.spyOn(availability, 'getSeoulDateTime').mockReturnValue({ reservationDate: date, time: '08:00' });
		await Promise.all([
			members.deleteMany({}),
			programs.deleteMany({}),
			schedules.deleteMany({}),
			reservations.deleteMany({}),
		]);
		[user, otherUser, trainer, otherTrainer, admin] = await members.create([
			{
				memberNick: 'trainer-client',
				memberPhone: 'trainer-1',
				memberPassword: 'private',
				memberFullName: 'Actual client',
				memberImage: 'client.jpg',
				memberAddress: 'Private address',
				memberDesc: 'Private description',
				memberType: MemberType.USER,
			},
			{ memberNick: 'other-client', memberPhone: 'trainer-2', memberPassword: 'private', memberType: MemberType.USER },
			{
				memberNick: 'actor-trainer',
				memberPhone: 'trainer-3',
				memberPassword: 'private',
				memberType: MemberType.TRAINER,
			},
			{
				memberNick: 'other-trainer',
				memberPhone: 'trainer-4',
				memberPassword: 'private',
				memberType: MemberType.TRAINER,
			},
			{
				memberNick: 'admin-trainer',
				memberPhone: 'trainer-5',
				memberPassword: 'private',
				memberType: MemberType.ADMIN,
			},
		]);
		const base = {
			memberId: trainer._id,
			programCategory: ProgramCategory.YOGA,
			programLocation: ProgramLocation.SEOUL,
			programAddress: 'Training room',
			programPrice: 0,
			programDuration: 60,
			programImages: ['program.jpg'],
		};
		[pt, group, otherPt] = await programs.create([
			{ ...base, programName: 'Trainer PT', programType: ProgramType.PT_1ON1, programCapacity: 1 },
			{ ...base, programName: 'Trainer group', programType: ProgramType.GROUP_CLASS, programCapacity: 2 },
			{
				...base,
				memberId: otherTrainer._id,
				programName: 'Other PT',
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

	it('exposes exact trainer signatures, inputs, minimal summaries and unchanged USER/base contracts', () => {
		const schema = app!.get(GraphQLSchemaHost).schema;
		const query = schema.getQueryType()!.getFields().getTrainerReservations;
		const mutation = schema.getMutationType()!.getFields().updateTrainerReservation;
		expect(String(query.type)).toBe('TrainerReservations!');
		expect(query.args.map((arg) => [arg.name, String(arg.type)])).toEqual([['input', 'TrainerReservationsInquiry!']]);
		expect(String(mutation.type)).toBe('Reservation!');
		expect(mutation.args.map((arg) => [arg.name, String(arg.type)])).toEqual([['input', 'TrainerReservationUpdate!']]);
		const inputs = (name: string) => (schema.getType(name) as GraphQLInputObjectType).getFields();
		expect(Object.keys(inputs('TrainerReservationsInquiry')).sort()).toEqual(['limit', 'page', 'search']);
		expect(String(inputs('TrainerReservationsInquiry').page.type)).toBe('Int!');
		expect(String(inputs('TrainerReservationsInquiry').limit.type)).toBe('Int!');
		expect(String(inputs('TrainerReservationsInquiry').search.type)).toBe('TrainerReservationSearch!');
		expect(
			Object.entries(inputs('TrainerReservationSearch')).map(([name, field]) => [name, String(field.type)]),
		).toEqual([
			['programId', 'String'],
			['reservationStatus', 'ReservationStatus'],
			['period', 'ReservationPeriod'],
		]);
		expect(
			Object.entries(inputs('TrainerReservationUpdate')).map(([name, field]) => [name, String(field.type)]),
		).toEqual([
			['_id', 'String!'],
			['reservationStatus', 'ReservationStatus!'],
		]);
		expect(Object.keys(inputs('ReservationInput'))).toEqual([
			'programId',
			'reservationDate',
			'startTime',
			'specialRequest',
		]);
		expect(Object.keys(inputs('ReservationSearch'))).toEqual(['reservationStatus', 'period']);
		const outputs = (name: string) => (schema.getType(name) as GraphQLObjectType).getFields();
		expect(Object.keys(outputs('Reservation')).sort()).toEqual(reservationFields.split(' ').sort());
		expect(Object.keys(outputs('TrainerReservation')).sort()).toEqual(
			[...reservationFields.split(' '), 'programData', 'memberData'].sort(),
		);
		expect(String(outputs('TrainerReservation').programData.type)).toBe('ReservationProgramSummary');
		expect(String(outputs('TrainerReservation').memberData.type)).toBe('ReservationMemberSummary');
		expect(Object.keys(outputs('ReservationMemberSummary')).sort()).toEqual([
			'_id',
			'memberFullName',
			'memberImage',
			'memberNick',
		]);
		expect(String(outputs('TrainerReservations').list.type)).toBe('[TrainerReservation!]!');
		expect(String(outputs('TrainerReservations').metaCounter.type)).toBe('[TotalCounter!]');
		expect(String(schema.getQueryType()!.getFields().getMyReservations.type)).toBe('MyReservations!');
		expect(String(schema.getQueryType()!.getFields().getProgramAvailability.type)).toBe('[AvailableSlot!]!');
		expect(String(schema.getMutationType()!.getFields().createReservation.type)).toBe('Reservation!');
		expect(String(schema.getMutationType()!.getFields().cancelReservation.type)).toBe('Reservation!');
		expect((schema.getType('ReservationStatus') as GraphQLEnumType).getValues().map((value) => value.name)).toEqual(
			statuses,
		);
	});
	it.each([
		'reservationDate',
		'startTime',
		'endTime',
		'memberId',
		'trainerId',
		'programId',
		'specialRequest',
		'createdAt',
		'updatedAt',
	])('rejects client mutation field %s without writes', async (field) => {
		const record = await fixture(),
			before = await snapshot();
		failed(
			await requestGraphQL(updateMutation, {
				input: { _id: String(record._id), reservationStatus: 'CONFIRMED', [field]: 'forbidden' },
			}),
		);
		expect(await snapshot()).toBe(before);
	});
	it.each(['guest', 'user', 'admin', 'blocked', 'deleted', 'changed-role'])(
		'denies %s for both trainer operations using current account state',
		async (role) => {
			const record = await fixture();
			if (role === 'blocked' || role === 'deleted')
				await members.updateOne(
					{ _id: trainer._id },
					{ memberStatus: role === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
				);
			if (role === 'changed-role') await members.updateOne({ _id: trainer._id }, { memberType: MemberType.USER });
			const viewer = role === 'guest' ? null : role === 'user' ? user : role === 'admin' ? admin : trainer;
			const before = await snapshot();
			failed(await read({}, 1, 10, viewer));
			failed(await update(record._id, ReservationStatus.CONFIRMED, viewer));
			expect(await snapshot()).toBe(before);
		},
	);
	it.each(['invalid', 'expired'])('rejects %s JWT without writes', async (kind) => {
		await fixture();
		const before = await snapshot();
		const token =
			kind === 'invalid' ? 'invalid' : app!.get(JwtService).sign({ sub: String(trainer._id) }, { expiresIn: -1 });
		for (const [query, variables] of [
			[readQuery, { input: { page: 1, limit: 10, search: {} } }],
			[updateMutation, { input: { _id: String(new Types.ObjectId()), reservationStatus: 'CONFIRMED' } }],
		] as const) {
			const response = await request(app!.getHttpServer() as Server)
				.post('/graphql')
				.set('Authorization', 'Bearer ' + token)
				.send({ query, variables });
			failed(response.body as Result);
		}
		expect(await snapshot()).toBe(before);
	});
	it('conceals foreign reservations just like missing ones; rejects malformed IDs', async () => {
		const foreign = await fixture({ trainerId: otherTrainer._id, programId: otherPt._id }),
			before = await snapshot();
		const hidden = await update(foreign._id, ReservationStatus.CONFIRMED),
			missing = await update(new Types.ObjectId(), ReservationStatus.CONFIRMED);
		failed(hidden, 'Reservation not found');
		failed(missing, 'Reservation not found');
		expect(hidden.errors![0].message).toBe(missing.errors![0].message);
		failed(await update('not-an-id', ReservationStatus.CONFIRMED));
		expect(await snapshot()).toBe(before);
	});
	it.each([
		{ page: 0 },
		{ page: 1.5 },
		{ limit: 0 },
		{ limit: 101 },
		{ limit: 1.5 },
		{ search: null },
		{ search: { programId: 'bad' } },
		{ search: { period: 'ALL' } },
		{ search: { reservationStatus: 'EXPIRED' } },
	])('rejects malformed list input %#', async (change) => {
		await fixture();
		const before = await snapshot();
		failed(await requestGraphQL(readQuery, { input: { page: 1, limit: 10, search: {}, ...change } }));
		expect(await snapshot()).toBe(before);
	});
	it('returns empty successful lists and out-of-range pages with truthful counts', async () => {
		expect(list(await read())).toEqual({ list: [], metaCounter: [] });
		await fixture();
		expect(list(await read({}, 4, 100))).toEqual({ list: [], metaCounter: [{ total: 1 }] });
	});
	it('forces trainer ownership and sorts/paginates deterministically with no writes', async () => {
		const own = await Promise.all(
			[
				new Types.ObjectId('100000000000000000000001'),
				new Types.ObjectId('100000000000000000000002'),
				new Types.ObjectId('100000000000000000000003'),
			].map((_id) => fixture({ _id })),
		);
		await fixture({ trainerId: otherTrainer._id, programId: otherPt._id });
		const before = await snapshot();
		expect(list(await read({}, 1, 2)).list.map((item) => item._id)).toEqual([String(own[2]._id), String(own[1]._id)]);
		expect(list(await read({}, 2, 2)).list.map((item) => item._id)).toEqual([String(own[0]._id)]);
		expect(list(await read({}, 2, 2)).metaCounter).toEqual([{ total: 3 }]);
		expect(list(await read({ period: ReservationPeriod.UPCOMING }, 1, 100)).list.map((item) => item._id)).toEqual(
			own.map((item) => String(item._id)),
		);
		expect(await snapshot()).toBe(before);
	});
	it.each(statuses)('filters and counts real status %s', async (reservationStatus) => {
		for (const status of statuses) await fixture({ reservationStatus: status });
		const result = list(await read({ reservationStatus }));
		expect(result.list.map((record) => record.reservationStatus)).toEqual([reservationStatus]);
		expect(result.metaCounter).toEqual([{ total: 1 }]);
	});
	it('intersects program/status/period, and a foreign program filter reveals nothing', async () => {
		await fixture({ programId: group._id, reservationStatus: ReservationStatus.CONFIRMED });
		await fixture();
		await fixture({ programId: group._id, reservationStatus: ReservationStatus.CANCELLED });
		await fixture({ trainerId: otherTrainer._id, programId: otherPt._id });
		const filtered = list(
			await read({
				programId: String(group._id),
				reservationStatus: ReservationStatus.CONFIRMED,
				period: ReservationPeriod.UPCOMING,
			}),
		);
		expect(filtered.metaCounter).toEqual([{ total: 1 }]);
		expect(filtered.list[0].programId).toBe(String(group._id));
		expect(list(await read({ programId: String(otherPt._id) }))).toEqual({ list: [], metaCounter: [] });
		expect(list(await read({ programId: String(new Types.ObjectId()) }))).toEqual({ list: [], metaCounter: [] });
	});
	it('partitions periods at exact end, includes running sessions, and preserves overdue PENDING', async () => {
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '09:30' });
		const pending = await fixture();
		const running = await fixture({ reservationStatus: ReservationStatus.CONFIRMED });
		const ended = await fixture({ startTime: '08:30', endTime: '09:30' });
		const futureCancelled = await fixture({
			reservationDate: '2030-01-09',
			reservationStatus: ReservationStatus.CANCELLED,
		});
		for (const status of [ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])
			await fixture({ reservationStatus: status });
		const before = await snapshot();
		expect(
			list(await read({ period: ReservationPeriod.UPCOMING }))
				.list.map((record) => record._id)
				.sort(),
		).toEqual([String(pending._id), String(running._id)].sort());
		const history = list(await read({ period: ReservationPeriod.HISTORY }));
		expect(history.metaCounter).toEqual([{ total: 4 }]);
		expect(history.list.find((record) => record._id === String(ended._id))!.reservationStatus).toBe(
			ReservationStatus.PENDING,
		);
		expect(history.list.some((record) => record._id === String(futureCancelled._id))).toBe(true);
		expect(
			list(await read({ period: ReservationPeriod.HISTORY, reservationStatus: ReservationStatus.PENDING })).metaCounter,
		).toEqual([{ total: 1 }]);
		expect(await snapshot()).toBe(before);
	});
	it('uses Seoul midnight for listing and transition boundaries', async () => {
		jest.mocked(availability.getSeoulDateTime).mockReturnValue(realSeoulDateTime(new Date('2030-01-07T15:00:00Z')));
		const ended = await fixture({ reservationDate: '2030-01-07', reservationStatus: ReservationStatus.CONFIRMED });
		const atStart = await fixture({ startTime: '00:00', endTime: '01:00' });
		const future = await fixture({ startTime: '00:01', endTime: '01:01' });
		failed(await update(atStart._id, ReservationStatus.CONFIRMED));
		expect((await update(future._id, ReservationStatus.CONFIRMED)).errors).toBeUndefined();
		expect((await update(ended._id, ReservationStatus.COMPLETED)).errors).toBeUndefined();
		expect(list(await read({ period: ReservationPeriod.HISTORY })).list.map((record) => record._id)).toEqual([
			String(ended._id),
		]);
	});
	it('projects minimal client/program fields in raw aggregation and GraphQL output', async () => {
		await fixture();
		const row = list(await read()).list[0];
		expect(row.memberData).toEqual({
			_id: String(user._id),
			memberNick: user.memberNick,
			memberFullName: 'Actual client',
			memberImage: 'client.jpg',
		});
		const raw = (await service.getTrainerReservations(trainer._id, { page: 1, limit: 10, search: {} })).list[0];
		expect(Object.keys(raw.memberData!).sort()).toEqual(['_id', 'memberFullName', 'memberImage', 'memberNick']);
		expect(Object.keys(raw.programData!).sort()).toEqual([
			'_id',
			'programAddress',
			'programImages',
			'programLocation',
			'programName',
			'programType',
		]);
		expect(JSON.stringify(raw.memberData)).not.toMatch(/private|memberPhone|memberAddress|memberPassword|accessToken/i);
	});
	it('retains nullable program/client summaries without losing reservations or totals', async () => {
		const record = await fixture({ programId: new Types.ObjectId(), memberId: new Types.ObjectId() });
		const result = list(await read());
		expect(result.metaCounter).toEqual([{ total: 1 }]);
		expect(result.list[0]._id).toBe(String(record._id));
		expect(result.list[0].memberData).toBeNull();
		expect(result.list[0].programData).toBeNull();
	});
	it('excludes inconsistent existing program ownership before count and rejects mutation without writes', async () => {
		const inconsistent = await fixture({ programId: otherPt._id });
		await fixture();
		const before = await snapshot();
		expect(list(await read({}, 1, 1)).metaCounter).toEqual([{ total: 1 }]);
		failed(await update(inconsistent._id, ReservationStatus.CONFIRMED), 'ownership is inconsistent');
		expect(await snapshot()).toBe(before);
	});
	it.each(legal)(
		'persists $from -> $to and changes only status/timestamps plus contention versions',
		async ({ from, to, time }) => {
			const record = await fixture({ reservationStatus: from });
			jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time });
			const before = await reservations.collection.findOne({ _id: record._id });
			const clientBefore = await members.collection.findOne({ _id: user._id }),
				actorBefore = await members.collection.findOne({ _id: trainer._id });
			const programsBefore = await programs.collection.find({}).toArray(),
				schedulesBefore = await schedules.collection.find({}).toArray();
			const result = await update(record._id, to);
			expect(result.errors).toBeUndefined();
			expect(result.data!.updateTrainerReservation!.reservationStatus).toBe(to);
			const after = await reservations.collection.findOne({ _id: record._id });
			expect(after).toEqual({ ...before, reservationStatus: to, updatedAt: after!.updatedAt as Date });
			expect(await members.collection.findOne({ _id: user._id })).toEqual({
				...clientBefore,
				__v: Number(clientBefore!.__v) + 1,
			});
			expect(await members.collection.findOne({ _id: trainer._id })).toEqual({
				...actorBefore,
				__v: Number(actorBefore!.__v) + 1,
			});
			expect(await programs.collection.find({}).toArray()).toEqual(programsBefore);
			expect(await schedules.collection.find({}).toArray()).toEqual(schedulesBefore);
		},
	);
	it.each(illegal)('rejects $from -> $to including same/terminal states with full rollback', async ({ from, to }) => {
		const record = await fixture({ reservationStatus: from }),
			before = await snapshot();
		failed(await update(record._id, to));
		expect(await snapshot()).toBe(before);
	});
	it.each(legal.flatMap((edge) => ['09:00', '09:30', '09:59'].map((time) => ({ ...edge, time }))))(
		'rejects $from -> $to at start/running time $time',
		async ({ from, to, time }) => {
			const record = await fixture({ reservationStatus: from }),
				before = await snapshot();
			jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time });
			failed(await update(record._id, to));
			expect(await snapshot()).toBe(before);
		},
	);
	it.each(
		legal
			.filter((edge) => edge.to === ReservationStatus.COMPLETED || edge.to === ReservationStatus.NO_SHOW)
			.flatMap((edge) => ['10:00', '10:01'].map((time) => ({ ...edge, time }))),
	)('allows $to at/after end $time', async ({ from, to, time }) => {
		const record = await fixture({ reservationStatus: from });
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time });
		expect((await update(record._id, to)).errors).toBeUndefined();
	});
	it.each(['paused', 'deleted', 'missing', 'schedule-change', 'duration-change'])(
		'preserves stored intervals and lifecycle despite %s',
		async (state) => {
			const record = await fixture();
			if (state === 'paused' || state === 'deleted')
				await programs.updateOne(
					{ _id: pt._id },
					{ programStatus: state === 'paused' ? ProgramStatus.PAUSED : ProgramStatus.DELETE },
				);
			if (state === 'missing') await programs.deleteOne({ _id: pt._id });
			if (state === 'schedule-change')
				await schedules.updateMany({}, { isAvailable: false, startTime: '12:00', endTime: '13:00' });
			if (state === 'duration-change') await programs.updateOne({ _id: pt._id }, { programDuration: 30 });
			expect(list(await read()).metaCounter).toEqual([{ total: 1 }]);
			expect((await update(record._id, ReservationStatus.CONFIRMED)).errors).toBeUndefined();
			expect((await update(record._id, ReservationStatus.CANCELLED)).errors).toBeUndefined();
			const after = await reservations.findById(record._id).lean();
			expect(after).toMatchObject({
				reservationDate: date,
				startTime: '09:00',
				endTime: '10:00',
				specialRequest: 'Preserve this request',
			});
		},
	);
	it.each(
		[MemberStatus.BLOCK, MemberStatus.DELETE, 'missing'].flatMap((state) => legal.map((edge) => ({ state, ...edge }))),
	)('allows $to despite client $state', async ({ state, from, to, time }) => {
		const record = await fixture({ reservationStatus: from });
		if (state === 'missing') await members.deleteOne({ _id: user._id });
		else await members.updateOne({ _id: user._id }, { memberStatus: state });
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time });
		expect((await update(record._id, to)).errors).toBeUndefined();
	});
	it.each(['blocked', 'deleted', 'role'])('revalidates actor %s inside service transaction', async (state) => {
		const record = await fixture();
		await members.updateOne(
			{ _id: trainer._id },
			state === 'role'
				? { memberType: MemberType.USER }
				: { memberStatus: state === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
		);
		const before = await snapshot();
		await expect(
			service.updateTrainerReservation(trainer._id, {
				_id: String(record._id),
				reservationStatus: ReservationStatus.CONFIRMED,
			}),
		).rejects.toThrow('active TRAINER');
		expect(await snapshot()).toBe(before);
	});
	it.each(legal)('duplicate concurrent $from -> $to has exactly one winner', async ({ from, to, time }) => {
		const record = await fixture({ reservationStatus: from });
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time });
		const results = await Promise.all([update(record._id, to), update(record._id, to)]);
		expect(results.filter((result) => result.data?.updateTrainerReservation)).toHaveLength(1);
		expect(results.filter((result) => result.errors)).toHaveLength(1);
		expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(to);
		expect((await members.collection.findOne({ _id: trainer._id }))!.__v).toBe(1);
	});
	it('USER cancel versus trainer confirm serializes without resurrection', async () => {
		const record = await fixture();
		const [confirmed, cancelled] = await Promise.all([
			update(record._id, ReservationStatus.CONFIRMED),
			userCancel(record._id),
		]);
		expect(cancelled.errors).toBeUndefined();
		if (confirmed.errors) expect(confirmed.data?.updateTrainerReservation).toBeFalsy();
		expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(ReservationStatus.CANCELLED);
		failed(await update(record._id, ReservationStatus.CONFIRMED));
	});
	it('explicit confirm then USER cancel succeeds while still eligible', async () => {
		const record = await fixture();
		expect((await update(record._id, ReservationStatus.CONFIRMED)).errors).toBeUndefined();
		expect((await userCancel(record._id)).errors).toBeUndefined();
	});
	it('USER and TRAINER concurrent cancellation has one winner', async () => {
		const record = await fixture({ reservationStatus: ReservationStatus.CONFIRMED });
		const results = await Promise.all([userCancel(record._id), update(record._id, ReservationStatus.CANCELLED)]);
		expect(results.filter((result) => result.errors)).toHaveLength(1);
		expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(ReservationStatus.CANCELLED);
	});
	it('COMPLETED versus NO_SHOW has exactly one terminal winner', async () => {
		const record = await fixture({ reservationStatus: ReservationStatus.CONFIRMED });
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '10:00' });
		const results = await Promise.all([
			update(record._id, ReservationStatus.COMPLETED),
			update(record._id, ReservationStatus.NO_SHOW),
		]);
		expect(results.filter((result) => result.data?.updateTrainerReservation)).toHaveLength(1);
		expect(results.filter((result) => result.errors)).toHaveLength(1);
		expect([ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW]).toContain(
			(await reservations.findById(record._id).lean())!.reservationStatus,
		);
	});
	it.each([ProgramType.PT_1ON1, ProgramType.GROUP_CLASS])(
		'confirmation preserves %s occupancy and cancellation frees exactly one slot/seat',
		async (type) => {
			const program = type === ProgramType.PT_1ON1 ? pt : group;
			const record = await fixture({ programId: program._id });
			if (type === ProgramType.GROUP_CLASS) await fixture({ programId: group._id, memberId: otherUser._id });
			const count = () =>
				reservations.countDocuments({
					programId: program._id,
					reservationStatus: { $in: availability.capacityOccupyingStatuses },
				});
			const occupied = await count();
			expect(await slots(program)).not.toContain('09:00');
			expect((await update(record._id, ReservationStatus.CONFIRMED)).errors).toBeUndefined();
			expect(await count()).toBe(occupied);
			expect(await slots(program)).not.toContain('09:00');
			failed(await create(program, user));
			expect((await update(record._id, ReservationStatus.CANCELLED)).errors).toBeUndefined();
			expect(await count()).toBe(occupied - 1);
			expect(await slots(program)).toContain('09:00');
			expect((await create(program, user)).errors).toBeUndefined();
			expect(await count()).toBe(occupied);
		},
	);
	it.each([ProgramType.PT_1ON1, ProgramType.GROUP_CLASS])(
		'create versus trainer cancellation preserves %s capacity under contention',
		async (type) => {
			const program = type === ProgramType.PT_1ON1 ? pt : group;
			const record = await fixture({ programId: program._id });
			if (type === ProgramType.GROUP_CLASS) await fixture({ programId: group._id, memberId: otherUser._id });
			const [cancelled, created] = await Promise.all([
				update(record._id, ReservationStatus.CANCELLED),
				create(program, user),
			]);
			expect(cancelled.errors).toBeUndefined();
			if (created.errors) expect((await create(program, user)).errors).toBeUndefined();
			expect(
				await reservations.countDocuments({
					programId: program._id,
					reservationStatus: { $in: availability.capacityOccupyingStatuses },
				}),
			).toBe(type === ProgramType.PT_1ON1 ? 1 : 2);
		},
	);
	it('a failed real status write rolls back reservation and all contention versions', async () => {
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
				throw new Error('Forced trainer abort');
			});
		await expect(
			service.updateTrainerReservation(trainer._id, {
				_id: String(record._id),
				reservationStatus: ReservationStatus.CONFIRMED,
			}),
		).rejects.toThrow('Forced trainer abort');
		expect(changed).toBe(true);
		expect(await snapshot()).toBe(before);
	});
	it('conditional write failure rolls back every contention version', async () => {
		const record = await fixture(),
			before = await snapshot();
		jest.spyOn(reservations.collection, 'findOneAndUpdate').mockResolvedValueOnce(null);
		failed(await update(record._id, ReservationStatus.CONFIRMED), 'Reservation changed');
		expect(await snapshot()).toBe(before);
	});
	it.each([ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED])(
		'real retry crossing start rejects stale target %s',
		async (target) => {
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
			const pending = update(record._id, target);
			await entered.promise;
			try {
				await reservations.updateOne({ _id: record._id }, { $inc: { __v: 1 } });
				jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '09:00' });
			} finally {
				resume.release();
			}
			failed(await pending, 'transition is not allowed');
			expect(locks.mock.calls.length).toBeGreaterThanOrEqual(4);
			expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(ReservationStatus.PENDING);
			expect((await members.collection.findOne({ _id: trainer._id }))!.__v).toBe(0);
			expect((await members.collection.findOne({ _id: user._id }))!.__v).toBe(0);
		},
	);
	it('role revocation after the guard cannot commit a trainer action', async () => {
		const record = await fixture(),
			entered = barrier(),
			resume = barrier();
		const original = members.collection.findOneAndUpdate.bind(
			members.collection,
		) as typeof members.collection.findOneAndUpdate;
		jest
			.spyOn(members.collection, 'findOneAndUpdate')
			.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
				entered.release();
				await resume.promise;
				return original(...args);
			});
		const pending = update(record._id, ReservationStatus.CONFIRMED);
		await entered.promise;
		try {
			await members.updateOne({ _id: trainer._id }, { memberType: MemberType.USER });
		} finally {
			resume.release();
		}
		failed(await pending, 'active TRAINER');
		expect((await reservations.findById(record._id).lean())!.reservationStatus).toBe(ReservationStatus.PENDING);
		expect((await members.collection.findOne({ _id: trainer._id }))!.__v).toBe(0);
	});
	it.each([ProgramType.PT_1ON1, ProgramType.GROUP_CLASS])(
		'confirmation racing a new %s booking preserves occupancy',
		async (type) => {
			const program = type === ProgramType.PT_1ON1 ? pt : group;
			const record = await fixture({ programId: program._id });
			const [confirmed, created] = await Promise.all([
				update(record._id, ReservationStatus.CONFIRMED),
				create(program, otherUser),
			]);
			expect(confirmed.errors).toBeUndefined();
			if (type === ProgramType.PT_1ON1) failed(created);
			else expect(created.errors).toBeUndefined();
			expect(
				await reservations.countDocuments({
					programId: program._id,
					reservationStatus: { $in: availability.capacityOccupyingStatuses },
				}),
			).toBe(type === ProgramType.PT_1ON1 ? 1 : 2);
		},
	);
	it.each([ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])(
		'manages an ended orphaned CONFIRMED reservation as %s',
		async (target) => {
			const record = await fixture({ reservationStatus: ReservationStatus.CONFIRMED, programId: new Types.ObjectId() });
			jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '10:00' });
			expect((await update(record._id, target)).errors).toBeUndefined();
		},
	);
	it('trainer confirmation and cancellation are reflected through unchanged USER APIs', async () => {
		const created = await create(pt, user);
		expect(created.errors).toBeUndefined();
		const id = created.data!.createReservation!._id;
		expect((await update(id, ReservationStatus.CONFIRMED)).errors).toBeUndefined();
		const userQuery =
			'query($input: ReservationsInquiry!) { getMyReservations(input: $input) { list { _id reservationStatus } metaCounter { total } } }';
		const upcoming = await requestGraphQL(
			userQuery,
			{ input: { page: 1, limit: 10, search: { period: 'UPCOMING' } } },
			user,
		);
		expect(upcoming.data!.getMyReservations!.list[0].reservationStatus).toBe(ReservationStatus.CONFIRMED);
		expect((await update(id, ReservationStatus.CANCELLED)).errors).toBeUndefined();
		const history = await requestGraphQL(
			userQuery,
			{ input: { page: 1, limit: 10, search: { period: 'HISTORY' } } },
			user,
		);
		expect(history.data!.getMyReservations!.list[0].reservationStatus).toBe(ReservationStatus.CANCELLED);
		expect(await slots()).toContain('09:00');
	});
});
