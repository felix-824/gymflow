import 'reflect-metadata';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { TrainerReservationsInquiry } from '../src/libs/dto/reservation/trainer-reservation.inquiry';
import { TrainerReservationUpdate } from '../src/libs/dto/reservation/trainer-reservation.update';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { ReservationPeriod } from '../src/libs/enums/reservation-query.enum';
import {
	assertTrainerReservationsInquiry,
	assertTrainerReservationUpdate,
	assertTrainerReservationTransition,
	trainerReservationsMatch,
} from '../src/libs/reservation-trainer.validation';
import { myReservationsMatch } from '../src/libs/reservation-user.validation';
import { getSeoulDateTime } from '../src/libs/availability';

const statuses = Object.values(ReservationStatus);
const day = '2030-01-08';
const interval = { reservationDate: day, startTime: '10:00', endTime: '11:00' };
const inquiry = { page: 1, limit: 10, search: {} };
const windows = ['09:59', '10:00', '10:30', '11:00', '11:01'];
const matrix = statuses.flatMap((from) => statuses.flatMap((to) => windows.map((time) => ({ from, to, time }))));

describe('TRAINER reservation validation and frozen lifecycle', () => {
	it.each(matrix)('$from -> $to at $time', ({ from, to, time }) => {
		const edge = from + ':' + to;
		const futureEdges = ['PENDING:CONFIRMED', 'PENDING:CANCELLED', 'CONFIRMED:CANCELLED'];
		const endedEdges = ['CONFIRMED:COMPLETED', 'CONFIRMED:NO_SHOW'];
		const allowed = (futureEdges.includes(edge) && time < '10:00') || (endedEdges.includes(edge) && time >= '11:00');
		const action = () =>
			assertTrainerReservationTransition({ ...interval, reservationStatus: from }, to, {
				reservationDate: day,
				time,
			});
		if (allowed) expect(action).not.toThrow();
		else expect(action).toThrow(ConflictException);
	});
	it.each([1, 100])('accepts inherited pagination with limit %s', async (limit) => {
		const input = plainToInstance(TrainerReservationsInquiry, { ...inquiry, limit });
		expect(await validate(input)).toEqual([]);
		expect(() => assertTrainerReservationsInquiry(input)).not.toThrow();
	});
	it.each([
		{ page: 0 },
		{ page: -1 },
		{ page: 1.5 },
		{ limit: 0 },
		{ limit: -1 },
		{ limit: 101 },
		{ limit: 1.5 },
		{ search: null },
		{ search: [] },
		{ search: { period: 'ALL' } },
		{ search: { reservationStatus: 'EXPIRED' } },
		{ search: { programId: 'not-an-id' } },
	])('rejects malformed inquiry %# through DTO and service validation', async (change) => {
		const input = plainToInstance(TrainerReservationsInquiry, { ...inquiry, ...change });
		expect(await validate(input)).not.toHaveLength(0);
		expect(() => assertTrainerReservationsInquiry(input)).toThrow(BadRequestException);
	});
	it.each([undefined, null, ...statuses])(
		'validates update target %s without introducing a status enum',
		async (status) => {
			const input = plainToInstance(TrainerReservationUpdate, {
				_id: new Types.ObjectId().toHexString(),
				reservationStatus: status,
			});
			if (status == null) {
				expect(await validate(input)).not.toHaveLength(0);
				expect(() => assertTrainerReservationUpdate(input)).toThrow(BadRequestException);
			} else {
				expect(await validate(input)).toEqual([]);
				expect(() => assertTrainerReservationUpdate(input)).not.toThrow();
			}
		},
	);
	it.each(['invalid', '', null, undefined, 12])('rejects malformed reservation ID %j', async (_id) => {
		const input = plainToInstance(TrainerReservationUpdate, { _id, reservationStatus: ReservationStatus.CONFIRMED });
		expect(await validate(input)).not.toHaveLength(0);
		expect(() => assertTrainerReservationUpdate(input)).toThrow(BadRequestException);
	});
	it('rejects absent updates and unknown status values', () => {
		for (const input of [null, {}, { _id: new Types.ObjectId().toHexString(), reservationStatus: 'EXPIRED' }])
			expect(() => assertTrainerReservationUpdate(input as TrainerReservationUpdate)).toThrow(BadRequestException);
	});
	it.each(
		[undefined, ...Object.values(ReservationPeriod)].flatMap((period) =>
			statuses.map((reservationStatus) => ({ period, reservationStatus })),
		),
	)(
		'reuses USER period semantics for $period / $reservationStatus with trainer ownership',
		({ period, reservationStatus }) => {
			const trainerId = new Types.ObjectId();
			const input = { ...inquiry, search: { period, reservationStatus } };
			const now = { reservationDate: day, time: '10:30' };
			const userMatch = myReservationsMatch(trainerId, input, now);
			delete userMatch.memberId;
			expect(trainerReservationsMatch(trainerId, input, now)).toEqual({ ...userMatch, trainerId });
		},
	);
	it('intersects a valid program filter without replacing trainer ownership', async () => {
		const trainerId = new Types.ObjectId(),
			programId = new Types.ObjectId();
		const input = plainToInstance(TrainerReservationsInquiry, {
			...inquiry,
			search: {
				programId: programId.toHexString(),
				period: ReservationPeriod.UPCOMING,
				reservationStatus: ReservationStatus.CONFIRMED,
			},
		});
		expect(await validate(input)).toEqual([]);
		const match = trainerReservationsMatch(trainerId, input, { reservationDate: day, time: '09:00' });
		expect(match).toMatchObject({ trainerId, programId, reservationStatus: ReservationStatus.CONFIRMED });
		expect(match.$and).toBeDefined();
	});
	it.each([
		['2030-01-07T15:00:00Z', '2030-01-08', '00:00'],
		['2030-12-31T15:00:00Z', '2031-01-01', '00:00'],
		['2032-02-28T15:00:00Z', '2032-02-29', '00:00'],
	])('uses the existing Seoul calendar at %s', (instant, reservationDate, time) => {
		expect(getSeoulDateTime(new Date(instant))).toEqual({ reservationDate, time });
	});
	it('compares dates before clocks and never transitions an overdue PENDING', () => {
		const now = { reservationDate: day, time: '23:59' };
		expect(() =>
			assertTrainerReservationTransition(
				{
					reservationDate: '2030-01-09',
					startTime: '00:01',
					endTime: '01:01',
					reservationStatus: ReservationStatus.PENDING,
				},
				ReservationStatus.CONFIRMED,
				now,
			),
		).not.toThrow();
		for (const target of statuses)
			expect(() =>
				assertTrainerReservationTransition(
					{ ...interval, reservationDate: '2030-01-07', reservationStatus: ReservationStatus.PENDING },
					target,
					now,
				),
			).toThrow(ConflictException);
		for (const target of [ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])
			expect(() =>
				assertTrainerReservationTransition(
					{ ...interval, reservationDate: '2030-01-07', reservationStatus: ReservationStatus.CONFIRMED },
					target,
					{ reservationDate: day, time: '00:00' },
				),
			).not.toThrow();
	});
});
