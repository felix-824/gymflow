import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsDefined, IsEnum, IsInt, IsMongoId, IsObject, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { OrdinaryInquiry } from '../common/inquiry';
import { ReservationStatus } from '../../enums/reservation.enum';
import { ReservationPeriod } from '../../enums/reservation-query.enum';

@InputType()
export class TrainerReservationSearch {
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	programId?: string;

	@IsOptional()
	@IsEnum(ReservationStatus)
	@Field(() => ReservationStatus, { nullable: true })
	reservationStatus?: ReservationStatus;

	@IsOptional()
	@IsEnum(ReservationPeriod)
	@Field(() => ReservationPeriod, { nullable: true })
	period?: ReservationPeriod;
}

@InputType()
export class TrainerReservationsInquiry extends OrdinaryInquiry {
	@IsInt()
	@Min(1)
	@Max(100)
	declare limit: number;

	@IsDefined()
	@IsObject()
	@ValidateNested()
	@Type(() => TrainerReservationSearch)
	@Field(() => TrainerReservationSearch)
	search: TrainerReservationSearch;
}
