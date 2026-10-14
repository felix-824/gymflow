import { Field, InputType } from '@nestjs/graphql';
import { IsMongoId, IsOptional, IsString, Length, Matches } from 'class-validator';
import { RESERVATION_DATE_PATTERN, RESERVATION_TIME_PATTERN } from '../../enums/reservation.enum';

@InputType()
export class ReservationInput {
	@IsMongoId()
	@Field(() => String)
	programId: string;

	@IsString()
	@Length(10, 10)
	@Matches(RESERVATION_DATE_PATTERN)
	@Field(() => String)
	reservationDate: string;

	@IsString()
	@Length(5, 5)
	@Matches(RESERVATION_TIME_PATTERN)
	@Field(() => String)
	startTime: string;

	@IsOptional()
	@IsString()
	@Length(0, 500)
	@Field(() => String, { nullable: true })
	specialRequest?: string | null;
}
