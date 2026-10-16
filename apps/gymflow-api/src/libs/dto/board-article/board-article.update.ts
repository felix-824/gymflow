import { Field, InputType, Int } from '@nestjs/graphql';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator';
import { BoardArticleStatus } from '../../enums/board-article.enum';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;

@InputType()
export class BoardArticleUpdate {
	@IsNotEmpty()
	@Field(() => String)
	_id: ObjectId;

	@ValidateIf((_input, value: unknown) => value !== undefined)
	@IsEnum(BoardArticleStatus)
	@Field(() => BoardArticleStatus, { nullable: true })
	articleStatus?: BoardArticleStatus;

	@ValidateIf((_input, value: unknown) => value !== undefined)
	@IsString()
	@Length(3, 50)
	@Field(() => String, { nullable: true })
	articleTitle?: string;

	@ValidateIf((_input, value: unknown) => value !== undefined)
	@IsString()
	@Length(3, 5000)
	@Field(() => String, { nullable: true })
	articleContent?: string;

	@IsOptional()
	@IsString()
	@Field(() => String, { nullable: true })
	articleImage?: string | null;

	// The owner service requires this; the existing admin path remains compatible without it.
	@ValidateIf((_input, value: unknown) => value !== undefined)
	@IsInt()
	@Min(0)
	@Field(() => Int, { nullable: true })
	expectedRevision?: number;
}
