import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { TotalCounter } from '../member/member';

@ObjectType()
export class ReviewMemberSummary {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => String) memberNick: string;
	@Field(() => String, { nullable: true }) memberFullName?: string | null;
	@Field(() => String) memberImage: string;
}

@ObjectType()
export class Review {
	@Field(() => String) _id: Types.ObjectId;
	@Field(() => Int) rating: number;
	@Field(() => String) content: string;
	@Field(() => String) memberId: Types.ObjectId;
	@Field(() => String) trainerId: Types.ObjectId;
	@Field(() => String) programId: Types.ObjectId;
	// Internal booking identity is deliberately absent from the public GraphQL type.
	reservationId: Types.ObjectId;
	@Field(() => Date) createdAt: Date;
	@Field(() => Date) updatedAt: Date;
	@Field(() => ReviewMemberSummary, { nullable: true }) memberData?: ReviewMemberSummary | null;
}

@ObjectType()
export class Reviews {
	@Field(() => [Review]) list: Review[];
	@Field(() => [TotalCounter], { nullable: true }) metaCounter: TotalCounter[];
	@Field(() => Float, { nullable: true }) averageRating: number | null;
}
