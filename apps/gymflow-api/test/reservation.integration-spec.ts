import './auth-session.fixture';
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { MongooseModule, getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { resolve } from 'node:path';
import { ReservationModule } from '../src/components/reservation/reservation.module';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import ProgramSchema from '../src/schemas/Program.model';
import { Program } from '../src/libs/dto/program/program';
import { ProgramCategory, ProgramLocation, ProgramType } from '../src/libs/enums/program.enum';

// Owned loopback database only: no AppModule/DatabaseModule or application connection values.
describe('Reservation Phase 1 persistence against disposable MongoDB', () => {
	let mongo: MongoMemoryServer | undefined;
	let module: TestingModule | undefined;
	let reservations: Model<Reservation>;
	let connection: Connection;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;

	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryServer.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			instance: {
				ip: '127.0.0.1',
				dbName: 'gymflow_reservation_foundation_' + new Types.ObjectId().toHexString(),
				launchTimeout: 60000,
			},
		});
		module = await Test.createTestingModule({
			imports: [MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }), ReservationModule],
		}).compile();
		connection = module.get<Connection>(getConnectionToken());
		reservations = module.get<Model<Reservation>>(getModelToken('Reservation'));
		await reservations.init();
	});
	afterAll(async () => {
		await module?.close();
		await mongo?.stop();
		if (previousDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = previousDownload;
	});
	it('allows two users in one GROUP_CLASS session and persists refs and timestamps', async () => {
		const trainerId = new Types.ObjectId();
		const programs = connection.model<Program>('Program', ProgramSchema);
		const program = await programs.create({
			memberId: trainerId,
			programType: ProgramType.GROUP_CLASS,
			programCategory: ProgramCategory.YOGA,
			programLocation: ProgramLocation.SEOUL,
			programName: 'Foundation group fixture',
			programAddress: 'Seoul fixture address',
			programPrice: 0,
			programDuration: 60,
			programCapacity: 5,
			programImages: ['fixture.jpg'],
		});
		const session = {
			trainerId,
			programId: program._id,
			reservationDate: '2026-12-01',
			startTime: '09:00',
			endTime: '10:00',
		};
		const users = [new Types.ObjectId(), new Types.ObjectId()];
		const entries = await reservations.create([
			{ ...session, memberId: users[0], specialRequest: 'Bring a mat.' },
			{ ...session, memberId: users[1], reservationStatus: ReservationStatus.CONFIRMED },
		]);
		expect(await reservations.countDocuments(session).exec()).toBe(2);
		expect(entries[0]._id.equals(entries[1]._id)).toBe(false);
		const stored = await reservations.findById(entries[0]._id).lean().exec();
		expect(stored).toMatchObject({
			...session,
			memberId: users[0],
			specialRequest: 'Bring a mat.',
			reservationStatus: ReservationStatus.PENDING,
		});
		expect(stored?.createdAt).toBeInstanceOf(Date);
		expect(stored?.updatedAt).toBeInstanceOf(Date);
		const previousUpdatedAt = entries[0].updatedAt;
		entries[0].specialRequest = 'Updated request';
		await entries[0].save();
		expect(entries[0].updatedAt.getTime()).toBeGreaterThanOrEqual(previousUpdatedAt.getTime());
		const indexes = await reservations.collection.indexes();
		expect(indexes).toHaveLength(4);
		expect(indexes.filter((index) => index.name !== '_id_').every((index) => !index.unique)).toBe(true);
	});
});
