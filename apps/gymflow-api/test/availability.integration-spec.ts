import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { AvailabilityModule } from '../src/components/availability/availability.module';
import { Program } from '../src/libs/dto/program/program';
import { Member } from '../src/libs/dto/member/member';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { TrainerSchedule } from '../src/libs/dto/trainer-schedule/trainer-schedule';
import { AvailableSlot } from '../src/libs/dto/availability/availability';
import { ProgramAvailabilityInquiry } from '../src/libs/dto/availability/availability.input';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { TrainerScheduleDayOfWeek, trainerScheduleWeekdays } from '../src/libs/enums/trainer-schedule.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
import * as availability from '../src/libs/availability';

const date = '2030-01-08';
const read =
	'query($input: ProgramAvailabilityInquiry!) { getProgramAvailability(input: $input) { startTime endTime } }';
const slots = [
	{ startTime: '09:00', endTime: '10:00' },
	{ startTime: '10:00', endTime: '11:00' },
	{ startTime: '11:00', endTime: '12:00' },
];
interface Result {
	data?: { getProgramAvailability: AvailableSlot[] };
	errors?: { message: string }[];
}

// Only an owned loopback database. Never import AppModule/DatabaseModule or application URIs.
describe('Availability public read against disposable MongoDB and real GraphQL', () => {
	let mongo: MongoMemoryServer | undefined;
	let app: INestApplication | undefined;
	let connection: Connection;
	let members: Model<Member>,
		programs: Model<Program>,
		schedules: Model<TrainerSchedule>,
		reservations: Model<Reservation>;
	let trainer: Member, otherTrainer: Member, user: Member;
	let pt: Program, group: Program, otherProgram: Program, online: Program;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const query = async (
		input: ProgramAvailabilityInquiry = { programId: pt._id.toHexString(), reservationDate: date },
		token?: string,
	): Promise<Result> => {
		const operation = request(app!.getHttpServer() as Server).post('/graphql');
		if (token) operation.set('Authorization', 'Bearer ' + token);
		return (await operation.send({ query: read, variables: { input } }).expect(200)).body as Result;
	};
	const readSlots = async (program = pt, reservationDate = date) => {
		const result = await query({ programId: program._id.toHexString(), reservationDate });
		expect(result.errors).toBeUndefined();
		return result.data?.getProgramAvailability;
	};
	const reserve = async (program = pt, status = ReservationStatus.PENDING, startTime = '09:00', endTime = '10:00') =>
		reservations.create({
			programId: program._id,
			trainerId: program.memberId,
			memberId: user._id,
			reservationDate: date,
			startTime,
			endTime,
			reservationStatus: status,
			specialRequest: 'Private fixture request',
		});

	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryServer.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			instance: {
				ip: '127.0.0.1',
				dbName: 'gymflow_availability_' + new Types.ObjectId().toHexString(),
				launchTimeout: 60000,
			},
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				AvailabilityModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req }: GraphQLAuthContext) => ({ req }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'isolated-availability-test-key' }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		members = connection.model<Member>('Member');
		programs = connection.model<Program>('Program');
		schedules = connection.model<TrainerSchedule>('TrainerSchedule');
		reservations = connection.model<Reservation>('Reservation');
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
			members.deleteMany({}).exec(),
			programs.deleteMany({}).exec(),
			schedules.deleteMany({}).exec(),
			reservations.deleteMany({}).exec(),
		]);
		[trainer, otherTrainer, user] = await members.create([
			{
				memberNick: 'availability-trainer',
				memberPhone: 'availability-1',
				memberPassword: 'test',
				memberType: MemberType.TRAINER,
			},
			{
				memberNick: 'availability-other',
				memberPhone: 'availability-2',
				memberPassword: 'test',
				memberType: MemberType.TRAINER,
			},
			{
				memberNick: 'availability-user',
				memberPhone: 'availability-3',
				memberPassword: 'test',
				memberType: MemberType.USER,
			},
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
		[pt, group, otherProgram, online] = await programs.create([
			{ ...base, programName: 'Availability PT', programType: ProgramType.PT_1ON1, programCapacity: 1 },
			{ ...base, programName: 'Availability group', programType: ProgramType.GROUP_CLASS, programCapacity: 3 },
			{ ...base, programName: 'Availability other', programType: ProgramType.GROUP_CLASS, programCapacity: 5 },
			{
				...base,
				programName: 'Availability online',
				programType: ProgramType.ONLINE,
				programLocation: ProgramLocation.ONLINE,
				programAddress: undefined,
				programCapacity: 10,
			},
		]);
		await schedules.create(
			trainerScheduleWeekdays.map((dayOfWeek) => ({
				memberId: trainer._id,
				dayOfWeek,
				isAvailable: true,
				startTime: '09:00',
				endTime: '12:00',
			})),
		);
	});
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('exposes exactly the approved public inquiry/output and no reservation mutations', async () => {
		const schema = app!.get(GraphQLSchemaHost).schema;
		const field = schema.getQueryType()!.getFields().getProgramAvailability;
		expect(String(field.type)).toBe('[AvailableSlot!]!');
		expect(field.args.map((arg) => [arg.name, String(arg.type)])).toEqual([['input', 'ProgramAvailabilityInquiry!']]);
		const input = (schema.getType('ProgramAvailabilityInquiry') as GraphQLInputObjectType).getFields();
		expect(Object.keys(input)).toEqual(['programId', 'reservationDate']);
		const output = (schema.getType('AvailableSlot') as GraphQLObjectType).getFields();
		expect(Object.keys(output)).toEqual(['startTime', 'endTime']);
		for (const item of [...Object.values(input), ...Object.values(output)]) expect(String(item.type)).toBe('String!');
		expect(Object.keys(schema.getMutationType()?.getFields() ?? {}).some((name) => /reservation/i.test(name))).toBe(
			false,
		);
		expect(await readSlots()).toEqual(slots);
	});
	it('returns [] for missing/off weekdays and ONLINE', async () => {
		await schedules.deleteOne({ memberId: trainer._id, dayOfWeek: TrainerScheduleDayOfWeek.TUE }).exec();
		expect(await readSlots()).toEqual([]);
		await schedules.create({
			memberId: trainer._id,
			dayOfWeek: TrainerScheduleDayOfWeek.TUE,
			isAvailable: false,
			startTime: '09:00',
			endTime: '12:00',
		});
		expect(await readSlots()).toEqual([]);
		expect(await readSlots(online)).toEqual([]);
	});
	it.each([
		[ReservationStatus.PENDING, true],
		[ReservationStatus.CONFIRMED, true],
		[ReservationStatus.CANCELLED, false],
		[ReservationStatus.COMPLETED, false],
		[ReservationStatus.NO_SHOW, false],
	])('PT status %s blocking=%s', async (status, blocked) => {
		await reserve(pt, status);
		expect(await readSlots()).toEqual(blocked ? slots.slice(1) : slots);
	});
	it.each([0, 2, 3])('counts GROUP occupancy %s without a unique session restriction', async (count) => {
		await reservations.create(
			Array.from({ length: count }, (_, index) => ({
				programId: group._id,
				trainerId: trainer._id,
				memberId: index ? new Types.ObjectId() : user._id,
				reservationDate: date,
				startTime: '09:00',
				endTime: '10:00',
				reservationStatus: index % 2 ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING,
			})),
		);
		expect(await readSlots(group)).toEqual(count < 3 ? slots : slots.slice(1));
	});
	it('blocks trainer overlaps across programs and different sessions of the same group', async () => {
		await reserve(otherProgram, ReservationStatus.PENDING, '09:30', '10:15');
		expect(await readSlots()).toEqual([slots[2]]);
		expect(await readSlots(group)).toEqual([slots[2]]);
		await reservations.deleteMany({}).exec();
		await reserve(group, ReservationStatus.CONFIRMED, '09:30', '10:30');
		expect(await readSlots(group)).toEqual([slots[2]]);
	});
	it('allows touching boundaries and ignores cancelled group reservations', async () => {
		await reserve(pt, ReservationStatus.PENDING, '10:00', '11:00');
		expect(await readSlots()).toEqual([slots[0], slots[2]]);
		await reservations.deleteMany({}).exec();
		await reserve(group, ReservationStatus.CANCELLED);
		expect(await readSlots(group)).toEqual(slots);
	});
	it.each(['2030-02-30', '2030-1-08', '2030-01-06'])(
		'rejects malformed/impossible/past date %s',
		async (reservationDate) => {
			const result = await query({ programId: pt._id.toHexString(), reservationDate });
			expect(result.errors).toBeDefined();
		},
	);
	it('rejects invalid/missing Program and unavailable owner/status', async () => {
		for (const programId of ['invalid', new Types.ObjectId().toHexString()])
			expect((await query({ programId, reservationDate: date })).errors).toBeDefined();
		for (const programStatus of [ProgramStatus.PAUSED, ProgramStatus.DELETE]) {
			await programs.updateOne({ _id: pt._id }, { programStatus }).exec();
			expect((await query()).errors).toBeDefined();
		}
		await programs.updateOne({ _id: pt._id }, { programStatus: ProgramStatus.ACTIVE }).exec();
		await members.updateOne({ _id: trainer._id }, { memberStatus: MemberStatus.BLOCK }).exec();
		expect((await query()).errors).toBeDefined();
		await members
			.updateOne({ _id: trainer._id }, { memberStatus: MemberStatus.ACTIVE, memberType: MemberType.USER })
			.exec();
		expect((await query()).errors).toBeDefined();
	});
	it('resolves Sunday/Monday schedules and excludes starts <= today Seoul time', async () => {
		await schedules
			.updateOne(
				{ memberId: trainer._id, dayOfWeek: TrainerScheduleDayOfWeek.SUN },
				{ startTime: '13:00', endTime: '15:00' },
			)
			.exec();
		expect(await readSlots(pt, '2030-01-13')).toEqual([
			{ startTime: '13:00', endTime: '14:00' },
			{ startTime: '14:00', endTime: '15:00' },
		]);
		expect(await readSlots(pt, '2030-01-07')).toEqual(slots);
		jest.mocked(availability.getSeoulDateTime).mockReturnValue({ reservationDate: '2030-01-07', time: '09:00' });
		expect(await readSlots(pt, '2030-01-07')).toEqual(slots.slice(1));
	});
	it('is global for guest/USER, excludes another trainer, and causes no document writes', async () => {
		const other = await programs.create({
			memberId: otherTrainer._id,
			programName: 'Other trainer fixture',
			programType: ProgramType.PT_1ON1,
			programCategory: ProgramCategory.YOGA,
			programLocation: ProgramLocation.SEOUL,
			programAddress: 'Other fixture address',
			programPrice: 0,
			programDuration: 60,
			programCapacity: 1,
			programImages: ['fixture.jpg'],
		});
		await reserve(other);
		const snapshot = async () => {
			const names = (await connection.db!.listCollections().toArray()).map((item) => item.name).sort();
			const documents = await Promise.all(
				names.map(async (name) => [name, await connection.db!.collection(name).find({}).sort({ _id: 1 }).toArray()]),
			);
			return JSON.stringify(documents);
		};
		const before = await snapshot();
		const token = app!.get(JwtService).sign({ sub: user._id.toHexString() });
		const guest = await query();
		const authenticated = await query(undefined, token);
		expect(guest.errors).toBeUndefined();
		expect(authenticated.errors).toBeUndefined();
		expect(guest.data?.getProgramAvailability).toEqual(slots);
		expect(authenticated.data).toEqual(guest.data);
		expect(await snapshot()).toBe(before);
		const ownSchedule = await request(app!.getHttpServer() as Server)
			.post('/graphql')
			.send({ query: '{ getMyTrainerSchedule { dayOfWeek } }' })
			.expect(200);
		expect((ownSchedule.body as Result).errors).toBeDefined();
	});
});
