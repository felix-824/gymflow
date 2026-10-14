import { BadRequestException } from '@nestjs/common';
import { RESERVATION_DATE_PATTERN, RESERVATION_TIME_PATTERN } from './enums/reservation.enum';

interface ReservationValues {
	reservationDate?: unknown;
	startTime?: unknown;
	endTime?: unknown;
	specialRequest?: unknown;
}

export function isReservationDate(value: unknown): boolean {
	if (typeof value !== 'string' || value.length !== 10 || !RESERVATION_DATE_PATTERN.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	if (year < 1 || month < 1 || month > 12) return false;
	const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	return day >= 1 && day <= daysInMonth[month - 1];
}

export function assertReservation(input: ReservationValues): void {
	if (!input || !isReservationDate(input.reservationDate))
		throw new BadRequestException('Reservation date must be a real calendar date in YYYY-MM-DD');
	if (
		typeof input.startTime !== 'string' ||
		input.startTime.length !== 5 ||
		!RESERVATION_TIME_PATTERN.test(input.startTime) ||
		typeof input.endTime !== 'string' ||
		input.endTime.length !== 5 ||
		!RESERVATION_TIME_PATTERN.test(input.endTime)
	)
		throw new BadRequestException('Reservation times must use strict 24-hour HH:mm');
	if (input.startTime >= input.endTime) throw new BadRequestException('Reservation startTime must be before endTime');
	if (input.specialRequest != null && typeof input.specialRequest !== 'string')
		throw new BadRequestException('Reservation specialRequest must be a string');
}
