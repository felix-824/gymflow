import { Field, InputType, PartialType } from '@nestjs/graphql';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';
import { ProgramInput } from './program.input';
import { ProgramStatus } from '../../enums/program.enum';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;

@InputType()
export class ProgramUpdate extends PartialType(ProgramInput) {
	@IsMongoId()
	@Field(() => String)
	_id: ObjectId;

	@IsOptional()
	@IsEnum(ProgramStatus)
	@Field(() => ProgramStatus, { nullable: true })
	programStatus?: ProgramStatus;
}
