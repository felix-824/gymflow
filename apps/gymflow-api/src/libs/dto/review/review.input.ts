import { Field, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import { IsDefined, IsInt, IsMongoId, IsObject, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { OrdinaryInquiry } from '../common/inquiry';

@InputType()
export class ReviewInput {
	@IsMongoId()
	@Field(() => String)
	reservationId: string;

	@IsInt()
	@Min(1)
	@Max(5)
	@Field(() => Int)
	rating: number;

	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, 100)
	@Field(() => String)
	content: string;
}

@InputType()
export class ReviewSearch {
	@IsMongoId()
	@Field(() => String)
	programId: string;
}

@InputType()
export class ReviewsInquiry extends OrdinaryInquiry {
	@IsInt()
	@Min(1)
	@Max(100)
	declare limit: number;

	@IsDefined()
	@IsObject()
	@ValidateNested()
	@Type(() => ReviewSearch)
	@Field(() => ReviewSearch)
	search: ReviewSearch;
}
