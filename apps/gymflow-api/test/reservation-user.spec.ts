import 'reflect-metadata';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservationsInquiry } from '../src/libs/dto/reservation/reservation.inquiry';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { ReservationPeriod } from '../src/libs/enums/reservation-query.enum';
import {
	assertReservationsInquiry,
	assertUserCancellation,
	myReservationsMatch,
} from '../src/libs/reservation-user.validation';
import { getSeoulDateTime } from '../src/libs/availability';

const now = { reservationDate: '2030-01-08', time: '09:00' };
const inquiry = { page: 1, limit: 10, search: {} };
const reservation = { reservationStatus: ReservationStatus.PENDING, reservationDate: '2030-01-08', startTime: '10:00' };

describe('USER reservation boundary', () => {
	it.each([1, 100])('accepts inherited positive pagination with limit %s', async (limit) => {
		const input = plainToInstance(ReservationsInquiry, { ...inquiry, limit });
		expect(await validate(input)).toEqual([]);
		expect(() => assertReservationsInquiry(input)).not.toThrow();
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
	])('rejects malformed inquiry %#', async (change) => {
		const input = plainToInstance(ReservationsInquiry, { ...inquiry, ...change });
		expect(() => assertReservationsInquiry(input)).toThrow(BadRequestException);
		expect(await validate(input)).not.toHaveLength(0);
	});
	it.each(Object.values(ReservationStatus))('accepts real status %s', async (reservationStatus) => {
		const input = plainToInstance(ReservationsInquiry, { ...inquiry, search: { reservationStatus } });
		expect(await validate(input)).toEqual([]);
		expect(() => assertReservationsInquiry(input)).not.toThrow();
	});
	it.each(Object.values(ReservationPeriod))('accepts period %s and intersects with status', async (period) => {
		const input = plainToInstance(ReservationsInquiry, {
			...inquiry,
			search: { period, reservationStatus: ReservationStatus.CONFIRMED },
		});
		expect(await validate(input)).toEqual([]);
		const memberId = new Types.ObjectId();
		const match = myReservationsMatch(memberId, input, now);
		expect(match.memberId).toEqual(memberId);
		expect(match.reservationStatus).toBe(ReservationStatus.CONFIRMED);
	});
	it.each([ReservationStatus.PENDING, ReservationStatus.CONFIRMED])(
		'allows future %s cancellation',
		(reservationStatus) => {
			expect(() => assertUserCancellation({ ...reservation, reservationStatus }, now)).not.toThrow();
		},
	);
	it.each([ReservationStatus.CANCELLED, ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])(
		'rejects terminal %s',
		(reservationStatus) => {
			expect(() => assertUserCancellation({ ...reservation, reservationStatus }, now)).toThrow(ConflictException);
		},
	);
	it.each([
		{ reservationDate: '2030-01-07', startTime: '23:00' },
		{ reservationDate: '2030-01-08', startTime: '08:59' },
		{ reservationDate: '2030-01-08', startTime: '09:00' },
	])('rejects past/started/exact-start reservation %#', (change) => {
		expect(() => assertUserCancellation({ ...reservation, ...change }, now)).toThrow(ConflictException);
	});
	it('allows tomorrow even when its start clock is earlier than the current clock', () => {
		expect(() =>
			assertUserCancellation({ ...reservation, reservationDate: '2030-01-09', startTime: '00:01' }, now),
		).not.toThrow();
	});
	it('uses Seoul midnight and allows only strictly later starts', () => {
		const seoul = getSeoulDateTime(new Date('2030-01-07T15:00:00Z'));
		expect(seoul).toEqual({ reservationDate: '2030-01-08', time: '00:00' });
		expect(() => assertUserCancellation({ ...reservation, startTime: '00:00' }, seoul)).toThrow(ConflictException);
		expect(() => assertUserCancellation({ ...reservation, startTime: '00:01' }, seoul)).not.toThrow();
	});
});
