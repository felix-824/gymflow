import { Field, InputType, Int, OmitType, PartialType } from '@nestjs/graphql';
import { IsEnum, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { ProgramInput } from './program.input';
import { ProgramStatus } from '../../enums/program.enum';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;

@InputType()
export class ProgramUpdate extends PartialType(OmitType(ProgramInput, ['createRequestId'] as const)) {
	@IsMongoId()
	@Field(() => String)
	_id: ObjectId;

	@IsInt()
	@Min(0)
	@Max(2147483646)
	@Field(() => Int)
	expectedRevision: number;

	@IsOptional()
	@IsEnum(ProgramStatus)
	@Field(() => ProgramStatus, { nullable: true })
	programStatus?: ProgramStatus;
}
