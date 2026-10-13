import { Field, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { TrainerScheduleDayOfWeek, TRAINER_SCHEDULE_TIMEZONE } from '../../enums/trainer-schedule.enum';

@ObjectType({
	description: 'Recurring working hours in ' + TRAINER_SCHEDULE_TIMEZONE + '; disabled days have no working interval',
})
export class TrainerSchedule {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => String) memberId: Types.ObjectId;
	@Field(() => TrainerScheduleDayOfWeek) dayOfWeek: TrainerScheduleDayOfWeek;
	@Field(() => String, { nullable: true }) startTime?: string | null;
	@Field(() => String, { nullable: true }) endTime?: string | null;
	@Field(() => Boolean) isAvailable: boolean;
	@Field(() => Date) createdAt: Date;
	@Field(() => Date) updatedAt: Date;
}
