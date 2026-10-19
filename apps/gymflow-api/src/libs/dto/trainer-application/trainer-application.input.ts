import { Field, InputType } from '@nestjs/graphql';
import { Transform } from 'class-transformer';
import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayUnique,
	IsArray,
	IsEnum,
	IsOptional,
	IsString,
	Length,
	Matches,
} from 'class-validator';
import { ProgramCategory } from '../../enums/program.enum';

@InputType()
export class TrainerApplicationInput {
	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(3, 100)
	@Field(() => String)
	fullName: string;

	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(Object.values(ProgramCategory).length)
	@ArrayUnique()
	@IsEnum(ProgramCategory, { each: true })
	@Field(() => [ProgramCategory])
	categories: ProgramCategory[];

	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, 1000)
	@Field(() => String)
	experienceSummary: string;

	@Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
	@IsString()
	@Length(1, 2000)
	@Field(() => String)
	bio: string;

	@IsOptional()
	@IsString()
	@Matches(/^[a-f\d]{24}$/i)
	@Field(() => String, { nullable: true })
	previousApplicationId?: string | null;
}
