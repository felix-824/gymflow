import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { TrainerReservationsInquiry } from '../../libs/dto/reservation/trainer-reservation.inquiry';
import { TrainerReservationUpdate } from '../../libs/dto/reservation/trainer-reservation.update';
import { TrainerReservations } from '../../libs/dto/reservation/trainer-reservations';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReservationTrainerService } from './reservation-trainer.service';

@Resolver()
export class ReservationTrainerResolver {
	constructor(private readonly reservationTrainerService: ReservationTrainerService) {}

	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Query(() => TrainerReservations)
	public async getTrainerReservations(
		@Args('input') input: TrainerReservationsInquiry,
		@AuthMember('_id') trainerId: Types.ObjectId,
	): Promise<TrainerReservations> {
		return await this.reservationTrainerService.getTrainerReservations(trainerId, input);
	}

	@Roles(MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Mutation(() => Reservation)
	public async updateTrainerReservation(
		@Args('input') input: TrainerReservationUpdate,
		@AuthMember('_id') trainerId: Types.ObjectId,
	): Promise<Reservation> {
		return await this.reservationTrainerService.updateTrainerReservation(trainerId, input);
	}
}
