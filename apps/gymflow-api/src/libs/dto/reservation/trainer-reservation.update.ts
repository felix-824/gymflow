import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsMongoId } from 'class-validator';
import { ReservationStatus } from '../../enums/reservation.enum';

@InputType()
export class TrainerReservationUpdate {
	@IsMongoId()
	@Field(() => String)
	_id: string;

	@IsEnum(ReservationStatus)
	@Field(() => ReservationStatus)
	reservationStatus: ReservationStatus;
}
