import { BadRequestException } from '@nestjs/common';
import { AvailableSlot } from './dto/availability/availability';
import type { Program } from './dto/program/program';
import type { Reservation } from './dto/reservation/reservation';
import type { TrainerSchedule } from './dto/trainer-schedule/trainer-schedule';
import { ProgramType } from './enums/program.enum';
import { ReservationStatus, RESERVATION_TIMEZONE } from './enums/reservation.enum';
import { TrainerScheduleDayOfWeek } from './enums/trainer-schedule.enum';
import { isReservationDate } from './reservation.validation';
import { assertTrainerScheduleDay } from './trainer-schedule.validation';

export type AvailabilityProgram = Pick<Program, '_id' | 'programType' | 'programDuration' | 'programCapacity'>;
export type AvailabilityReservation = Pick<
	Reservation,
	'programId' | 'reservationDate' | 'startTime' | 'endTime' | 'reservationStatus'
>;
export type AvailabilitySchedule = Pick<TrainerSchedule, 'dayOfWeek' | 'isAvailable' | 'startTime' | 'endTime'>;
export interface SeoulDateTime {
	reservationDate: string;
	time: string;
}

export const capacityOccupyingStatuses = [ReservationStatus.PENDING, ReservationStatus.CONFIRMED];
const seoulFormatter = new Intl.DateTimeFormat('en-GB', {
	timeZone: RESERVATION_TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23',
});

export function getSeoulDateTime(now: Date): SeoulDateTime {
	const parts = Object.fromEntries(seoulFormatter.formatToParts(now).map(({ type, value }) => [type, value]));
	return {
		reservationDate: `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`,
		time: `${parts.hour}:${parts.minute}`,
	};
}

export function assertAvailabilityDate(reservationDate: string, now: SeoulDateTime): void {
	if (!isReservationDate(reservationDate))
		throw new BadRequestException('Reservation date must be a real calendar date in YYYY-MM-DD');
	if (reservationDate < now.reservationDate) throw new BadRequestException('Reservation date must not be in the past');
}

export function getAvailabilityWeekday(reservationDate: string): TrainerScheduleDayOfWeek {
	if (!isReservationDate(reservationDate)) throw new BadRequestException('Invalid reservation date');
	// UTC is only a date-only calendar carrier; stored Seoul booking times are not converted.
	const day = new Date(reservationDate + 'T00:00:00.000Z').getUTCDay();
	return [
		TrainerScheduleDayOfWeek.SUN,
		TrainerScheduleDayOfWeek.MON,
		TrainerScheduleDayOfWeek.TUE,
		TrainerScheduleDayOfWeek.WED,
		TrainerScheduleDayOfWeek.THU,
		TrainerScheduleDayOfWeek.FRI,
		TrainerScheduleDayOfWeek.SAT,
	][day];
}

function toMinutes(time: string): number {
	const [hour, minute] = time.split(':').map(Number);
	return hour * 60 + minute;
}
function toTime(minutes: number): string {
	return `${Math.floor(minutes / 60)
		.toString()
		.padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`;
}
export function intervalsOverlap(left: AvailableSlot, right: AvailableSlot): boolean {
	return left.startTime < right.endTime && left.endTime > right.startTime;
}

export function findAvailableSlots(
	program: AvailabilityProgram,
	schedule: AvailabilitySchedule | undefined,
	reservationDate: string,
	reservations: AvailabilityReservation[],
	now: SeoulDateTime,
): AvailableSlot[] {
	if (program.programType !== ProgramType.PT_1ON1 && program.programType !== ProgramType.GROUP_CLASS) return [];
	if (!schedule || !schedule.isAvailable) return [];
	assertTrainerScheduleDay(schedule);
	const duration = program.programDuration;
	const capacity = program.programCapacity;
	if (
		!Number.isSafeInteger(duration) ||
		duration < 1 ||
		!Number.isSafeInteger(capacity) ||
		capacity < 1 ||
		(program.programType === ProgramType.PT_1ON1 && capacity !== 1)
	)
		throw new BadRequestException('Invalid program booking configuration');
	const programId = program._id.toString();
	const occupied = reservations.filter(
		(reservation) =>
			reservation.reservationDate === reservationDate &&
			capacityOccupyingStatuses.includes(reservation.reservationStatus),
	);
	const result: AvailableSlot[] = [];
	const end = toMinutes(schedule.endTime!);
	for (let start = toMinutes(schedule.startTime!); start + duration <= end; start += duration) {
		const slot = { startTime: toTime(start), endTime: toTime(start + duration) };
		if (reservationDate === now.reservationDate && slot.startTime <= now.time) continue;
		const overlapping = occupied.filter((reservation) => intervalsOverlap(reservation, slot));
		if (program.programType === ProgramType.PT_1ON1 && overlapping.length) continue;
		if (program.programType === ProgramType.GROUP_CLASS) {
			const sameSession = (reservation: AvailabilityReservation) =>
				reservation.programId.toString() === programId &&
				reservation.startTime === slot.startTime &&
				reservation.endTime === slot.endTime;
			if (overlapping.some((reservation) => !sameSession(reservation)) || overlapping.length >= capacity) continue;
		}
		result.push(slot);
	}
	return result;
}
