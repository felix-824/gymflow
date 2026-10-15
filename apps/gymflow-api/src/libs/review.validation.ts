import { BadRequestException } from '@nestjs/common';
import { ReviewInput, ReviewsInquiry } from './dto/review/review.input';
import { shapeIntoMongoObjectId } from './config';

export function assertReviewInput(input: ReviewInput): void {
	if (!input || !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)
		throw new BadRequestException('Rating must be an integer from 1 to 5');
	if (typeof input.content !== 'string' || input.content.trim().length < 1 || input.content.trim().length > 100)
		throw new BadRequestException('Review content must contain 1-100 characters');
	shapeIntoMongoObjectId(input.reservationId);
}

export function assertReviewsInquiry(input: ReviewsInquiry): void {
	if (
		!input ||
		!Number.isSafeInteger(input.page) ||
		input.page < 1 ||
		!Number.isSafeInteger(input.limit) ||
		input.limit < 1 ||
		input.limit > 100 ||
		!input.search ||
		typeof input.search !== 'object' ||
		Array.isArray(input.search)
	)
		throw new BadRequestException('Provide valid page, limit (1-100) and program search');
	shapeIntoMongoObjectId(input.search.programId);
}
