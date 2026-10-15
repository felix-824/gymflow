import { BadRequestException, ConflictException } from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { FilterQuery, Types } from 'mongoose';
import { TrainerReservationsInquiry } from './dto/reservation/trainer-reservation.inquiry';
import { TrainerReservationUpdate } from './dto/reservation/trainer-reservation.update';
import { Reservation } from './dto/reservation/reservation';
import { ReservationStatus } from './enums/reservation.enum';
import { ReservationPeriod } from './enums/reservation-query.enum';
import { capacityOccupyingStatuses, SeoulDateTime } from './availability';
import { assertReservationsInquiry, futureReservationStart } from './reservation-user.validation';

export function assertTrainerReservationsInquiry(input: TrainerReservationsInquiry): void {
	assertReservationsInquiry(input);
	if (input.search.programId != null && !isMongoId(input.search.programId))
		throw new BadRequestException('Invalid program ID');
}

export function assertTrainerReservationUpdate(input: TrainerReservationUpdate): void {
	if (!input || typeof input._id !== 'string' || !isMongoId(input._id))
		throw new BadRequestException('Invalid identifier');
	if (!Object.values(ReservationStatus).includes(input.reservationStatus))
		throw new BadRequestException('Invalid reservation status');
}

export function trainerReservationsMatch(
	trainerId: Types.ObjectId,
	input: TrainerReservationsInquiry,
	now: SeoulDateTime,
): FilterQuery<Reservation> {
	const match: FilterQuery<Reservation> = { trainerId };
	if (input.search.programId != null) match.programId = new Types.ObjectId(input.search.programId);
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

export function trainerTransitionTimeMatch(status: ReservationStatus, now: SeoulDateTime): FilterQuery<Reservation> {
	if (status === ReservationStatus.CONFIRMED || status === ReservationStatus.CANCELLED)
		return futureReservationStart(now);
	return {
		$or: [
			{ reservationDate: { $lt: now.reservationDate } },
			{ reservationDate: now.reservationDate, endTime: { $lte: now.time } },
		],
	};
}

export function assertTrainerReservationTransition(
	reservation: Pick<Reservation, 'reservationStatus' | 'reservationDate' | 'startTime' | 'endTime'>,
	status: ReservationStatus,
	now: SeoulDateTime,
): void {
	const current = reservation.reservationStatus;
	const beforeStart =
		reservation.reservationDate > now.reservationDate ||
		(reservation.reservationDate === now.reservationDate && reservation.startTime > now.time);
	const ended =
		reservation.reservationDate < now.reservationDate ||
		(reservation.reservationDate === now.reservationDate && reservation.endTime <= now.time);
	if (current === ReservationStatus.PENDING && status === ReservationStatus.CONFIRMED && beforeStart) return;
	if (capacityOccupyingStatuses.includes(current) && status === ReservationStatus.CANCELLED && beforeStart) return;
	if (
		current === ReservationStatus.CONFIRMED &&
		[ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW].includes(status) &&
		ended
	)
		return;
	throw new ConflictException('Reservation transition is not allowed for its current status or session time');
}
