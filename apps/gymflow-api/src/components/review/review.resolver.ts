import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Types } from 'mongoose';
import { ReviewInput, ReviewsInquiry } from '../../libs/dto/review/review.input';
import { Review, Reviews } from '../../libs/dto/review/review';
import { MemberType } from '../../libs/enums/member.enum';
import { AuthMember } from '../auth/decorators/authMember.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { WithoutGuard } from '../auth/guards/without.guard';
import { ReviewService } from './review.service';

@Resolver()
export class ReviewResolver {
	constructor(private readonly reviewService: ReviewService) {}

	@Roles(MemberType.USER, MemberType.TRAINER)
	@UseGuards(RolesGuard)
	@Mutation(() => Review)
	public async createReview(
		@Args('input') input: ReviewInput,
		@AuthMember('_id') memberId: Types.ObjectId,
	): Promise<Review> {
		return await this.reviewService.createReview(memberId, input);
	}

	@UseGuards(WithoutGuard)
	@Query(() => Reviews)
	public async getReviews(@Args('input') input: ReviewsInquiry): Promise<Reviews> {
		return await this.reviewService.getReviews(input);
	}
}
