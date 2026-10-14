import { BadRequestException, ConflictException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import { ReservationsInquiry } from './dto/reservation/reservation.inquiry';
import { Reservation } from './dto/reservation/reservation';
import { ReservationStatus } from './enums/reservation.enum';
import { ReservationPeriod } from './enums/reservation-query.enum';
import { capacityOccupyingStatuses, SeoulDateTime } from './availability';

export function assertReservationsInquiry(input: ReservationsInquiry): void {
	if (
		!input ||
		!Number.isSafeInteger(input.page) ||
		input.page < 1 ||
		!Number.isSafeInteger(input.limit) ||
		input.limit < 1 ||
		input.limit > 100 ||
		!input.search ||
		typeof input.search !== 'object' ||
		Array.isArray(input.search)
	)
		throw new BadRequestException('Provide valid page, limit (1-100) and reservation search');
	if (
		input.search.reservationStatus != null &&
		!Object.values(ReservationStatus).includes(input.search.reservationStatus)
	)
		throw new BadRequestException('Invalid reservation status');
	if (input.search.period != null && !Object.values(ReservationPeriod).includes(input.search.period))
		throw new BadRequestException('Invalid reservation period');
}

export function futureReservationStart(now: SeoulDateTime): FilterQuery<Reservation> {
	return {
		$or: [
			{ reservationDate: { $gt: now.reservationDate } },
			{ reservationDate: now.reservationDate, startTime: { $gt: now.time } },
		],
	};
}

export function assertUserCancellation(
	reservation: Pick<Reservation, 'reservationStatus' | 'reservationDate' | 'startTime'>,
	now: SeoulDateTime,
): void {
	if (!capacityOccupyingStatuses.includes(reservation.reservationStatus))
		throw new ConflictException('Only pending or confirmed reservations can be cancelled');
	if (
		reservation.reservationDate < now.reservationDate ||
		(reservation.reservationDate === now.reservationDate && reservation.startTime <= now.time)
	)
		throw new ConflictException('A reservation can only be cancelled before it starts');
}

export function myReservationsMatch(
	memberId: Types.ObjectId,
	input: ReservationsInquiry,
	now: SeoulDateTime,
): FilterQuery<Reservation> {
	const match: FilterQuery<Reservation> = { memberId };
	if (input.search.reservationStatus != null) match.reservationStatus = input.search.reservationStatus;
	if (input.search.period === ReservationPeriod.UPCOMING) {
		match.$and = [
			{ reservationStatus: { $in: capacityOccupyingStatuses } },
			{
				$or: [
					{ reservationDate: { $gt: now.reservationDate } },
					{ reservationDate: now.reservationDate, endTime: { $gt: now.time } },
				],
			},
		];
	} else if (input.search.period === ReservationPeriod.HISTORY) {
		match.$and = [
			{
				$or: [
					{
						reservationStatus: {
							$in: [ReservationStatus.CANCELLED, ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW],
						},
					},
					{
						reservationStatus: { $in: capacityOccupyingStatuses },
						$or: [
							{ reservationDate: { $lt: now.reservationDate } },
							{ reservationDate: now.reservationDate, endTime: { $lte: now.time } },
						],
					},
				],
			},
		];
	}
	return match;
}
