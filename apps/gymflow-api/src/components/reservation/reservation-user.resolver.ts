import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { ReservationsInquiry } from '../../libs/dto/reservation/reservation.inquiry';
import { MyReservations } from '../../libs/dto/reservation/my-reservations';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { MemberType } from '../../libs/enums/member.enum';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReservationUserService } from './reservation-user.service';

@Resolver()
export class ReservationUserResolver {
	constructor(private readonly reservationUserService: ReservationUserService) {}

	@Roles(MemberType.USER, MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Query(() => MyReservations)
	public async getMyReservations(
		@Args('input') input: ReservationsInquiry,
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<MyReservations> {
		return await this.reservationUserService.getMyReservations(memberId, input);
	}

	@Roles(MemberType.USER, MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Mutation(() => Reservation)
	public async cancelReservation(
		@Args('reservationId') reservationId: string,
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<Reservation> {
		return await this.reservationUserService.cancelReservation(memberId, shapeIntoMongoObjectId(reservationId));
	}
}
