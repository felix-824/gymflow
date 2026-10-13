import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsOptional,
	IsString,
	Length,
	Matches,
	ValidateNested,
} from 'class-validator';
import {
	TrainerScheduleDayOfWeek,
	TRAINER_SCHEDULE_TIME_PATTERN,
	TRAINER_SCHEDULE_TIMEZONE,
} from '../../enums/trainer-schedule.enum';

@InputType()
export class TrainerScheduleDayInput {
	@IsEnum(TrainerScheduleDayOfWeek)
	@Field(() => TrainerScheduleDayOfWeek)
	dayOfWeek: TrainerScheduleDayOfWeek;

	@IsBoolean()
	@Field(() => Boolean)
	isAvailable: boolean;

	@IsOptional()
	@IsString()
	@Length(5, 5)
	@Matches(TRAINER_SCHEDULE_TIME_PATTERN)
	@Field(() => String, { nullable: true })
	startTime?: string | null;

	@IsOptional()
	@IsString()
	@Length(5, 5)
	@Matches(TRAINER_SCHEDULE_TIME_PATTERN)
	@Field(() => String, { nullable: true })
	endTime?: string | null;
}

@InputType({ description: 'Full seven-day weekly schedule in ' + TRAINER_SCHEDULE_TIMEZONE })
export class TrainerScheduleInput {
	@IsArray()
	@ArrayMinSize(7)
	@ArrayMaxSize(7)
	@ValidateNested({ each: true })
	@Type(() => TrainerScheduleDayInput)
	@Field(() => [TrainerScheduleDayInput])
	days: TrainerScheduleDayInput[];
}
