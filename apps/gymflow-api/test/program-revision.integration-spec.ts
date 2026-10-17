import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLInputObjectType, GraphQLObjectType } from 'graphql';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { BatchService } from '../../gymflow-batch/src/batch.service';
import { ComponentsModule } from '../src/components/components.module';
import { ProgramService } from '../src/components/program/program.service';
import { ReservationService } from '../src/components/reservation/reservation.service';
import { ReviewService } from '../src/components/review/review.service';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { ProgramInput } from '../src/libs/dto/program/program.input';
import { ProgramUpdate } from '../src/libs/dto/program/program.update';
import { ProgramCategory, ProgramLocation, ProgramType } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { getAvailabilityWeekday, getSeoulDateTime } from '../src/libs/availability';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((done) => {
		release = done;
	});
	return { promise, release };
}

// Only the suite's owned replica set is used; no application database or media files.
describe('Program business revision integrity', () => {
	let app: INestApplication, mongo: MongoMemoryReplSet, connection: Connection;
	let programs: Model<Program & { __v: number }>, members: Model<Member>;
	let service: ProgramService, booking: ReservationService, reviewing: ReviewService;
	let trainer: Member, other: Member, user: Member, admin: Member, program: Program;
	const base: ProgramInput = {
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
	const date = getSeoulDateTime(new Date(Date.now() + 2 * 86400000)).reservationDate;
	const raw = () => programs.collection.findOne({ _id: program._id });
	beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1', dbName: 'program_revision_test' },
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
		booking = module.get(ReservationService);
		reviewing = module.get(ReviewService);
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
		program = await service.createProgram(trainer._id, base);
	});
	async function mutation(viewer: Member | null, input: object, byAdmin = false) {
		const name = byAdmin ? 'updateProgramByAdmin' : 'updateProgram';
		let operation = request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true');
		if (viewer) operation = operation.set('Authorization', 'Bearer ' + (await fixtureAccessToken(viewer, app)));
		return (
			await operation.send({
				query: `mutation($input:ProgramUpdate!){${name}(input:$input){_id programPrice programStatus programRevision}}`,
				variables: { input },
			})
		).body as {
			data?: { updateProgram?: Program; updateProgramByAdmin?: Program };
			errors?: { message: string; extensions: { originalError?: { reason?: string } } }[];
		};
	}
	const edit = (patch: Partial<ProgramUpdate> = {}, expectedRevision = 0) =>
		service.updateProgram(trainer._id, { _id: program._id, expectedRevision, ...patch });
	it('exposes required revision contracts without changing Create inputs', () => {
		const schema = app.get(GraphQLSchemaHost).schema;
		expect((schema.getType('Program') as GraphQLObjectType).getFields().programRevision.type.toString()).toBe('Int!');
		expect(
			(schema.getType('ProgramUpdate') as GraphQLInputObjectType).getFields().expectedRevision.type.toString(),
		).toBe('Int!');
		expect((schema.getType('ProgramInput') as GraphQLInputObjectType).getFields()).not.toHaveProperty(
			'expectedRevision',
		);
		expect((schema.getType('ProgramInput') as GraphQLInputObjectType).getFields()).not.toHaveProperty(
			'createRequestId',
		);
		expect(program.programRevision).toBe(0);
	});
	it('backfills legacy records to zero idempotently without touching timestamps, __v or business data', async () => {
		await programs.collection.updateOne({ _id: program._id }, { $unset: { programRevision: '' } });
		const before = await raw();
		await service.onModuleInit();
		expect(await raw()).toEqual({ ...before, programRevision: 0 });
		const once = await raw();
		await service.onModuleInit();
		expect(await raw()).toEqual(once);
	});
	it('A saves 70000; stale B cannot replace it with 60000; explicit reload permits revision 2', async () => {
		const inquiry = { page: 1, limit: 100, search: {} };
		const a = (await service.getTrainerPrograms(trainer._id, inquiry)).list[0];
		const b = (await service.getTrainerPrograms(trainer._id, inquiry)).list[0];
		expect([a.programRevision, b.programRevision]).toEqual([0, 0]);
		const first = await mutation(trainer, {
			_id: program._id,
			expectedRevision: a.programRevision,
			programPrice: 70000,
		});
		expect(first.data?.updateProgram?.programRevision).toBe(1);
		const before = await raw();
		const stale = await mutation(trainer, {
			_id: program._id,
			expectedRevision: b.programRevision,
			programPrice: 60000,
		});
		expect(stale.errors?.[0].message).toBe('Program has changed. Refresh and review the latest data.');
		await expect(edit({ programPrice: 60000 })).rejects.toMatchObject({
			response: { reason: 'PROGRAM_REVISION_CONFLICT' },
		});
		expect(await raw()).toEqual(before);
		expect(before?.programPrice).toBe(70000);
		const latest = (await service.getTrainerPrograms(trainer._id, inquiry)).list[0];
		const next = await edit({ programPrice: 60000 }, latest.programRevision);
		expect([next.programPrice, next.programRevision]).toEqual([60000, 2]);
	});
	it('two genuinely overlapping updates from revision zero can commit only once', async () => {
		const entered = barrier(),
			resume = barrier();
		let reads = 0;
		const original = programs.collection.findOne.bind(programs.collection) as typeof programs.collection.findOne;
		jest.spyOn(programs.collection, 'findOne').mockImplementation(async (...args: Parameters<typeof original>) => {
			const value = await original(...args);
			if (++reads <= 2) {
				if (reads === 2) entered.release();
				await resume.promise;
			}
			return value;
		});
		const pending = Promise.allSettled([edit({ programPrice: 70000 }), edit({ programPrice: 60000 })]);
		await entered.promise;
		resume.release();
		const results = await pending;
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect((await raw())?.programRevision).toBe(1);
		expect((await raw())?.__v).toBe(1);
	});
	it.each([undefined, null, -1, 0.5, 2147483647])(
		'rejects invalid/missing expectedRevision %s without changes',
		async (expectedRevision) => {
			const before = await raw();
			const result = await mutation(trainer, { _id: program._id, expectedRevision, programPrice: 60000 });
			expect(result.errors?.length).toBeGreaterThan(0);
			expect(await raw()).toEqual(before);
		},
	);
	it('foreign Trainer and USER cannot bypass ownership/role checks with a valid revision', async () => {
		const before = await raw();
		for (const viewer of [other, user])
			expect(
				(await mutation(viewer, { _id: program._id, expectedRevision: 0, programPrice: 60000 })).errors,
			).toBeDefined();
		expect(await raw()).toEqual(before);
	});
	it('Admin updates/status transitions require their loaded revision', async () => {
		await edit({ programPrice: 70000 });
		expect(
			(await mutation(admin, { _id: program._id, expectedRevision: 0, programStatus: 'PAUSED' }, true)).errors?.[0]
				.message,
		).toContain('Program has changed');
		const paused = await mutation(admin, { _id: program._id, expectedRevision: 1, programStatus: 'PAUSED' }, true);
		expect(paused.data?.updateProgramByAdmin?.programRevision).toBe(2);
		const deleted = await mutation(admin, { _id: program._id, expectedRevision: 2, programStatus: 'DELETE' }, true);
		expect(deleted.data?.updateProgramByAdmin?.programRevision).toBe(3);
		await service.removeProgramByAdmin(program._id);
		expect(await raw()).toBeNull();
	});
	async function history(count = 1) {
		for (let index = 0; index < count; index++)
			await connection.model('Reservation').create({
				programId: program._id,
				trainerId: trainer._id,
				memberId: new Types.ObjectId(),
				reservationDate: date,
				startTime: '09:00',
				endTime: '10:00',
				reservationStatus: ReservationStatus.PENDING,
			});
	}
	it.each([
		{ programType: ProgramType.GROUP_CLASS },
		{ programDuration: 30 },
		{ programLocation: ProgramLocation.BUSAN },
		{ programAddress: 'Busan studio' },
	])('preserves protected field policy %j', async (patch) => {
		await history();
		const before = await raw();
		await expect(edit(patch)).rejects.toThrow('upcoming reservations');
		expect(await raw()).toEqual(before);
	});
	it('allows reserved price and trimmed-equivalent address changes', async () => {
		await history();
		const result = await edit({ programPrice: 70000, programAddress: ' Seoul studio ' });
		expect([result.programPrice, result.programRevision]).toEqual([70000, 1]);
	});
	it('preserves GROUP_CLASS occupancy floor', async () => {
		program = await service.createProgram(trainer._id, {
			...base,
			programType: ProgramType.GROUP_CLASS,
			programCapacity: 3,
		});
		await history(2);
		await expect(edit({ programCapacity: 1 })).rejects.toThrow('occupied session seats');
		expect((await edit({ programCapacity: 2 })).programRevision).toBe(1);
	});
	it('views/repeated views/like/unlike change __v only; an earlier engagement cannot stale an editor', async () => {
		const versions: (number | undefined)[] = [];
		for (const action of [
			() => service.getProgram(user._id, program._id),
			() => service.getProgram(user._id, program._id),
			() => service.likeTargetProgram(user._id, program._id),
			() => service.likeTargetProgram(user._id, program._id),
		]) {
			await action();
			const current = await programs.findById(program._id).lean().exec();
			versions.push(current?.__v);
			expect(current?.programRevision).toBe(0);
		}
		expect(versions).toEqual([1, 2, 3, 4]);
		expect((await raw())?.programViews).toBe(1);
		expect((await raw())?.programLikes).toBe(0);
		expect((await edit({ programPrice: 70000 })).programRevision).toBe(1);
	});
	it('an overlapping real view is safely rejected as internal contention, not stale business data', async () => {
		const entered = barrier(),
			resume = barrier();
		let held = false;
		const original = programs.collection.findOneAndUpdate.bind(
			programs.collection,
		) as typeof programs.collection.findOneAndUpdate;
		jest
			.spyOn(programs.collection, 'findOneAndUpdate')
			.mockImplementation(async (...args: Parameters<typeof original>) => {
				if (!held && (args[1] as { $inc?: { programRevision?: number } }).$inc?.programRevision === 1) {
					held = true;
					entered.release();
					await resume.promise;
				}
				return original(...args);
			});
		const pending = edit({ programPrice: 70000 }).then(
			() => null,
			(error: unknown) => error as { getResponse(): { reason: string } },
		);
		await entered.promise;
		await service.getProgram(user._id, program._id);
		resume.release();
		expect((await pending)?.getResponse().reason).toBe('PROGRAM_WRITE_CONTENTION');
		expect((await raw())?.programRevision).toBe(0);
		expect((await raw())?.programPrice).toBe(50000);
	});
	it('real booking and review fences do not advance the business revision', async () => {
		await connection.model('TrainerSchedule').create({
			memberId: trainer._id,
			dayOfWeek: getAvailabilityWeekday(date),
			isAvailable: true,
			startTime: '09:00',
			endTime: '18:00',
		});
		const reservation = await booking.createReservation(user._id, {
			programId: String(program._id),
			reservationDate: date,
			startTime: '09:00',
		});
		expect([(await raw())?.__v, (await raw())?.programRevision]).toEqual([1, 0]);
		await connection
			.model('Reservation')
			.updateOne({ _id: reservation._id }, { $set: { reservationStatus: ReservationStatus.COMPLETED } });
		await reviewing.createReview(user._id, {
			reservationId: String(reservation._id),
			rating: 5,
			content: 'Useful session',
		});
		expect([(await raw())?.__v, (await raw())?.programRevision]).toEqual([2, 0]);
		expect((await edit({ programPrice: 70000 })).programRevision).toBe(1);
	});
	it('batch counter/rank reconciliation does not advance the business revision', async () => {
		const batch = new BatchService(programs, members);
		await batch.batchTopPrograms();
		await batch.batchTopTrainers();
		expect((await raw())?.programRevision).toBe(0);
		expect((await edit({ programPrice: 70000 })).programRevision).toBe(1);
	});
});
