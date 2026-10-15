import { Field, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { TotalCounter } from '../member/member';
import { Reservation } from './reservation';
import { ReservationProgramSummary } from './my-reservations';

@ObjectType()
export class ReservationMemberSummary {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => String) memberNick: string;
	@Field(() => String, { nullable: true }) memberFullName?: string | null;
	@Field(() => String) memberImage: string;
}

@ObjectType()
export class TrainerReservation extends Reservation {
	@Field(() => ReservationProgramSummary, { nullable: true }) programData?: ReservationProgramSummary | null;
	@Field(() => ReservationMemberSummary, { nullable: true }) memberData?: ReservationMemberSummary | null;
}

@ObjectType()
export class TrainerReservations {
	@Field(() => [TrainerReservation]) list: TrainerReservation[];
	@Field(() => [TotalCounter], { nullable: true }) metaCounter: TotalCounter[];
}
