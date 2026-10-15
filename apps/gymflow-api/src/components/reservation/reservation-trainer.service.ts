import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { TrainerReservationsInquiry } from '../../libs/dto/reservation/trainer-reservation.inquiry';
import { TrainerReservationUpdate } from '../../libs/dto/reservation/trainer-reservation.update';
import { TrainerReservations } from '../../libs/dto/reservation/trainer-reservations';
import { Member } from '../../libs/dto/member/member';
import { Program } from '../../libs/dto/program/program';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { ReservationPeriod } from '../../libs/enums/reservation-query.enum';
import { getSeoulDateTime } from '../../libs/availability';
import { shapeIntoMongoObjectId } from '../../libs/config';
import {
	assertTrainerReservationsInquiry,
	assertTrainerReservationUpdate,
	assertTrainerReservationTransition,
	trainerReservationsMatch,
	trainerTransitionTimeMatch,
} from '../../libs/reservation-trainer.validation';

@Injectable()
export class ReservationTrainerService {
	constructor(
		@InjectModel('Reservation') private readonly reservationModel: Model<Reservation>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Program') private readonly programModel: Model<Program>,
	) {}

	public async getTrainerReservations(
		trainerId: Types.ObjectId,
		input: TrainerReservationsInquiry,
	): Promise<TrainerReservations> {
		assertTrainerReservationsInquiry(input);
		const now = getSeoulDateTime(new Date());
		const direction = input.search.period === ReservationPeriod.UPCOMING ? 1 : -1;
		const [result] = await this.reservationModel
			.aggregate<TrainerReservations>([
				{ $match: trainerReservationsMatch(trainerId, input, now) },
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
									memberId: 1,
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
				// Orphans retain stored ownership; inconsistent existing programs must not affect counts or expose clients.
				{ $match: { $or: [{ programData: null }, { 'programData.memberId': trainerId }] } },
				{ $project: { 'programData.memberId': 0 } },
				{ $sort: { reservationDate: direction, startTime: direction, _id: direction } },
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
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}

	public async updateTrainerReservation(
		trainerId: Types.ObjectId,
		input: TrainerReservationUpdate,
	): Promise<Reservation> {
		assertTrainerReservationUpdate(input);
		const owned = { _id: shapeIntoMongoObjectId(input._id), trainerId };
		const initial = await this.reservationModel.findOne(owned).select('memberId').lean().exec();
		if (!initial) throw new NotFoundException('Reservation not found');
		await this.reservationModel.init();
		try {
			return await this.reservationModel.db.transaction(
				async (session) => {
					const identities = [
						{ _id: trainerId, isTrainer: true },
						{ _id: initial.memberId, isTrainer: false },
					].sort((left, right) => left._id.toString().localeCompare(right._id.toString()));
					for (const identity of identities) {
						const member = await this.memberModel
							.findOneAndUpdate(
								{
									_id: identity._id,
									...(identity.isTrainer ? { memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE } : {}),
								},
								{ $inc: { __v: 1 } },
								{ session, new: true, timestamps: false },
							)
							.select('_id')
							.lean()
							.exec();
						if (identity.isTrainer && !member) throw new ForbiddenException('An active TRAINER account is required');
						// Missing or inactive clients must not trap an existing reservation lifecycle.
					}
					const current = await this.reservationModel.findOne(owned).session(session).lean().exec();
					if (!current) throw new NotFoundException('Reservation not found');
					const program = await this.programModel
						.findById(current.programId)
						.select('memberId')
						.session(session)
						.lean()
						.exec();
					if (program && !program.memberId.equals(trainerId))
						throw new ConflictException('Reservation program ownership is inconsistent');
					const now = getSeoulDateTime(new Date());
					assertTrainerReservationTransition(current, input.reservationStatus, now);
					const result = await this.reservationModel
						.findOneAndUpdate(
							{
								...owned,
								reservationStatus: current.reservationStatus,
								...trainerTransitionTimeMatch(input.reservationStatus, now),
							},
							{ $set: { reservationStatus: input.reservationStatus } },
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
