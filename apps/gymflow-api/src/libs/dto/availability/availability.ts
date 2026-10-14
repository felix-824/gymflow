import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AvailableSlot {
	@Field(() => String) startTime: string;
	@Field(() => String) endTime: string;
}
