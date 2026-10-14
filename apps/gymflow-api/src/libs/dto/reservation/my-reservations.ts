import { Field, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { ProgramLocation, ProgramType } from '../../enums/program.enum';
import { TotalCounter } from '../member/member';
import { Reservation } from './reservation';

@ObjectType()
export class ReservationProgramSummary {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => String) programName: string;
	@Field(() => [String]) programImages: string[];
	@Field(() => ProgramType) programType: ProgramType;
	@Field(() => ProgramLocation) programLocation: ProgramLocation;
	@Field(() => String, { nullable: true }) programAddress?: string | null;
}

@ObjectType()
export class ReservationTrainerSummary {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => String, { nullable: true }) memberFullName?: string | null;
	@Field(() => String) memberNick: string;
	@Field(() => String) memberImage: string;
}

@ObjectType()
export class MyReservation extends Reservation {
	@Field(() => ReservationProgramSummary, { nullable: true }) programData?: ReservationProgramSummary | null;
	@Field(() => ReservationTrainerSummary, { nullable: true }) trainerData?: ReservationTrainerSummary | null;
}

@ObjectType()
export class MyReservations {
	@Field(() => [MyReservation]) list: MyReservation[];
	@Field(() => [TotalCounter], { nullable: true }) metaCounter: TotalCounter[];
}
