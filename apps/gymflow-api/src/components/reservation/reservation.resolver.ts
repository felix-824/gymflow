import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { ReservationInput } from '../../libs/dto/reservation/reservation.input';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { MemberType } from '../../libs/enums/member.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ReservationService } from './reservation.service';

@Resolver()
export class ReservationResolver {
	constructor(private readonly reservationService: ReservationService) {}

	@Roles(MemberType.USER)
	@UseGuards(RolesGuard)
	@Mutation(() => Reservation)
	public async createReservation(
		@Args('input') input: ReservationInput,
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<Reservation> {
		return await this.reservationService.createReservation(memberId, input);
	}
}
