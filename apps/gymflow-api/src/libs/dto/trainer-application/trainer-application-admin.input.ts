import { Field, InputType } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
	IsDefined,
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsObject,
	IsOptional,
	IsString,
	Length,
	Max,
	Min,
	ValidateIf,
	ValidateNested,
} from 'class-validator';
import { OrdinaryInquiry } from '../common/inquiry';
import { TrainerApplicationStatus } from '../../enums/trainer-application.enum';

@InputType()
export class TrainerApplicationSearch {
	@IsOptional()
	@IsEnum(TrainerApplicationStatus)
	@Field(() => TrainerApplicationStatus, { nullable: true })
	status?: TrainerApplicationStatus | null;
}

@InputType()
export class TrainerApplicationsInquiry extends OrdinaryInquiry {
	@IsInt()
	@Min(1)
	@Max(100)
	declare limit: number;

	@IsDefined()
	@IsObject()
	@ValidateNested()
	@Type(() => TrainerApplicationSearch)
	@Field(() => TrainerApplicationSearch)
	search: TrainerApplicationSearch;
}

@InputType()
export class TrainerApplicationReview {
	@IsMongoId()
	@Field(() => String)
	applicationId: string;

	@IsIn([TrainerApplicationStatus.APPROVED, TrainerApplicationStatus.REJECTED])
	@Field(() => TrainerApplicationStatus)
	decision: TrainerApplicationStatus;

	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@ValidateIf((input: TrainerApplicationReview) => input.decision === TrainerApplicationStatus.REJECTED)
	@IsString()
	@Length(1, 1000)
	@Field(() => String, { nullable: true })
	rejectionReason?: string | null;
}
