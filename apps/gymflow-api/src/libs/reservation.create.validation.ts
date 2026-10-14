import { BadRequestException, ConflictException } from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { ReservationInput } from './dto/reservation/reservation.input';
import type { AvailabilityProgram, AvailabilitySchedule, SeoulDateTime } from './availability';
import { assertAvailabilityDate } from './availability';
import { ProgramType } from './enums/program.enum';
import { RESERVATION_TIME_PATTERN } from './enums/reservation.enum';
import { isReservationDate, assertReservation } from './reservation.validation';
import { assertTrainerScheduleDay } from './trainer-schedule.validation';

export function normalizeSpecialRequest(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== 'string' || value.length > 500)
		throw new BadRequestException('Special request must be a string of at most 500 characters');
	return value.trim() || undefined;
}

export function assertReservationInput(input: ReservationInput): void {
	if (!input || typeof input.programId !== 'string' || !isMongoId(input.programId))
		throw new BadRequestException('Invalid program ID');
	if (!isReservationDate(input.reservationDate))
		throw new BadRequestException('Reservation date must be a real calendar date in YYYY-MM-DD');
	if (
		typeof input.startTime !== 'string' ||
		input.startTime.length !== 5 ||
		!RESERVATION_TIME_PATTERN.test(input.startTime)
	)
		throw new BadRequestException('Reservation startTime must use strict 24-hour HH:mm');
	normalizeSpecialRequest(input.specialRequest);
}

export function assertFutureReservationStart(input: ReservationInput, now: SeoulDateTime): void {
	assertAvailabilityDate(input.reservationDate, now);
	if (input.reservationDate === now.reservationDate && input.startTime <= now.time)
		throw new ConflictException('Reservation start must still be in the future');
}

export function deriveReservationInterval(
	input: ReservationInput,
	program: AvailabilityProgram,
	schedule: AvailabilitySchedule,
	now: SeoulDateTime,
): { startTime: string; endTime: string } {
	if (program.programType !== ProgramType.PT_1ON1 && program.programType !== ProgramType.GROUP_CLASS)
		throw new BadRequestException('Only PT_1ON1 and GROUP_CLASS programs can be reserved');
	if (
		!Number.isSafeInteger(program.programDuration) ||
		program.programDuration < 1 ||
		program.programDuration > 2147483647 ||
		!Number.isSafeInteger(program.programCapacity) ||
		program.programCapacity < 1 ||
		program.programCapacity > 2147483647 ||
		(program.programType === ProgramType.PT_1ON1 && program.programCapacity !== 1)
	)
		throw new BadRequestException('Invalid program booking configuration');
	assertFutureReservationStart(input, now);
	if (!schedule.isAvailable) throw new ConflictException('Trainer is unavailable on this weekday');
	assertTrainerScheduleDay(schedule);
	const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
	const start = minutes(input.startTime);
	const scheduleStart = minutes(schedule.startTime!);
	const end = start + program.programDuration;
	if (
		start < scheduleStart ||
		(start - scheduleStart) % program.programDuration !== 0 ||
		end > minutes(schedule.endTime!)
	)
		throw new ConflictException('Requested slot does not match the current trainer schedule');
	const endTime =
		Math.floor(end / 60)
			.toString()
			.padStart(2, '0') +
		':' +
		(end % 60).toString().padStart(2, '0');
	assertReservation({ reservationDate: input.reservationDate, startTime: input.startTime, endTime });
	return { startTime: input.startTime, endTime };
}
