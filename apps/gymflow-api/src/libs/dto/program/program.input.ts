import { Field, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
	ArrayNotEmpty,
	IsArray,
	IsEnum,
	IsIn,
	IsInt,
	IsMongoId,
	IsOptional,
	IsString,
	Length,
	Min,
	ValidateNested,
} from 'class-validator';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../../enums/program.enum';
import { Direction } from '../../enums/common.enum';
import { availableProgramSorts } from '../../config';
import { OrdinaryInquiry } from '../common/inquiry';

@InputType()
export class ProgramInput {
	@IsEnum(ProgramType)
	@Field(() => ProgramType)
	programType: ProgramType;

	@IsEnum(ProgramCategory)
	@Field(() => ProgramCategory)
	programCategory: ProgramCategory;

	@IsEnum(ProgramLocation)
	@Field(() => ProgramLocation)
	programLocation: ProgramLocation;

	@Length(3, 100)
	@Field(() => String)
	programName: string;

	@IsOptional()
	@Length(3, 100)
	@Field(() => String, { nullable: true })
	programAddress?: string | null;

	@IsInt()
	@Min(0)
	@Field(() => Int)
	programPrice: number;

	@IsInt()
	@Min(1)
	@Field(() => Int)
	programDuration: number;

	@IsInt()
	@Min(1)
	@Field(() => Int)
	programCapacity: number;

	@IsArray()
	@ArrayNotEmpty()
	@IsString({ each: true })
	@Length(1, 2048, { each: true })
	@Field(() => [String])
	programImages: string[];

	@IsOptional()
	@Length(5, 500)
	@Field(() => String, { nullable: true })
	programDesc?: string | null;
}

@InputType()
export class PricesRange {
	@IsInt()
	@Min(0)
	@Field(() => Int)
	start: number;

	@IsInt()
	@Min(0)
	@Field(() => Int)
	end: number;
}

@InputType()
export class PeriodsRange {
	@Field(() => Date)
	start: Date;

	@Field(() => Date)
	end: Date;
}

@InputType()
export class ProgramSearch {
	@IsOptional()
	@IsMongoId()
	@Field(() => String, { nullable: true })
	memberId?: string;

	@IsOptional()
	@IsEnum(ProgramLocation, { each: true })
	@Field(() => [ProgramLocation], { nullable: true })
	locationList?: ProgramLocation[];

	@IsOptional()
	@IsEnum(ProgramType, { each: true })
	@Field(() => [ProgramType], { nullable: true })
	typeList?: ProgramType[];

	@IsOptional()
	@IsEnum(ProgramCategory, { each: true })
	@Field(() => [ProgramCategory], { nullable: true })
	categoryList?: ProgramCategory[];

	@IsOptional()
	@ValidateNested()
	@Type(() => PricesRange)
	@Field(() => PricesRange, { nullable: true })
	pricesRange?: PricesRange;

	@IsOptional()
	@ValidateNested()
	@Type(() => PeriodsRange)
	@Field(() => PeriodsRange, { nullable: true })
	periodsRange?: PeriodsRange;

	@IsOptional()
	@Length(1, 100)
	@Field(() => String, { nullable: true })
	text?: string;
}

@InputType()
export class ProgramListInquiry extends OrdinaryInquiry {
	@IsOptional()
	@IsIn(availableProgramSorts)
	@Field(() => String, { nullable: true })
	sort?: string;

	@IsOptional()
	@IsEnum(Direction)
	@Field(() => Direction, { nullable: true })
	direction?: Direction;
}

@InputType()
export class ProgramsInquiry extends ProgramListInquiry {
	@ValidateNested()
	@Type(() => ProgramSearch)
	@Field(() => ProgramSearch)
	search: ProgramSearch;
}

@InputType()
export class ManagedProgramSearch extends ProgramSearch {
	@IsOptional()
	@IsEnum(ProgramStatus)
	@Field(() => ProgramStatus, { nullable: true })
	programStatus?: ProgramStatus;
}

@InputType()
export class TrainerProgramsInquiry extends ProgramListInquiry {
	@ValidateNested()
	@Type(() => ManagedProgramSearch)
	@Field(() => ManagedProgramSearch)
	search: ManagedProgramSearch;
}

@InputType()
export class AllProgramsInquiry extends TrainerProgramsInquiry {}
