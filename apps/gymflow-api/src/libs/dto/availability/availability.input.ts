import { Field, InputType } from '@nestjs/graphql';
import { IsMongoId, IsString, Length, Matches } from 'class-validator';
import { RESERVATION_DATE_PATTERN } from '../../enums/reservation.enum';

@InputType()
export class ProgramAvailabilityInquiry {
	@IsMongoId()
	@Field(() => String)
	programId: string;

	@IsString()
	@Length(10, 10)
	@Matches(RESERVATION_DATE_PATTERN)
	@Field(() => String)
	reservationDate: string;
}
