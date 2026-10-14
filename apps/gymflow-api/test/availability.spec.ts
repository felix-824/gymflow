import 'reflect-metadata';
import { Types } from 'mongoose';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProgramAvailabilityInquiry } from '../src/libs/dto/availability/availability.input';
import {
	AvailabilityProgram,
	AvailabilityReservation,
	AvailabilitySchedule,
	SeoulDateTime,
	assertAvailabilityDate,
	findAvailableSlots,
	getAvailabilityWeekday,
	getSeoulDateTime,
	intervalsOverlap,
} from '../src/libs/availability';
import { ProgramType } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { TrainerScheduleDayOfWeek } from '../src/libs/enums/trainer-schedule.enum';

const date = '2030-01-08';
const now: SeoulDateTime = { reservationDate: '2030-01-07', time: '08:00' };
const program = (type = ProgramType.PT_1ON1, capacity = 1, duration = 60): AvailabilityProgram => ({
	_id: new Types.ObjectId(),
	programType: type,
	programCapacity: capacity,
	programDuration: duration,
});
const hours = (startTime = '09:00', endTime = '12:00'): AvailabilitySchedule => ({
	dayOfWeek: TrainerScheduleDayOfWeek.TUE,
	isAvailable: true,
	startTime,
	endTime,
});
const reservation = (
	p: AvailabilityProgram,
	status = ReservationStatus.PENDING,
	startTime = '09:00',
	endTime = '10:00',
): AvailabilityReservation => ({
	programId: p._id,
	reservationDate: date,
	reservationStatus: status,
	startTime,
	endTime,
});
const expected = [
	{ startTime: '09:00', endTime: '10:00' },
	{ startTime: '10:00', endTime: '11:00' },
	{ startTime: '11:00', endTime: '12:00' },
];

describe('Availability pure date/time and slot rules', () => {
	it('returns no slots for missing or unavailable weekdays', () => {
		const p = program();
		expect(findAvailableSlots(p, undefined, date, [], now)).toEqual([]);
		expect(findAvailableSlots(p, { ...hours(), isAvailable: false }, date, [], now)).toEqual([]);
	});
	it('generates exact-fit slots, removes trailing partial slots and returns ascending times', () => {
		expect(findAvailableSlots(program(), hours(), date, [], now)).toEqual(expected);
		expect(findAvailableSlots(program(), hours('09:00', '12:30'), date, [], now)).toEqual(expected);
		expect(findAvailableSlots(program(ProgramType.PT_1ON1, 1, 181), hours(), date, [], now)).toEqual([]);
		expect(findAvailableSlots(program(ProgramType.PT_1ON1, 1, 40), hours('09:10', '11:00'), date, [], now)).toEqual([
			{ startTime: '09:10', endTime: '09:50' },
			{ startTime: '09:50', endTime: '10:30' },
		]);
	});
	it.each([ReservationStatus.PENDING, ReservationStatus.CONFIRMED])(
		'PT ignores no occupied time: %s blocks without shifting the grid',
		(status) => {
			const p = program();
			expect(findAvailableSlots(p, hours(), date, [reservation(p, status, '09:30', '10:15')], now)).toEqual([
				expected[2],
			]);
		},
	);
	it.each([ReservationStatus.CANCELLED, ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW])(
		'%s does not block PT or groups',
		(status) => {
			for (const p of [program(), program(ProgramType.GROUP_CLASS, 1)])
				expect(findAvailableSlots(p, hours(), date, [reservation(p, status)], now)).toEqual(expected);
		},
	);
	it('blocks another program and allows touching interval boundaries', () => {
		const p = program();
		expect(findAvailableSlots(p, hours(), date, [reservation(program())], now)).toEqual(expected.slice(1));
		expect(
			findAvailableSlots(p, hours(), date, [reservation(p, ReservationStatus.PENDING, '10:00', '11:00')], now),
		).toEqual([expected[0], expected[2]]);
		expect(intervalsOverlap(expected[0], expected[1])).toBe(false);
	});
	it.each([0, 2, 3, 4])('GROUP counts exact-session documents, occupancy %s against capacity 3', (occupancy) => {
		const p = program(ProgramType.GROUP_CLASS, 3);
		const rows = Array.from({ length: occupancy }, (_, index) =>
			reservation(p, index % 2 ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING),
		);
		expect(findAvailableSlots(p, hours(), date, rows, now)).toEqual(occupancy < 3 ? expected : expected.slice(1));
	});
	it('blocks different overlapping group sessions even for the same program', () => {
		const p = program(ProgramType.GROUP_CLASS, 5);
		expect(
			findAvailableSlots(p, hours(), date, [reservation(p, ReservationStatus.PENDING, '09:30', '10:30')], now),
		).toEqual([expected[2]]);
		expect(findAvailableSlots(p, hours(), date, [reservation(program(ProgramType.GROUP_CLASS, 5))], now)).toEqual(
			expected.slice(1),
		);
	});
	it('does not count another date and never books ONLINE', () => {
		const p = program();
		expect(findAvailableSlots(p, hours(), date, [{ ...reservation(p), reservationDate: '2030-01-09' }], now)).toEqual(
			expected,
		);
		expect(findAvailableSlots(program(ProgramType.ONLINE, 10), hours(), date, [], now)).toEqual([]);
	});
	it('rejects corrupt durations/capacities rather than generating an unbounded grid', () => {
		for (const p of [
			program(ProgramType.PT_1ON1, 1, 0),
			program(ProgramType.PT_1ON1, 2),
			program(ProgramType.GROUP_CLASS, 0),
		])
			expect(() => findAvailableSlots(p, hours(), date, [], now)).toThrow(BadRequestException);
	});
	it.each([
		'2030-02-29',
		'2030-04-31',
		'2030-1-08',
		'2030-01-08\n',
		'2030-00-08',
		'0000-01-01',
		'2030-01-08T00:00:00Z',
	])('rejects malformed/impossible date %j', (value) => {
		expect(() => assertAvailabilityDate(value, now)).toThrow(BadRequestException);
		expect(() => getAvailabilityWeekday(value)).toThrow(BadRequestException);
	});
	it('rejects past Seoul dates and accepts today/future dates', () => {
		expect(() => assertAvailabilityDate('2030-01-06', now)).toThrow('past');
		expect(() => assertAvailabilityDate(now.reservationDate, now)).not.toThrow();
		expect(() => assertAvailabilityDate(date, now)).not.toThrow();
	});
	it.each([
		['2030-01-06', TrainerScheduleDayOfWeek.SUN],
		['2030-01-07', TrainerScheduleDayOfWeek.MON],
		['2029-12-31', TrainerScheduleDayOfWeek.MON],
		['2030-01-01', TrainerScheduleDayOfWeek.TUE],
		['2024-02-29', TrainerScheduleDayOfWeek.THU],
		['2024-03-01', TrainerScheduleDayOfWeek.FRI],
		['0001-01-01', TrainerScheduleDayOfWeek.MON],
	])('maps calendar boundary %s to %s', (value, weekday) => {
		expect(getAvailabilityWeekday(value)).toBe(weekday);
	});
	it.each([
		['2030-01-06T23:59:59.999Z', 3],
		['2030-01-07T00:00:00.000Z', 2],
		['2030-01-07T00:00:00.001Z', 2],
		['2030-01-07T00:30:00.000Z', 2],
		['2030-01-07T03:00:00.000Z', 0],
	])('filters passed/equal starts today at %s', (instant, count) => {
		const seoul = getSeoulDateTime(new Date(instant));
		expect(findAvailableSlots(program(), hours(), seoul.reservationDate, [], seoul)).toHaveLength(count);
	});
	it('uses Seoul midnight rather than UTC/server-local date, under different server timezones', () => {
		const previous = process.env.TZ;
		try {
			for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Honolulu']) {
				process.env.TZ = timezone;
				expect(getSeoulDateTime(new Date('2030-01-06T15:00:00Z'))).toEqual({
					reservationDate: '2030-01-07',
					time: '00:00',
				});
				expect(getAvailabilityWeekday('2030-01-07')).toBe(TrainerScheduleDayOfWeek.MON);
			}
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});
	it('validates the minimal inquiry DTO', async () => {
		const input = { programId: new Types.ObjectId().toHexString(), reservationDate: date };
		expect(await validate(plainToInstance(ProgramAvailabilityInquiry, input))).toHaveLength(0);
		expect(
			await validate(plainToInstance(ProgramAvailabilityInquiry, { ...input, programId: 'invalid' })),
		).not.toHaveLength(0);
		expect(
			await validate(plainToInstance(ProgramAvailabilityInquiry, { ...input, reservationDate: '2030-1-08' })),
		).not.toHaveLength(0);
	});
});
