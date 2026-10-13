import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { TrainerScheduleModule } from '../src/components/trainer-schedule/trainer-schedule.module';
import { TrainerScheduleService } from '../src/components/trainer-schedule/trainer-schedule.service';
import { AuthService } from '../src/components/auth/auth.service';
import { Member } from '../src/libs/dto/member/member';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { TrainerSchedule } from '../src/libs/dto/trainer-schedule/trainer-schedule';
import { TrainerScheduleInput } from '../src/libs/dto/trainer-schedule/trainer-schedule.input';
import { trainerScheduleWeekdays } from '../src/libs/enums/trainer-schedule.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

interface Result<T> {
	data?: T;
	errors?: { message: string }[];
}
interface Entry {
	_id: string;
	memberId: string;
	dayOfWeek: string;
	startTime: string | null;
	endTime: string | null;
	isAvailable: boolean;
	createdAt: string;
	updatedAt: string;
}
const fields = '_id memberId dayOfWeek startTime endTime isAvailable createdAt updatedAt';
const read = 'query { getMyTrainerSchedule { ' + fields + ' } }';
const save = 'mutation($input: TrainerScheduleInput!) { saveMyTrainerSchedule(input: $input) { ' + fields + ' } }';
const week = (startTime = '09:00'): TrainerScheduleInput => ({
	days: [...trainerScheduleWeekdays]
		.reverse()
		.map((dayOfWeek) => ({ dayOfWeek, isAvailable: true, startTime, endTime: '18:00' })),
});

// Own loopback replica set only: never import AppModule/DatabaseModule or read an application URI.
// Replica-set transactions are intentionally exercised; there is no standalone/non-atomic fallback.
describe('Trainer schedules against disposable MongoDB replica set', () => {
	let mongo: MongoMemoryReplSet | undefined;
	let app: INestApplication | undefined;
	let connection: Connection;
	let schedules: Model<TrainerSchedule>;
	let members: Model<Member>;
	let service: TrainerScheduleService;
	let auth: AuthService;
	let trainer: Member, other: Member, user: Member, admin: Member;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;

	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: {
				count: 1,
				ip: '127.0.0.1',
				storageEngine: 'wiredTiger',
				dbName: 'gymflow_schedule_test_' + new Types.ObjectId().toHexString(),
			},
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				TrainerScheduleModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req }: GraphQLAuthContext) => ({ req }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'isolated-schedule-test-key', signOptions: { expiresIn: '1h' } }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		schedules = connection.model<TrainerSchedule>('TrainerSchedule');
		members = connection.model<Member>('Member');
		await Promise.all([schedules.init(), members.init()]);
		service = module.get(TrainerScheduleService);
		auth = module.get(AuthService);
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		if (previousDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = previousDownload;
	});
	beforeEach(async () => {
		await Promise.all([schedules.deleteMany({}).exec(), members.deleteMany({}).exec()]);
		[trainer, other, user, admin] = await members.create([
			{
				memberNick: 'schedule-trainer',
				memberPhone: 'schedule-1',
				memberPassword: 'test',
				memberType: MemberType.TRAINER,
			},
			{
				memberNick: 'schedule-other',
				memberPhone: 'schedule-2',
				memberPassword: 'test',
				memberType: MemberType.TRAINER,
			},
			{ memberNick: 'schedule-user', memberPhone: 'schedule-3', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'schedule-admin', memberPhone: 'schedule-4', memberPassword: 'test', memberType: MemberType.ADMIN },
		]);
	});
	async function gql<T>(query: string, variables: Record<string, unknown> = {}, account?: Member): Promise<Result<T>> {
		if (!app) throw new Error('Test application not initialized');
		const pending = request(app.getHttpServer() as Server).post('/graphql');
		if (account) pending.set('Authorization', 'Bearer ' + (await auth.createToken(account)));
		const response = await pending.send({ query, variables });
		expect([200, 400]).toContain(response.status);
		return response.body as Result<T>;
	}
	it('enforces real current-account TRAINER guards for reading and saving', async () => {
		for (const account of [undefined, user, admin]) {
			expect((await gql(read, {}, account)).errors).toBeDefined();
			expect((await gql(save, { input: week() }, account)).errors).toBeDefined();
		}
		expect((await gql<{ getMyTrainerSchedule: Entry[] }>(read, {}, trainer)).data?.getMyTrainerSchedule).toEqual([]);
		expect((await gql(save, { input: week() }, trainer)).errors).toBeUndefined();
		await members.updateOne({ _id: trainer._id }, { memberType: MemberType.USER }).exec();
		expect((await gql(save, { input: week() }, trainer)).errors).toBeDefined();
		await members
			.updateOne({ _id: trainer._id }, { memberType: MemberType.TRAINER, memberStatus: MemberStatus.BLOCK })
			.exec();
		expect((await gql(read, {}, trainer)).errors).toBeDefined();
	});
	it('derives ownership, rejects client memberId and returns explicit weekday order on both operations', async () => {
		const result = await gql<{ saveMyTrainerSchedule: Entry[] }>(save, { input: week() }, trainer);
		expect(result.errors).toBeUndefined();
		const entries = result.data?.saveMyTrainerSchedule;
		expect(entries?.map((entry) => entry.dayOfWeek)).toEqual(trainerScheduleWeekdays);
		expect(entries?.every((entry) => entry.memberId === trainer._id.toHexString())).toBe(true);
		expect(entries?.every((entry) => entry._id && entry.createdAt && entry.updatedAt)).toBe(true);
		expect((await gql(read, {}, other)).data).toEqual({ getMyTrainerSchedule: [] });
		expect(
			(await gql(save, { input: { ...week(), memberId: trainer._id.toHexString() } }, other)).errors,
		).toBeDefined();
		expect(
			(
				await gql(
					save,
					{ input: { days: week().days.map((day) => ({ ...day, memberId: trainer._id.toHexString() })) } },
					other,
				)
			).errors,
		).toBeDefined();
		const secondRead = await gql<{ getMyTrainerSchedule: Entry[] }>(read, {}, trainer);
		expect(secondRead.data?.getMyTrainerSchedule.map((entry) => entry.dayOfWeek)).toEqual(trainerScheduleWeekdays);
		expect((await gql(save, { input: week('10:00') }, other)).errors).toBeUndefined();
		const owner = await schedules.find({ memberId: trainer._id }).lean().exec();
		expect(owner).toHaveLength(7);
		expect(owner.every((day) => day.startTime === '09:00')).toBe(true);
	});
	it('rejects invalid full snapshots without changing persisted rows', async () => {
		await service.saveMyTrainerSchedule(trainer._id, week());
		const before = JSON.stringify(await schedules.find({ memberId: trainer._id }).sort({ dayOfWeek: 1 }).lean().exec());
		const invalid: unknown[] = [
			{ days: [] },
			{ days: week().days.slice(1) },
			{ days: [...week().days, week().days[0]] },
			{ days: week().days.map((day) => ({ ...day, dayOfWeek: 'MON' })) },
			{ days: week().days.map((day) => ({ ...day, dayOfWeek: 'OTHER' })) },
			{ days: week().days.map((day) => ({ ...day, isAvailable: 'yes' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '9:00' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '25:00' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '12:75' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '09' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: 'abc' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '09:00\n' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: undefined, endTime: undefined })) },
			{ days: week().days.map((day) => ({ ...day, startTime: null, endTime: null })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '18:00', endTime: '09:00' })) },
			{ days: week().days.map((day) => ({ ...day, startTime: '10:00', endTime: '10:00' })) },
		];
		for (const input of invalid) {
			expect((await gql(save, { input }, trainer)).errors).toBeDefined();
			expect(JSON.stringify(await schedules.find({ memberId: trainer._id }).sort({ dayOfWeek: 1 }).lean().exec())).toBe(
				before,
			);
		}
	});
	it('retains valid hours while disabling, permits new disabled days without hours and re-enables explicitly', async () => {
		const allOff: TrainerScheduleInput = {
			days: trainerScheduleWeekdays.map((dayOfWeek) => ({ dayOfWeek, isAvailable: false })),
		};
		const first = await gql<{ saveMyTrainerSchedule: Entry[] }>(save, { input: allOff }, trainer);
		expect(
			first.data?.saveMyTrainerSchedule.every(
				(day) => !day.isAvailable && day.startTime === null && day.endTime === null,
			),
		).toBe(true);
		await service.saveMyTrainerSchedule(trainer._id, week());
		const disabled = await service.saveMyTrainerSchedule(trainer._id, allOff);
		expect(disabled.every((day) => !day.isAvailable && day.startTime === '09:00' && day.endTime === '18:00')).toBe(
			true,
		);
		await expect(
			service.saveMyTrainerSchedule(trainer._id, { days: allOff.days.map((day) => ({ ...day, isAvailable: true })) }),
		).rejects.toThrow('HH:mm');
		const restored = await service.saveMyTrainerSchedule(trainer._id, week());
		expect(restored.every((day) => day.isAvailable)).toBe(true);
	});
	it('updates existing IDs on repeated saves and enforces actual database uniqueness', async () => {
		const first = await service.saveMyTrainerSchedule(trainer._id, week());
		const second = await service.saveMyTrainerSchedule(trainer._id, week('10:00'));
		expect(second.map((day) => day._id.toHexString())).toEqual(first.map((day) => day._id.toHexString()));
		expect(await schedules.countDocuments({ memberId: trainer._id })).toBe(7);
		await expect(
			schedules.create({ memberId: trainer._id, dayOfWeek: 'MON', isAvailable: false }),
		).rejects.toMatchObject({ code: 11000 });
	});
	it('rolls back the whole weekly write if a failure occurs after bulkWrite', async () => {
		await service.saveMyTrainerSchedule(trainer._id, week());
		const before = JSON.stringify(await schedules.find({ memberId: trainer._id }).sort({ dayOfWeek: 1 }).lean().exec());
		const failure = jest.spyOn(schedules, 'find').mockImplementationOnce(() => {
			throw new Error('Injected failure after weekly write');
		});
		try {
			await expect(service.saveMyTrainerSchedule(trainer._id, week('10:00'))).rejects.toThrow('Injected failure');
		} finally {
			failure.mockRestore();
		}
		expect(JSON.stringify(await schedules.find({ memberId: trainer._id }).sort({ dayOfWeek: 1 }).lean().exec())).toBe(
			before,
		);
	});
	it('keeps concurrent weekly saves coherent and never creates duplicate weekdays', async () => {
		const results = await Promise.allSettled([
			service.saveMyTrainerSchedule(trainer._id, week()),
			service.saveMyTrainerSchedule(trainer._id, week('10:00')),
		]);
		expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
		const rows = await service.getMyTrainerSchedule(trainer._id);
		expect(rows).toHaveLength(7);
		expect(rows.map((day) => day.dayOfWeek)).toEqual(trainerScheduleWeekdays);
		expect(new Set(rows.map((day) => day.startTime)).size).toBe(1);
	});
});
