import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { GraphQLEnumType, GraphQLObjectType } from 'graphql';
import { createConnection, Types } from 'mongoose';
import ReservationSchema from '../src/schemas/Reservation.model';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { ReservationStatus, RESERVATION_TIMEZONE } from '../src/libs/enums/reservation.enum';
import { assertReservation, isReservationDate } from '../src/libs/reservation.validation';

const interval = () => ({ reservationDate: '2026-12-01', startTime: '09:00', endTime: '10:00' });
const entry = () => ({
	...interval(),
	memberId: new Types.ObjectId(),
	trainerId: new Types.ObjectId(),
	programId: new Types.ObjectId(),
});

describe('Reservation Phase 1 foundation without a database', () => {
	it('defines exactly the approved statuses and fixed timezone', () => {
		expect(Object.values(ReservationStatus)).toEqual(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']);
		expect(RESERVATION_TIMEZONE).toBe('Asia/Seoul');
	});
	it.each(['2026-12-01', '2024-02-29', '2000-02-29', '0001-01-01', '0099-12-31', '9999-12-31'])(
		'accepts real calendar date %s',
		(reservationDate) => {
			expect(isReservationDate(reservationDate)).toBe(true);
			expect(() => assertReservation({ ...interval(), reservationDate })).not.toThrow();
		},
	);
	it.each([
		'2026-02-29',
		'1900-02-29',
		'2100-02-29',
		'2026-04-31',
		'2026-00-01',
		'2026-13-01',
		'2026-01-00',
		'2026-01-32',
		'0000-01-01',
		'26-01-01',
		'2026-1-01',
		'2026-01-1',
		'2026/01/01',
		' 2026-01-01',
		'2026-01-01 ',
		'2026-01-01\n',
		'2026-01-01T00:00:00Z',
		'',
		null,
		undefined,
		new Date('2026-01-01T00:00:00Z'),
	])('rejects invalid or non-string date %j', (reservationDate) => {
		expect(isReservationDate(reservationDate)).toBe(false);
		expect(() => assertReservation({ ...interval(), reservationDate })).toThrow(BadRequestException);
	});
	it.each(['9:00', '24:00', '25:00', '12:60', '09:00:00', ' 09:00', '09:00 ', '09:00\n', '', null, undefined, 900])(
		'rejects malformed start and end time %j',
		(time) => {
			expect(() => assertReservation({ ...interval(), startTime: time })).toThrow('HH:mm');
			expect(() => assertReservation({ ...interval(), endTime: time })).toThrow('HH:mm');
		},
	);
	it.each([
		['10:00', '10:00'],
		['18:00', '09:00'],
		['23:00', '00:30'],
	])('rejects non-increasing interval %s to %s', (startTime, endTime) => {
		expect(() => assertReservation({ ...interval(), startTime, endTime })).toThrow('before');
	});
	it('accepts boundary times and optional string requests without invented length limits', () => {
		expect(() => assertReservation({ ...interval(), startTime: '00:00', endTime: '23:59' })).not.toThrow();
		for (const specialRequest of [undefined, null, '', 'Please bring a mat.'])
			expect(() => assertReservation({ ...interval(), specialRequest })).not.toThrow();
		for (const specialRequest of [42, true, {}, []])
			expect(() => assertReservation({ ...interval(), specialRequest })).toThrow('string');
	});
	it('validates the Mongoose schema, required refs, optional request and status', async () => {
		const connection = createConnection();
		try {
			const reservations = connection.model<Reservation>('Reservation', ReservationSchema);
			const document = new reservations(entry());
			await expect(document.validate()).resolves.toBeUndefined();
			expect(document._id).toBeInstanceOf(Types.ObjectId);
			expect(document.reservationStatus).toBe(ReservationStatus.PENDING);
			expect(document.specialRequest).toBeUndefined();
			for (const specialRequest of ['', 'Bring a mat.', null])
				await expect(new reservations({ ...entry(), specialRequest }).validate()).resolves.toBeUndefined();
			for (const reservationStatus of Object.values(ReservationStatus))
				await expect(new reservations({ ...entry(), reservationStatus }).validate()).resolves.toBeUndefined();
			await expect(new reservations({ ...entry(), reservationStatus: 'OTHER' }).validate()).rejects.toThrow();
			await expect(new reservations({ ...entry(), reservationDate: '2026-02-30' }).validate()).rejects.toThrow(
				'calendar',
			);
			await expect(new reservations({ ...entry(), startTime: '10:00', endTime: '09:00' }).validate()).rejects.toThrow(
				'before',
			);
			await expect(new reservations({ ...entry(), endTime: '24:00' }).validate()).rejects.toThrow('HH:mm');
			for (const field of ['reservationDate', 'startTime', 'endTime', 'memberId', 'trainerId', 'programId'])
				await expect(new reservations({ ...entry(), [field]: undefined }).validate()).rejects.toThrow();
			for (const field of ['memberId', 'trainerId', 'programId'])
				await expect(new reservations({ ...entry(), [field]: 'invalid' }).validate()).rejects.toThrow();
		} finally {
			await connection.close();
		}
	});
	it('uses explicit refs, timestamps and only non-unique lookup indexes', () => {
		expect(ReservationSchema.options.collection).toBe('reservations');
		expect(ReservationSchema.options.timestamps).toBe(true);
		for (const [field, ref] of [
			['memberId', 'Member'],
			['trainerId', 'Member'],
			['programId', 'Program'],
		]) {
			expect(ReservationSchema.path(field).instance).toBe('ObjectId');
			expect(ReservationSchema.path(field).options).toMatchObject({ required: true, ref });
		}
		expect(ReservationSchema.indexes().map(([keys]) => keys)).toEqual([
			{ memberId: 1, reservationDate: 1 },
			{ trainerId: 1, reservationDate: 1 },
			{ programId: 1, reservationDate: 1, startTime: 1 },
		]);
		expect(ReservationSchema.indexes().every(([, options]) => !options.unique)).toBe(true);
		expect(ReservationSchema.path('createdAt').instance).toBe('Date');
		expect(ReservationSchema.path('updatedAt').instance).toBe('Date');
	});
	it('builds the minimal GraphQL output and enum without reservation operations', async () => {
		const module = await Test.createTestingModule({ imports: [GraphQLSchemaBuilderModule] }).compile();
		try {
			const schema = await module
				.get(GraphQLSchemaFactory)
				.create([], { orphanedTypes: [Reservation], skipCheck: true });
			const fields = (schema.getType('Reservation') as GraphQLObjectType).getFields();
			expect(Object.keys(fields)).toEqual([
				'_id',
				'reservationDate',
				'startTime',
				'endTime',
				'reservationStatus',
				'specialRequest',
				'memberId',
				'trainerId',
				'programId',
				'createdAt',
				'updatedAt',
			]);
			for (const field of ['_id', 'reservationDate', 'startTime', 'endTime', 'memberId', 'trainerId', 'programId'])
				expect(String(fields[field].type)).toBe('String!');
			expect(String(fields.specialRequest.type)).toBe('String');
			expect(String(fields.reservationStatus.type)).toBe('ReservationStatus!');
			expect(String(fields.createdAt.type)).toBe('DateTime!');
			expect(String(fields.updatedAt.type)).toBe('DateTime!');
			expect((schema.getType('ReservationStatus') as GraphQLEnumType).getValues().map((value) => value.name)).toEqual(
				Object.values(ReservationStatus),
			);
			expect(schema.getQueryType()).toBeUndefined();
			expect(schema.getMutationType()).toBeUndefined();
		} finally {
			await module.close();
		}
	});
});
