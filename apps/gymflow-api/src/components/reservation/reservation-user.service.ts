import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { ReservationsInquiry } from '../../libs/dto/reservation/reservation.inquiry';
import { MyReservations } from '../../libs/dto/reservation/my-reservations';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { ReservationStatus } from '../../libs/enums/reservation.enum';
import { ReservationPeriod } from '../../libs/enums/reservation-query.enum';
import { capacityOccupyingStatuses, getSeoulDateTime } from '../../libs/availability';
import {
	assertReservationsInquiry,
	assertUserCancellation,
	futureReservationStart,
	myReservationsMatch,
} from '../../libs/reservation-user.validation';

@Injectable()
export class ReservationUserService {
	constructor(
		@InjectModel('Reservation') private readonly reservationModel: Model<Reservation>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	public async getMyReservations(memberId: Types.ObjectId, input: ReservationsInquiry): Promise<MyReservations> {
		const now = getSeoulDateTime(new Date());
		assertReservationsInquiry(input);
		const direction = input.search.period === ReservationPeriod.UPCOMING ? 1 : -1;
		const [result] = await this.reservationModel
			.aggregate<MyReservations>([
				{ $match: myReservationsMatch(memberId, input, now) },
				{ $sort: { reservationDate: direction, startTime: direction, _id: direction } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							{
								$lookup: {
									from: 'programs',
									localField: 'programId',
									foreignField: '_id',
									as: 'programData',
									pipeline: [
										{
											$project: {
												_id: 1,
												programName: 1,
												programImages: 1,
												programType: 1,
												programLocation: 1,
												programAddress: 1,
											},
										},
									],
								},
							},
							{ $unwind: { path: '$programData', preserveNullAndEmptyArrays: true } },
							{
								$lookup: {
									from: 'members',
									localField: 'trainerId',
									foreignField: '_id',
									as: 'trainerData',
									pipeline: [{ $project: { _id: 1, memberFullName: 1, memberNick: 1, memberImage: 1 } }],
								},
							},
							{ $unwind: { path: '$trainerData', preserveNullAndEmptyArrays: true } },
							{
								$lookup: {
									from: 'reviews',
									localField: '_id',
									foreignField: 'reservationId',
									let: { ownerId: '$memberId' },
									as: 'reviewData',
									pipeline: [
										{ $match: { $expr: { $eq: ['$memberId', '$$ownerId'] } } },
										{ $project: { _id: 1 } },
										{ $limit: 1 },
									],
								},
							},
							{ $set: { reviewId: { $ifNull: [{ $arrayElemAt: ['$reviewData._id', 0] }, null] } } },
							{ $unset: 'reviewData' },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}

	public async cancelReservation(memberId: Types.ObjectId, reservationId: Types.ObjectId): Promise<Reservation> {
		const owned = { _id: reservationId, memberId };
		// Ownership is enforced even on the preliminary lookup; eligibility is decided inside the transaction.
		const initial = await this.reservationModel.findOne(owned).select('trainerId').lean().exec();
		if (!initial) throw new NotFoundException('Reservation not found');
		await this.reservationModel.init();
		try {
			return await this.reservationModel.db.transaction(
				async (session) => {
					const identities = [
						{ _id: memberId, isUser: true },
						{ _id: initial.trainerId, isUser: false },
					].sort((left, right) => left._id.toString().localeCompare(right._id.toString()));
					for (const identity of identities) {
						const member = await this.memberModel
							.findOneAndUpdate(
								{
									_id: identity._id,
									...(identity.isUser
										? { memberType: { $in: [MemberType.USER, MemberType.TRAINER] }, memberStatus: MemberStatus.ACTIVE }
										: {}),
								},
								{ $inc: { __v: 1 } },
								{ session, new: true, timestamps: false },
							)
							.select('_id')
							.lean()
							.exec();
						if (identity.isUser && !member)
							throw new ForbiddenException('An active USER or TRAINER account is required');
						// A missing/inactive trainer must not trap the USER's future reservation.
					}
					const current = await this.reservationModel.findOne(owned).session(session).lean().exec();
					if (!current) throw new NotFoundException('Reservation not found');
					const now = getSeoulDateTime(new Date());
					assertUserCancellation(current, now);
					const result = await this.reservationModel
						.findOneAndUpdate(
							{
								...owned,
								reservationStatus: { $in: capacityOccupyingStatuses },
								...futureReservationStart(now),
							},
							{ $set: { reservationStatus: ReservationStatus.CANCELLED } },
							{ session, new: true, runValidators: true },
						)
						.exec();
					if (!result) throw new ConflictException('Reservation changed; reload before retrying');
					return result;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (error instanceof mongo.MongoServerError && error.hasErrorLabel('TransientTransactionError'))
				throw new ConflictException('Reservation changed concurrently; reload and retry');
			throw error;
		}
	}
}
