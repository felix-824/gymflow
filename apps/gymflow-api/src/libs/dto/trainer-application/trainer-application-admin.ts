import { Field, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { MemberStatus, MemberType } from '../../enums/member.enum';
import { TotalCounter } from '../member/member';
import { TrainerApplication } from './trainer-application';

@ObjectType()
export class TrainerApplicationMemberSummary {
	@Field(() => String)
	_id: Types.ObjectId;

	@Field(() => String)
	memberNick: string;

	@Field(() => String, { nullable: true })
	memberFullName?: string | null;

	@Field(() => String)
	memberImage: string;

	@Field(() => MemberType)
	memberType: MemberType;

	@Field(() => MemberStatus)
	memberStatus: MemberStatus;
}

@ObjectType()
export class TrainerApplicationAdmin extends TrainerApplication {
	@Field(() => String, { nullable: true })
	declare reviewedBy?: Types.ObjectId | null;

	@Field(() => TrainerApplicationMemberSummary, { nullable: true })
	memberData?: TrainerApplicationMemberSummary | null;
}

@ObjectType()
export class TrainerApplications {
	@Field(() => [TrainerApplicationAdmin])
	list: TrainerApplicationAdmin[];

	@Field(() => [TotalCounter], { nullable: true })
	metaCounter: TotalCounter[];
}
