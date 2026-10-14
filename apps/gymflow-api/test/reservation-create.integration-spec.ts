import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLInputObjectType } from 'graphql';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { ReservationModule } from '../src/components/reservation/reservation.module';
import { ReservationService } from '../src/components/reservation/reservation.service';
import { AvailabilityModule } from '../src/components/availability/availability.module';
import { ReservationInput } from '../src/libs/dto/reservation/reservation.input';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { TrainerSchedule } from '../src/libs/dto/trainer-schedule/trainer-schedule';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { trainerScheduleWeekdays, TrainerScheduleDayOfWeek } from '../src/libs/enums/trainer-schedule.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
import * as availability from '../src/libs/availability';

const date = '2030-01-08';
const mutation =
	'mutation($input: ReservationInput!) { createReservation(input: $input) { _id programId trainerId memberId reservationDate startTime endTime reservationStatus specialRequest createdAt updatedAt } }';
interface Result {
	data?: { createReservation: Reservation };
	errors?: { message: string; extensions?: { code?: string } }[];
}
function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

// All writes target this test's owned loopback replica set. No application URI or AppModule.
describe('Reservation create against disposable replica-set GraphQL', () => {
	let mongo: MongoMemoryReplSet | undefined;
	let app: INestApplication | undefined;
	let connection: Connection;
	let members: Model<Member>,
		programs: Model<Program>,
		schedules: Model<TrainerSchedule>,
		reservations: Model<Reservation>;
	let service: ReservationService;
	let trainer: Member, otherTrainer: Member, user: Member, otherUser: Member, thirdUser: Member, admin: Member;
	let pt: Program, group: Program, otherProgram: Program, otherPt: Program, online: Program;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const token = (member: Member) => app!.get(JwtService).sign({ sub: member._id.toHexString() });
	const input = (program = pt, startTime = '09:00'): ReservationInput => ({
		programId: program._id.toHexString(),
		reservationDate: date,
		startTime,
	});
	const query = async (value: object = input(), viewer: Member | null = user): Promise<Result> => {
		const operation = request(app!.getHttpServer() as Server).post('/graphql');
		if (viewer) operation.set('Authorization', 'Bearer ' + token(viewer));
		const result = await operation.send({ query: mutation, variables: { input: value } });
		expect([200, 400]).toContain(result.status);
		return result.body as Result;
	};
	const success = (result: Result) => {
		expect(result.errors).toBeUndefined();
		expect(result.data?.createReservation).toBeDefined();
		return result.data!.createReservation;
	};
	const rejected = async (value: object = input(), viewer: Member | null = user, message?: string) => {
		const result = await query(value, viewer);
		expect(result.errors?.length).toBeGreaterThan(0);
		expect(result.data?.createReservation).toBeFalsy();
		if (message) expect(result.errors!.map((error) => error.message).join(' ')).toContain(message);
		return result;
	};
	const fixture = (
		program = pt,
		member = otherUser,
		status = ReservationStatus.PENDING,
		startTime = '09:00',
		endTime = '10:00',
	) =>
		reservations.create({
			programId: program._id,
			trainerId: program.memberId,
			memberId: member._id,
			reservationDate: date,
			startTime,
			endTime,
			reservationStatus: status,
		});
	const snapshot = async () =>
		JSON.stringify(
			await Promise.all(
				[members, programs, schedules, reservations].map((model) =>
					model.collection.find({}).sort({ _id: 1 }).toArray(),
				),
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
				dbName: 'gymflow_create_' + new Types.ObjectId().toHexString(),
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
			.useValue(new JwtService({ secret: 'isolated-reservation-create-test-key' }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		members = connection.model<Member>('Member');
		programs = connection.model<Program>('Program');
		schedules = connection.model<TrainerSchedule>('TrainerSchedule');
		reservations = connection.model<Reservation>('Reservation');
		service = module.get(ReservationService);
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
		[trainer, otherTrainer, user, otherUser, thirdUser, admin] = await members.create([
			{ memberNick: 'create-trainer', memberPhone: 'create-1', memberPassword: 'test', memberType: MemberType.TRAINER },
			{
				memberNick: 'create-other-trainer',
				memberPhone: 'create-2',
				memberPassword: 'test',
				memberType: MemberType.TRAINER,
			},
			{ memberNick: 'create-user', memberPhone: 'create-3', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'create-other-user', memberPhone: 'create-4', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'create-third-user', memberPhone: 'create-5', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'create-admin', memberPhone: 'create-6', memberPassword: 'test', memberType: MemberType.ADMIN },
		]);
		const base = {
			memberId: trainer._id,
			programCategory: ProgramCategory.YOGA,
			programLocation: ProgramLocation.SEOUL,
			programAddress: 'Seoul fixture address',
			programPrice: 0,
			programDuration: 60,
			programImages: ['fixture.jpg'],
		};
		[pt, group, otherProgram, otherPt, online] = await programs.create([
			{ ...base, programName: 'Create PT', programType: ProgramType.PT_1ON1, programCapacity: 1 },
			{ ...base, programName: 'Create group', programType: ProgramType.GROUP_CLASS, programCapacity: 3 },
			{ ...base, programName: 'Create other group', programType: ProgramType.GROUP_CLASS, programCapacity: 5 },
			{
				...base,
				memberId: otherTrainer._id,
				programName: 'Create other PT',
				programType: ProgramType.PT_1ON1,
				programCapacity: 1,
			},
			{
				...base,
				programName: 'Create online',
				programType: ProgramType.ONLINE,
				programLocation: ProgramLocation.ONLINE,
				programAddress: undefined,
				programCapacity: 5,
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

	it('exposes only the minimal create input and existing Reservation output', () => {
		const schema = app!.get(GraphQLSchemaHost).schema;
		const field = schema.getMutationType()!.getFields().createReservation;
		expect(String(field.type)).toBe('Reservation!');
		expect(field.args.map((arg) => [arg.name, String(arg.type)])).toEqual([['input', 'ReservationInput!']]);
		const fields = (schema.getType('ReservationInput') as GraphQLInputObjectType).getFields();
		expect(Object.entries(fields).map(([name, value]) => [name, String(value.type)])).toEqual([
			['programId', 'String!'],
			['reservationDate', 'String!'],
			['startTime', 'String!'],
			['specialRequest', 'String'],
		]);
		expect(Object.keys(schema.getMutationType()!.getFields())).toContain('createReservation');
	});
	it.each([ProgramType.PT_1ON1, ProgramType.GROUP_CLASS])(
		'creates %s with server-owned refs, end and PENDING',
		async (type) => {
			const program = type === ProgramType.PT_1ON1 ? pt : group;
			const beforeMember = await members.collection.findOne({ _id: user._id });
			const beforeProgram = await programs.collection.findOne({ _id: program._id });
			const beforeSchedule = await schedules.collection.findOne({
				memberId: trainer._id,
				dayOfWeek: TrainerScheduleDayOfWeek.TUE,
			});
			const created = success(await query(input(program)));
			expect(created).toMatchObject({
				memberId: user._id.toHexString(),
				trainerId: trainer._id.toHexString(),
				programId: program._id.toHexString(),
				reservationDate: date,
				startTime: '09:00',
				endTime: '10:00',
				reservationStatus: ReservationStatus.PENDING,
				specialRequest: null,
			});
			expect(Number.isNaN(Date.parse(String(created.createdAt)))).toBe(false);
			expect(Number.isNaN(Date.parse(String(created.updatedAt)))).toBe(false);
			expect(await reservations.countDocuments()).toBe(1);
			const afterMember = await members.collection.findOne({ _id: user._id });
			const afterProgram = await programs.collection.findOne({ _id: program._id });
			const afterSchedule = await schedules.collection.findOne({
				memberId: trainer._id,
				dayOfWeek: TrainerScheduleDayOfWeek.TUE,
			});
			expect(afterMember).toEqual({ ...beforeMember, __v: Number(beforeMember!.__v) + 1 });
			expect(afterProgram).toEqual({ ...beforeProgram, __v: Number(beforeProgram!.__v) + 1 });
			expect(afterSchedule).toEqual({ ...beforeSchedule, __v: Number(beforeSchedule!.__v) + 1 });
		},
	);
	it('derives end from the protected current duration', async () => {
		await programs.updateOne({ _id: pt._id }, { programDuration: 40 });
		expect(success(await query(input(pt, '09:40'))).endTime).toBe('10:20');
	});
	it.each(['memberId', 'trainerId', 'endTime', 'reservationStatus', 'createdAt', 'updatedAt'])(
		'rejects client-controlled %s',
		async (field) => {
			await rejected({ ...input(), [field]: 'not-client-owned' });
			expect(await reservations.countDocuments()).toBe(0);
		},
	);
	it.each(['guest', 'trainer', 'admin', 'blocked', 'deleted'])('denies %s', async (role) => {
		const before = await snapshot();
		if (role === 'blocked' || role === 'deleted')
			await members.updateOne(
				{ _id: user._id },
				{ memberStatus: role === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
			);
		const expected = role === 'blocked' || role === 'deleted' ? await snapshot() : before;
		await rejected(input(), role === 'guest' ? null : role === 'trainer' ? trainer : role === 'admin' ? admin : user);
		expect(await snapshot()).toBe(expected);
	});
	it.each([ProgramStatus.PAUSED, ProgramStatus.DELETE])(
		'rejects %s programs without committed metadata writes',
		async (programStatus) => {
			await programs.updateOne({ _id: pt._id }, { programStatus });
			const before = await snapshot();
			await rejected(input(), user, 'Program not found');
			expect(await snapshot()).toBe(before);
		},
	);
	it('rejects nonexistent Program', async () => {
		await rejected({ ...input(), programId: new Types.ObjectId().toHexString() }, user, 'Program not found');
	});
	it.each(['missing', 'blocked', 'deleted', 'user', 'admin'])('rejects invalid owner: %s', async (state) => {
		if (state === 'missing') await members.deleteOne({ _id: trainer._id });
		else if (state === 'blocked' || state === 'deleted')
			await members.updateOne(
				{ _id: trainer._id },
				{ memberStatus: state === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
			);
		else
			await members.updateOne(
				{ _id: trainer._id },
				{ memberType: state === 'user' ? MemberType.USER : MemberType.ADMIN },
			);
		const before = await snapshot();
		await rejected(input(), user, 'Program not found');
		expect(await snapshot()).toBe(before);
	});
	it('rejects ONLINE even with no schedule', async () => {
		await schedules.deleteMany({});
		await rejected(input(online), user, 'Only PT_1ON1 and GROUP_CLASS');
	});
	it.each([
		{ programId: 'invalid' },
		{ reservationDate: '2030-02-30' },
		{ reservationDate: '2030-1-08' },
		{ reservationDate: '2030-01-06' },
		{ startTime: '24:00' },
		{ startTime: '9:00' },
		{ startTime: '09:00\n' },
	])('rejects invalid input %#', async (value) => {
		const before = await snapshot();
		await rejected({ ...input(), ...value });
		expect(await snapshot()).toBe(before);
	});
	it.each(['09:00', '09:01'])('rejects equal/passed today start at %s', async (time) => {
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time });
		await rejected(input(), user, 'future');
		expect(await reservations.countDocuments()).toBe(0);
	});
	it.each(['missing', 'off'])('rejects %s schedule', async (state) => {
		const filter = { memberId: trainer._id, dayOfWeek: TrainerScheduleDayOfWeek.TUE };
		if (state === 'missing') await schedules.deleteOne(filter);
		else await schedules.updateOne(filter, { isAvailable: false });
		const before = await snapshot();
		await rejected(input(), user, 'unavailable');
		expect(await snapshot()).toBe(before);
	});
	it.each(['08:00', '09:30', '12:00'])('rejects off-grid/out-of-range start %s', async (startTime) => {
		await rejected(input(pt, startTime), user, 'schedule');
	});
	it('rejects a duration that extends beyond schedule and corrupt capacities', async () => {
		await programs.updateOne({ _id: pt._id }, { programDuration: 181 });
		await rejected(input(), user, 'schedule');
		await programs.collection.updateOne({ _id: pt._id }, { $set: { programDuration: 60, programCapacity: 2 } });
		await rejected(input(), user, 'configuration');
	});
	it('blocks trainer overlap across Programs and different overlapping GROUP sessions', async () => {
		await fixture(otherProgram, otherUser, ReservationStatus.CONFIRMED, '09:30', '10:30');
		await rejected(input(), user, 'Trainer');
		await rejected(input(group), user, 'conflicting session');
		await reservations.deleteMany({});
		await fixture(group, otherUser, ReservationStatus.PENDING, '09:30', '10:30');
		await rejected(input(group), user, 'conflicting session');
	});
	it('allows group occupancy below capacity and rejects a full group', async () => {
		await fixture(group, otherUser);
		await fixture(group, thirdUser, ReservationStatus.CONFIRMED);
		success(await query(input(group)));
		await rejected(input(group), otherTrainer, 'Role not permitted');
		const fourth = await members.create({
			memberNick: 'create-fourth',
			memberPhone: 'create-7',
			memberPassword: 'test',
			memberType: MemberType.USER,
		});
		await rejected(input(group), fourth, 'full');
		expect(await reservations.countDocuments()).toBe(3);
	});
	it('checks duplicate before general USER overlap and does not occupy a second group seat', async () => {
		success(await query(input(group)));
		await rejected(input(group), user, 'already have a reservation for this session');
		expect(await reservations.countDocuments()).toBe(1);
	});
	it('blocks USER overlap across trainers/programs', async () => {
		await fixture(otherPt, user, ReservationStatus.CONFIRMED, '09:30', '10:30');
		await rejected(input(), user, 'overlapping reservation');
	});
	it('permits touching USER and trainer interval boundaries', async () => {
		await fixture(pt, user, ReservationStatus.PENDING, '09:00', '10:00');
		success(await query(input(pt, '10:00')));
		expect(await reservations.countDocuments()).toBe(2);
	});
	it.each([ReservationStatus.CANCELLED, ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])(
		'%s does not block capacity or the USER',
		async (status) => {
			await fixture(pt, user, status);
			success(await query());
		},
	);
	it.each([
		[undefined, null],
		[null, null],
		['', null],
		['   ', null],
		['  Please help  ', 'Please help'],
		['a'.repeat(500), 'a'.repeat(500)],
	])('handles specialRequest %#', async (specialRequest, expected) => {
		const created = success(await query({ ...input(), specialRequest }));
		expect(created.specialRequest).toBe(expected);
		const saved = await reservations.findById(created._id).lean();
		if (expected === null) expect(saved!.specialRequest).toBeUndefined();
	});
	it.each(['a'.repeat(501), 42])('rejects invalid specialRequest %#', async (specialRequest) => {
		await rejected({ ...input(), specialRequest });
		expect(await reservations.countDocuments()).toBe(0);
	});

	it('two concurrent PT users: exactly one wins', async () => {
		const results = await Promise.all([query(input(), user), query(input(), otherUser)]);
		expect(results.filter((result) => result.data?.createReservation)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.length)).toHaveLength(1);
		expect(await reservations.countDocuments()).toBe(1);
	});
	it.each([0, 2])('concurrent GROUP attempts with %s occupied seats never exceed capacity', async (occupancy) => {
		const fourth = await members.create({
			memberNick: 'concurrent-fourth',
			memberPhone: 'concurrent-4',
			memberPassword: 'test',
			memberType: MemberType.USER,
		});
		const fifth = await members.create({
			memberNick: 'concurrent-fifth',
			memberPhone: 'concurrent-5',
			memberPassword: 'test',
			memberType: MemberType.USER,
		});
		if (occupancy) {
			await fixture(group, thirdUser);
			await fixture(group, fourth, ReservationStatus.CONFIRMED);
		}
		const results = await Promise.all([user, otherUser, fifth].map((viewer) => query(input(group), viewer)));
		expect(results.filter((result) => result.data?.createReservation)).toHaveLength(3 - occupancy);
		expect(await reservations.countDocuments({ programId: group._id })).toBe(3);
	});
	it('one USER concurrent overlapping bookings across trainers: exactly one wins', async () => {
		const results = await Promise.all([query(input(pt)), query(input(otherPt))]);
		expect(results.filter((result) => result.data?.createReservation)).toHaveLength(1);
		expect(await reservations.countDocuments({ memberId: user._id })).toBe(1);
	});
	it('duplicate concurrent GROUP requests occupy one seat only', async () => {
		const results = await Promise.all([query(input(group)), query(input(group))]);
		expect(results.filter((result) => result.data?.createReservation)).toHaveLength(1);
		expect(results.find((result) => result.errors)?.errors![0].message).toContain(
			'already have a reservation for this session',
		);
		expect(await reservations.countDocuments()).toBe(1);
	});
	it('failure after real insert rolls back Reservation and every contention version', async () => {
		const before = await snapshot();
		const original = reservations.collection.insertOne.bind(
			reservations.collection,
		) as typeof reservations.collection.insertOne;
		let inserted = false;
		jest
			.spyOn(reservations.collection, 'insertOne')
			.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
				await original(...args);
				inserted = true;
				throw new Error('Forced failure after insert');
			});
		await expect(service.createReservation(user._id, input())).rejects.toThrow('Forced failure after insert');
		expect(inserted).toBe(true);
		expect(await snapshot()).toBe(before);
	});
	it.each(['program', 'schedule', 'clock'])('concurrent %s change cannot create a stale booking', async (change) => {
		const entered = barrier(),
			resume = barrier();
		const collection = change === 'schedule' ? schedules.collection : programs.collection;
		const original = collection.findOneAndUpdate.bind(collection) as typeof collection.findOneAndUpdate;
		const spy = jest
			.spyOn(collection, 'findOneAndUpdate')
			.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
				entered.release();
				await resume.promise;
				return original(...args);
			});
		const pending = query();
		await entered.promise;
		try {
			if (change === 'program') await programs.updateOne({ _id: pt._id }, { programStatus: ProgramStatus.PAUSED });
			else if (change === 'schedule')
				await schedules.updateOne(
					{ memberId: trainer._id, dayOfWeek: TrainerScheduleDayOfWeek.TUE },
					{ isAvailable: false },
				);
			else {
				await programs.updateOne({ _id: pt._id }, { $inc: { __v: 1 } });
				jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: date, time: '09:00' });
			}
		} finally {
			resume.release();
		}
		const result = await pending;
		expect(result.errors?.length).toBeGreaterThan(0);
		expect(await reservations.countDocuments()).toBe(0);
		expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect((await members.collection.findOne({ _id: user._id }))!.__v).toBe(0);
		expect((await members.collection.findOne({ _id: trainer._id }))!.__v).toBe(0);
	});
	it('rechecks Seoul time immediately before insert even without a retry', async () => {
		jest
			.mocked(availability.getSeoulDateTime)
			.mockReturnValueOnce({ reservationDate: date, time: '08:59' })
			.mockReturnValue({ reservationDate: date, time: '09:00' });
		const before = await snapshot();
		await rejected(input(), user, 'future');
		expect(await snapshot()).toBe(before);
	});
	it('create and frozen availability agree about occupied and cancelled PT slots', async () => {
		const created = success(await query());
		const read = async () => {
			const response = await request(app!.getHttpServer() as Server)
				.post('/graphql')
				.send({
					query:
						'query($input: ProgramAvailabilityInquiry!) { getProgramAvailability(input: $input) { startTime endTime } }',
					variables: { input: { programId: pt._id.toHexString(), reservationDate: date } },
				})
				.expect(200);
			return response.body as { data: { getProgramAvailability: { startTime: string }[] }; errors?: unknown[] };
		};
		expect((await read()).data.getProgramAvailability.map((slot) => slot.startTime)).toEqual(['10:00', '11:00']);
		// Fixture-only status edit, not a cancellation API.
		await reservations.updateOne({ _id: created._id }, { reservationStatus: ReservationStatus.CANCELLED });
		expect((await read()).data.getProgramAvailability.map((slot) => slot.startTime)).toEqual([
			'09:00',
			'10:00',
			'11:00',
		]);
		success(await query());
	});
});
