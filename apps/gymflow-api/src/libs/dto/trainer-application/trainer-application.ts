import { Field, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { ProgramCategory } from '../../enums/program.enum';
import { TrainerApplicationStatus } from '../../enums/trainer-application.enum';

@ObjectType()
export class TrainerApplication {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => String) memberId: Types.ObjectId;
	@Field(() => TrainerApplicationStatus) status: TrainerApplicationStatus;
	@Field(() => String) fullName: string;
	@Field(() => [ProgramCategory]) categories: ProgramCategory[];
	@Field(() => String) experienceSummary: string;
	@Field(() => String) bio: string;
	@Field(() => String, { nullable: true }) rejectionReason?: string | null;
	reviewedBy?: Types.ObjectId | null;
	@Field(() => Date, { nullable: true }) reviewedAt?: Date | null;
	@Field(() => Date) createdAt: Date;
	@Field(() => Date) updatedAt: Date;
}
