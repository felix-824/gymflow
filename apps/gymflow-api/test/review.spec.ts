import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { model, Types } from 'mongoose';
import ReviewSchema from '../src/schemas/Review.model';
import { ReviewInput, ReviewsInquiry } from '../src/libs/dto/review/review.input';
import { assertReviewInput, assertReviewsInquiry } from '../src/libs/review.validation';

const id = new Types.ObjectId().toHexString();
const valid = { reservationId: id, rating: 5, content: 'Useful training' };
const ReviewModel = model('ReviewValidationTest', ReviewSchema);
const document = (change: object = {}) =>
	new ReviewModel({
		...valid,
		memberId: id,
		trainerId: id,
		programId: id,
		...change,
	});

describe('Review validation and authoritative indexes', () => {
	it.each([1, 5])('accepts rating %s across DTO, service and schema', async (rating) => {
		const input = plainToInstance(ReviewInput, { ...valid, rating });
		expect(await validate(input)).toEqual([]);
		expect(() => assertReviewInput(input)).not.toThrow();
		await expect(document({ rating }).validate()).resolves.toBeUndefined();
	});
	it.each([0, 6, 1.5])('rejects rating %s across all boundaries', async (rating) => {
		expect(await validate(plainToInstance(ReviewInput, { ...valid, rating }))).not.toHaveLength(0);
		expect(() => assertReviewInput({ ...valid, rating })).toThrow(BadRequestException);
		await expect(document({ rating }).validate()).rejects.toThrow();
	});
	it.each(['', '   \n\t', 'x'.repeat(101)])('rejects invalid content %#', async (content) => {
		expect(await validate(plainToInstance(ReviewInput, { ...valid, content }))).not.toHaveLength(0);
		expect(() => assertReviewInput({ ...valid, content })).toThrow(BadRequestException);
		await expect(document({ content }).validate()).rejects.toThrow();
	});
	it('trims content consistently and accepts the 100-character boundary', async () => {
		const input = plainToInstance(ReviewInput, { ...valid, content: '  Great session  ' });
		expect(input.content).toBe('Great session');
		expect(await validate(input)).toEqual([]);
		const review = document({ content: '  ' + 'x'.repeat(100) + '  ' });
		await expect(review.validate()).resolves.toBeUndefined();
		expect(review.content).toBe('x'.repeat(100));
	});
	it.each(['invalid', '', null])('rejects malformed reservation ID %s', async (reservationId) => {
		const input = plainToInstance(ReviewInput, { ...valid, reservationId });
		expect(await validate(input)).not.toHaveLength(0);
		expect(() => assertReviewInput(input)).toThrow(BadRequestException);
	});
	it('requires every historical reference in the schema', async () => {
		for (const name of ['memberId', 'trainerId', 'programId', 'reservationId']) {
			await expect(document({ [name]: undefined }).validate()).rejects.toThrow();
		}
	});
	it('has a required nonpartial unique reservation index and program newest index', () => {
		expect(ReviewSchema.indexes()).toEqual(
			expect.arrayContaining([
				[{ reservationId: 1 }, expect.objectContaining({ unique: true })],
				[{ programId: 1, createdAt: -1, _id: -1 }, expect.any(Object)],
			]),
		);
		const unique = ReviewSchema.indexes().find(([keys]) => keys.reservationId);
		expect(unique![1].partialFilterExpression).toBeUndefined();
	});
	it.each([1, 100])('accepts program inquiry with limit %s', async (limit) => {
		const input = plainToInstance(ReviewsInquiry, { page: 1, limit, search: { programId: id } });
		expect(await validate(input)).toEqual([]);
		expect(() => assertReviewsInquiry(input)).not.toThrow();
	});
	it.each([
		{ page: 0 },
		{ page: 1.5 },
		{ limit: 0 },
		{ limit: 101 },
		{ limit: 1.5 },
		{ search: null },
		{ search: [] },
		{ search: {} },
		{ search: { programId: 'bad' } },
	])('rejects invalid program inquiry %#', async (change) => {
		const input = plainToInstance(ReviewsInquiry, { page: 1, limit: 10, search: { programId: id }, ...change });
		expect(await validate(input)).not.toHaveLength(0);
		expect(() => assertReviewsInquiry(input)).toThrow(BadRequestException);
	});
});
