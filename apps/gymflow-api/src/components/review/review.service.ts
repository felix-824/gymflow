import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { ReviewInput, ReviewsInquiry } from '../../libs/dto/review/review.input';
import { Review, Reviews } from '../../libs/dto/review/review';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { Member } from '../../libs/dto/member/member';
import { Program } from '../../libs/dto/program/program';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { ReservationStatus } from '../../libs/enums/reservation.enum';
import { shapeIntoMongoObjectId } from '../../libs/config';
import { assertReviewInput, assertReviewsInquiry } from '../../libs/review.validation';

@Injectable()
export class ReviewService {
	constructor(
		@InjectModel('Review') private readonly reviewModel: Model<Review>,
		@InjectModel('Reservation') private readonly reservationModel: Model<Reservation>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Program') private readonly programModel: Model<Program>,
	) {}

	public async createReview(memberId: Types.ObjectId, input: ReviewInput): Promise<Review> {
		assertReviewInput(input);
		const reservationId = shapeIntoMongoObjectId(input.reservationId);
		await this.reviewModel.init();
		try {
			return await this.reviewModel.db.transaction(
				async (session) => {
					const reservation = await this.reservationModel
						.findOne({ _id: reservationId, memberId })
						.session(session)
						.lean()
						.exec();
					if (!reservation) throw new NotFoundException('Reservation not found');
					if (reservation.reservationStatus !== ReservationStatus.COMPLETED)
						throw new ConflictException('Only completed reservations can be reviewed');

					// Match reservation writes' Member order; real version writes contend with account changes.
					const identities = [
						{ _id: memberId, isUser: true },
						{ _id: reservation.trainerId, isUser: false },
					].sort((left, right) => left._id.toString().localeCompare(right._id.toString()));
					for (const identity of identities) {
						const member = await this.memberModel
							.findOneAndUpdate(
								{
									_id: identity._id,
									...(identity.isUser ? { memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE } : {}),
								},
								{ $inc: { __v: 1 } },
								{ session, new: true, timestamps: false },
							)
							.select('_id')
							.lean()
							.exec();
						if (!member && identity.isUser) throw new ForbiddenException('An active USER account is required');
						if (!member) throw new NotFoundException('Reservation trainer not found');
					}
					// Fence hard removal/ownership edits without adding an ACTIVE-parent visibility policy.
					const program = await this.programModel
						.findOneAndUpdate(
							{ _id: reservation.programId, memberId: reservation.trainerId },
							{ $inc: { __v: 1 } },
							{ session, new: true, timestamps: false },
						)
						.select('_id')
						.lean()
						.exec();
					if (!program) throw new ConflictException('Reservation program is missing or has a different trainer');
					if (await this.reviewModel.exists({ reservationId }).session(session))
						throw new ConflictException('This reservation already has a review');
					const [review] = await this.reviewModel.create(
						[
							{
								reservationId,
								memberId,
								trainerId: reservation.trainerId,
								programId: reservation.programId,
								rating: input.rating,
								content: input.content.trim(),
							},
						],
						{ session },
					);
					return review;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (error instanceof mongo.MongoServerError && error.code === 11000)
				throw new ConflictException('This reservation already has a review');
			if (error instanceof mongo.MongoServerError && error.hasErrorLabel('TransientTransactionError'))
				throw new ConflictException('Review eligibility changed concurrently; reload before retrying');
			throw error;
		}
	}

	public async getReviews(input: ReviewsInquiry): Promise<Reviews> {
		assertReviewsInquiry(input);
		const [result] = await this.reviewModel
			.aggregate<Reviews & { ratingSummary: { averageRating: number }[] }>([
				{ $match: { programId: shapeIntoMongoObjectId(input.search.programId) } },
				{ $sort: { createdAt: -1, _id: -1 } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{
								$lookup: {
									from: 'members',
									localField: 'memberId',
									foreignField: '_id',
									as: 'memberData',
									pipeline: [{ $project: { _id: 1, memberNick: 1, memberFullName: 1, memberImage: 1 } }],
								},
							},
							{ $unwind: { path: '$memberData', preserveNullAndEmptyArrays: true } },
							{
								$project: {
									_id: 1,
									rating: 1,
									content: 1,
									memberId: 1,
									trainerId: 1,
									programId: 1,
									createdAt: 1,
									updatedAt: 1,
									memberData: 1,
								},
							},
						],
						metaCounter: [{ $count: 'total' }],
						ratingSummary: [{ $group: { _id: null, averageRating: { $avg: '$rating' } } }],
					},
				},
			])
			.exec();
		return {
			list: result?.list ?? [],
			metaCounter: result?.metaCounter.length ? result.metaCounter : [{ total: 0 }],
			averageRating: result?.ratingSummary[0]?.averageRating ?? null,
		};
	}
}
