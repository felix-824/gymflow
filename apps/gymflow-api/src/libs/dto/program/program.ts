import { Field, Int, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../../enums/program.enum';
import { Member, TotalCounter } from '../member/member';
import { MeLiked } from '../like/like';

@ObjectType()
export class Program {
	@Field(() => String) _id: ObjectId;
	@Field(() => ProgramType) programType: ProgramType;
	@Field(() => ProgramStatus) programStatus: ProgramStatus;
	@Field(() => ProgramCategory) programCategory: ProgramCategory;
	@Field(() => ProgramLocation) programLocation: ProgramLocation;
	@Field(() => String) programName: string;
	@Field(() => String, { nullable: true }) programAddress?: string | null;
	@Field(() => Int) programPrice: number;
	@Field(() => Int) programDuration: number;
	@Field(() => Int) programCapacity: number;
	@Field(() => [String]) programImages: string[];
	@Field(() => String, { nullable: true }) programDesc?: string | null;
	@Field(() => Int) programViews: number;
	@Field(() => Int) programLikes: number;
	@Field(() => Int) programRank: number;
	@Field(() => String) memberId: ObjectId;
	@Field(() => Date, { nullable: true }) deletedAt?: Date;
	@Field(() => Date) createdAt: Date;
	@Field(() => Date) updatedAt: Date;
	@Field(() => [MeLiked], { nullable: true }) meLiked?: MeLiked[];
	@Field(() => Member, { nullable: true }) memberData?: Member;
}

@ObjectType()
export class Programs {
	@Field(() => [Program]) list: Program[];
	@Field(() => [TotalCounter], { nullable: true }) metaCounter: TotalCounter[];
}
