import 'reflect-metadata';
import { Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReservationInput } from '../src/libs/dto/reservation/reservation.input';
import { ProgramType } from '../src/libs/enums/program.enum';
import { TrainerScheduleDayOfWeek } from '../src/libs/enums/trainer-schedule.enum';
import { AvailabilityProgram, AvailabilitySchedule } from '../src/libs/availability';
import {
	assertReservationInput,
	assertFutureReservationStart,
	deriveReservationInterval,
	normalizeSpecialRequest,
} from '../src/libs/reservation.create.validation';

const input: ReservationInput = {
	programId: new Types.ObjectId().toHexString(),
	reservationDate: '2030-01-08',
	startTime: '09:00',
};
const program: AvailabilityProgram = {
	_id: new Types.ObjectId(),
	programType: ProgramType.PT_1ON1,
	programDuration: 60,
	programCapacity: 1,
};
const schedule: AvailabilitySchedule = {
	dayOfWeek: TrainerScheduleDayOfWeek.TUE,
	isAvailable: true,
	startTime: '09:00',
	endTime: '12:00',
};
const now = { reservationDate: '2030-01-07', time: '08:00' };

describe('Reservation create boundary', () => {
	it('accepts the minimal input and derives the end using current program duration', async () => {
		expect(() => assertReservationInput(input)).not.toThrow();
		expect(await validate(plainToInstance(ReservationInput, input))).toEqual([]);
		expect(deriveReservationInterval(input, program, schedule, now)).toEqual({ startTime: '09:00', endTime: '10:00' });
		expect(deriveReservationInterval(input, { ...program, programDuration: 40 }, schedule, now).endTime).toBe('09:40');
	});

	it.each(['invalid', '', '0'.repeat(23)])('rejects malformed program ID %j', (programId) => {
		expect(() => assertReservationInput({ ...input, programId })).toThrow(BadRequestException);
	});
	it.each(['2030-02-30', '2030-02-29', '2030-1-08', '2030-01-08\n', '0000-01-01'])(
		'rejects date %j',
		(reservationDate) => {
			expect(() => assertReservationInput({ ...input, reservationDate })).toThrow(BadRequestException);
		},
	);
	it.each(['24:00', '9:00', '09:60', '09:00 ', '09:00\n', ' 09:00'])('rejects time %j', (startTime) => {
		expect(() => assertReservationInput({ ...input, startTime })).toThrow(BadRequestException);
	});

	it('rejects past dates and today starts <= current Seoul minute', () => {
		expect(() => assertFutureReservationStart({ ...input, reservationDate: '2030-01-06' }, now)).toThrow(
			BadRequestException,
		);
		for (const time of ['09:00', '09:01', '12:00'])
			expect(() => assertFutureReservationStart(input, { reservationDate: input.reservationDate, time })).toThrow(
				ConflictException,
			);
		expect(() =>
			assertFutureReservationStart(input, { reservationDate: input.reservationDate, time: '08:59' }),
		).not.toThrow();
	});
	it.each(['08:00', '09:30', '12:00', '23:00'])('rejects non-grid/out-of-schedule start %s', (startTime) => {
		expect(() => deriveReservationInterval({ ...input, startTime }, program, schedule, now)).toThrow(ConflictException);
	});
	it('allows a touching schedule end, rejects trailing partial intervals and unavailable weekdays', () => {
		expect(deriveReservationInterval({ ...input, startTime: '11:00' }, program, schedule, now).endTime).toBe('12:00');
		expect(() => deriveReservationInterval(input, { ...program, programDuration: 181 }, schedule, now)).toThrow(
			ConflictException,
		);
		expect(() => deriveReservationInterval(input, program, { ...schedule, isAvailable: false }, now)).toThrow(
			ConflictException,
		);
	});
	it('does not move the duration grid to a convenient requested start', () => {
		const forty = { ...program, programDuration: 40 };
		const shifted = { ...schedule, startTime: '09:10' };
		expect(deriveReservationInterval({ ...input, startTime: '09:50' }, forty, shifted, now).endTime).toBe('10:30');
		expect(() => deriveReservationInterval({ ...input, startTime: '10:00' }, forty, shifted, now)).toThrow(
			ConflictException,
		);
	});
	it.each([
		{ ...program, programType: ProgramType.ONLINE },
		{ ...program, programDuration: 0 },
		{ ...program, programDuration: 1.5 },
		{ ...program, programDuration: 2147483648 },
		{ ...program, programCapacity: 2 },
		{ ...program, programType: ProgramType.GROUP_CLASS, programCapacity: 0 },
		{ ...program, programType: ProgramType.GROUP_CLASS, programCapacity: 1.5 },
	])('rejects invalid program booking configuration %#', (value) => {
		expect(() => deriveReservationInterval(input, value, schedule, now)).toThrow(BadRequestException);
	});
	it.each([undefined, null, '', '   ', '\n\t'])('omits absent/blank specialRequest %j', (value) => {
		expect(normalizeSpecialRequest(value)).toBeUndefined();
	});
	it('trims optional text and permits 500 characters', async () => {
		expect(normalizeSpecialRequest('  Please help  ')).toBe('Please help');
		expect(normalizeSpecialRequest('a'.repeat(500))).toHaveLength(500);
		for (const specialRequest of [undefined, null, '', 'a'.repeat(500)])
			expect(await validate(plainToInstance(ReservationInput, { ...input, specialRequest }))).toEqual([]);
	});
	it.each(['a'.repeat(501), 1, {}, []])('rejects invalid specialRequest %#', (specialRequest) => {
		expect(() => normalizeSpecialRequest(specialRequest)).toThrow(BadRequestException);
	});
	it('DTO rejects invalid IDs, dates, times and oversized optional text', async () => {
		for (const change of [
			{ programId: 'invalid' },
			{ reservationDate: '2030-1-08' },
			{ startTime: '24:00' },
			{ specialRequest: 'a'.repeat(501) },
		])
			expect(await validate(plainToInstance(ReservationInput, { ...input, ...change }))).not.toHaveLength(0);
	});
});
