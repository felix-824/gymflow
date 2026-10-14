import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { ReservationInput } from '../../libs/dto/reservation/reservation.input';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { Member } from '../../libs/dto/member/member';
import { Program } from '../../libs/dto/program/program';
import { TrainerSchedule } from '../../libs/dto/trainer-schedule/trainer-schedule';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { ProgramStatus, ProgramType } from '../../libs/enums/program.enum';
import { ReservationStatus } from '../../libs/enums/reservation.enum';
import { capacityOccupyingStatuses, getAvailabilityWeekday, getSeoulDateTime } from '../../libs/availability';
import {
	assertReservationInput,
	assertFutureReservationStart,
	deriveReservationInterval,
	normalizeSpecialRequest,
} from '../../libs/reservation.create.validation';

@Injectable()
export class ReservationService {
	constructor(
		@InjectModel('Reservation') private readonly reservationModel: Model<Reservation>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('Program') private readonly programModel: Model<Program>,
		@InjectModel('TrainerSchedule') private readonly trainerScheduleModel: Model<TrainerSchedule>,
	) {}

	public async createReservation(memberId: Types.ObjectId, input: ReservationInput): Promise<Reservation> {
		assertReservationInput(input);
		const specialRequest = normalizeSpecialRequest(input.specialRequest);
		const programId = new Types.ObjectId(input.programId);
		// Used only to choose contention documents. All business state is re-read in the transaction.
		const owner = await this.programModel.findById(programId).select('memberId').lean().exec();
		if (!owner) throw new NotFoundException('Program not found');
		await this.reservationModel.init();
		try {
			return await this.reservationModel.db.transaction(
				async (session) => {
					const identities = [
						{ _id: memberId, memberType: MemberType.USER },
						{ _id: owner.memberId, memberType: MemberType.TRAINER },
					].sort((left, right) => left._id.toString().localeCompare(right._id.toString()));
					for (const identity of identities) {
						// A real write, not a no-op: shared documents serialize competing bookings.
						const member = await this.memberModel
							.findOneAndUpdate(
								{ ...identity, memberStatus: MemberStatus.ACTIVE },
								{ $inc: { __v: 1 } },
								{ session, new: true, timestamps: false },
							)
							.select('_id')
							.lean()
							.exec();
						if (!member) {
							if (identity.memberType === MemberType.USER)
								throw new ForbiddenException('An active USER account is required');
							throw new NotFoundException('Program not found');
						}
					}
					// Fence concurrent catalog/schedule edits as well as concurrent reservation inserts.
					const program = await this.programModel
						.findOneAndUpdate(
							{ _id: programId, memberId: owner.memberId, programStatus: ProgramStatus.ACTIVE },
							{ $inc: { __v: 1 } },
							{ session, new: true, timestamps: false },
						)
						.lean()
						.exec();
					if (!program) throw new NotFoundException('Program not found');
					if (program.programType !== ProgramType.PT_1ON1 && program.programType !== ProgramType.GROUP_CLASS)
						throw new BadRequestException('Only PT_1ON1 and GROUP_CLASS programs can be reserved');
					const schedule = await this.trainerScheduleModel
						.findOneAndUpdate(
							{
								memberId: program.memberId,
								dayOfWeek: getAvailabilityWeekday(input.reservationDate),
								isAvailable: true,
							},
							{ $inc: { __v: 1 } },
							{ session, new: true, timestamps: false },
						)
						.lean()
						.exec();
					if (!schedule) throw new ConflictException('Trainer is unavailable on this weekday');
					const interval = deriveReservationInterval(input, program, schedule, getSeoulDateTime(new Date()));
					const occupied = {
						reservationDate: input.reservationDate,
						reservationStatus: { $in: capacityOccupyingStatuses },
					};
					const duplicate = await this.reservationModel
						.exists({
							...occupied,
							memberId,
							programId,
							...interval,
						})
						.session(session)
						.exec();
					if (duplicate) throw new ConflictException('You already have a reservation for this session');
					const overlap = { startTime: { $lt: interval.endTime }, endTime: { $gt: interval.startTime } };
					const userConflict = await this.reservationModel
						.exists({
							...occupied,
							memberId,
							...overlap,
						})
						.session(session)
						.exec();
					if (userConflict) throw new ConflictException('You already have an overlapping reservation');
					const trainerReservations = await this.reservationModel
						.find({
							...occupied,
							trainerId: program.memberId,
							...overlap,
						})
						.select('programId startTime endTime')
						.session(session)
						.lean()
						.exec();
					if (program.programType === ProgramType.PT_1ON1 && trainerReservations.length)
						throw new ConflictException('Trainer is already reserved during this slot');
					if (program.programType === ProgramType.GROUP_CLASS) {
						if (
							trainerReservations.some(
								(reservation) =>
									!reservation.programId.equals(programId) ||
									reservation.startTime !== interval.startTime ||
									reservation.endTime !== interval.endTime,
							)
						)
							throw new ConflictException('Trainer has a conflicting session');
						if (trainerReservations.length >= program.programCapacity)
							throw new ConflictException('This group session is full');
					}
					// Re-read the clock on every retry and immediately before writing.
					assertFutureReservationStart(input, getSeoulDateTime(new Date()));
					const [reservation] = await this.reservationModel.create(
						[
							{
								programId,
								memberId,
								trainerId: program.memberId,
								reservationDate: input.reservationDate,
								...interval,
								reservationStatus: ReservationStatus.PENDING,
								...(specialRequest !== undefined ? { specialRequest } : {}),
							},
						],
						{ session },
					);
					return reservation;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (error instanceof mongo.MongoServerError && error.hasErrorLabel('TransientTransactionError'))
				throw new ConflictException('Booking changed concurrently; reload availability and retry');
			throw error;
		}
	}
}
