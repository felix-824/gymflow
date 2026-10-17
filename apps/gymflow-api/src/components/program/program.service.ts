import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types, mongo } from 'mongoose';
type ObjectId = Types.ObjectId;
import {
	AllProgramsInquiry,
	ProgramInput,
	ProgramsInquiry,
	ProgramSearch,
	TrainerProgramsInquiry,
} from '../../libs/dto/program/program.input';
import { OrdinaryInquiry } from '../../libs/dto/common/inquiry';
import { ProgramUpdate } from '../../libs/dto/program/program.update';
import { Program, Programs } from '../../libs/dto/program/program';
import { Direction } from '../../libs/enums/common.enum';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { LikeService } from '../like/like.service';
import { ProgramStatus, ProgramType } from '../../libs/enums/program.enum';
import { Reservation } from '../../libs/dto/reservation/reservation';
import { Review } from '../../libs/dto/review/review';
import { capacityOccupyingStatuses, getSeoulDateTime } from '../../libs/availability';
import { LikeGroup } from '../../libs/enums/like.enum';
import { ViewGroup } from '../../libs/enums/view.enum';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { availableProgramSorts, lookupAuthMemberLiked, shapeIntoMongoObjectId } from '../../libs/config';
import { assertProgram } from '../../libs/program.validation';
import { programOwnerStages } from '../../libs/program.aggregation';
import { T } from '../../libs/types/common';

const editable = [
	'programType',
	'programCategory',
	'programLocation',
	'programName',
	'programAddress',
	'programPrice',
	'programDuration',
	'programCapacity',
	'programImages',
	'programDesc',
] as const;

@Injectable()
export class ProgramService implements OnModuleInit {
	constructor(
		@InjectModel('Program') private readonly programModel: Model<Program>,
		@InjectModel('Notification') private readonly notificationModel: Model<any>,
		private readonly memberService: MemberService,
		private readonly viewService: ViewService,
		private readonly likeService: LikeService,
		@InjectModel('Reservation')
		private readonly reservationModel: Model<Reservation>,
		@InjectModel('Review') private readonly reviewModel: Model<Review>,
	) {}

	async onModuleInit(): Promise<void> {
		// Finish legacy rollout before this API accepts writes; native update preserves timestamps and __v.
		await this.programModel.collection.updateMany(
			{ programRevision: { $exists: false } },
			{ $set: { programRevision: 0 } },
		);
	}

	public async createProgram(memberId: ObjectId, input: ProgramInput): Promise<Program> {
		const owner = await this.memberService.getMember(null, memberId);

		if (owner.memberType !== MemberType.TRAINER || owner.memberStatus !== MemberStatus.ACTIVE)
			throw new BadRequestException('An active trainer must own the program');

		const fields = this.pickFields(input);
		assertProgram(fields as ProgramInput);
		const result = await this.programModel.create({ ...fields, memberId, programStatus: ProgramStatus.ACTIVE });
		await this.memberService.memberStatsEditor({ _id: memberId, targetKey: 'memberPrograms', modifier: 1 });
		return result;
	}

	private pickFields(input: Partial<ProgramInput>): Partial<ProgramInput> {
		return Object.fromEntries(editable.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
	}

	private async visibleProgram(programId: ObjectId, session?: ClientSession): Promise<Program> {
		if (session) {
			// A real parent write serializes Program engagement with catalog edits and hard removal.
			const fenced = await this.programModel
				.findOneAndUpdate(
					{ _id: programId, programStatus: ProgramStatus.ACTIVE },
					{ $inc: { __v: 1 } },
					{ session, new: true, timestamps: false },
				)
				.select('_id')
				.lean()
				.exec();
			if (!fenced) throw new NotFoundException('Program not found');
		}
		const query = this.programModel.aggregate<Program>([{ $match: { _id: programId } }, ...programOwnerStages(true)]);
		if (session) query.session(session);
		const [program] = await query.exec();
		if (!program) throw new NotFoundException('Program not found');
		return program;
	}

	async getProgram(memberId: ObjectId | null, programId: ObjectId): Promise<Program> {
		if (!memberId) return this.visibleProgram(programId);
		try {
			return await this.programModel.db.transaction(
				async (session) => {
					const program = await this.visibleProgram(programId, session);
					const recorded = await this.viewService.recordView(
						{ memberId, viewRefId: programId, viewGroup: ViewGroup.PROGRAM },
						session,
					);
					if (recorded) {
						const updated = await this.programModel
							.findByIdAndUpdate(programId, { $inc: { programViews: 1 } }, { session, new: true })
							.exec();
						if (!updated) throw new NotFoundException('Program not found');
						program.programViews = updated.programViews;
					}
					program.meLiked = await this.likeService.checkLikeExistence(
						{ memberId, likeRefId: programId, likeGroup: LikeGroup.PROGRAM },
						session,
					);
					return program;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (error instanceof mongo.MongoServerError && error.hasErrorLabel('TransientTransactionError'))
				throw new ConflictException('Program changed; reload before retrying');
			throw error;
		}
	}

	async updateProgram(memberId: ObjectId, input: ProgramUpdate): Promise<Program> {
		return this.update(input, memberId);
	}

	async updateProgramByAdmin(input: ProgramUpdate): Promise<Program> {
		return this.update(input);
	}

	private async update(input: ProgramUpdate, memberId?: ObjectId): Promise<Program> {
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647)
			throw new BadRequestException('A valid expected Program revision is required');
		const selector = { _id: input._id, ...(memberId ? { memberId } : {}) };
		const current = await this.programModel.findOne(selector).read('primary').lean().exec();
		if (!current || current.programStatus === ProgramStatus.DELETE)
			throw new NotFoundException('Editable program not found');
		if (current.programRevision !== input.expectedRevision) this.staleProgramEdit();
		const status = input.programStatus === undefined ? current.programStatus : input.programStatus;
		if (!Object.values(ProgramStatus).includes(status)) throw new BadRequestException('Invalid program status');
		const fields = this.pickFields(input);
		const next = { ...current, ...fields };
		assertProgram(next);
		const changes = [
			['programType', 'Program type'],
			['programDuration', 'Program duration'],
			['programLocation', 'Program location'],
		] as const;
		const changed: string[] = changes.filter(([field]) => current[field] !== next[field]).map(([, label]) => label);
		if ((current.programAddress?.trim() ?? '') !== (next.programAddress?.trim() ?? '')) changed.push('Program address');
		const capacityDecrease =
			current.programType === ProgramType.GROUP_CLASS &&
			next.programType === ProgramType.GROUP_CLASS &&
			next.programCapacity < current.programCapacity;
		if (changed.length || capacityDecrease) {
			const now = getSeoulDateTime(new Date());
			const [constraints] = await this.reservationModel
				.aggregate<{ protectedCount: number; maxOccupied: number }>([
					{
						$match: {
							programId: current._id,
							reservationStatus: { $in: capacityOccupyingStatuses },
							$or: [
								{ reservationDate: { $gt: now.reservationDate } },
								{
									reservationDate: now.reservationDate,
									endTime: { $gt: now.time },
								},
							],
						},
					},
					{
						$group: {
							_id: {
								programId: '$programId',
								reservationDate: '$reservationDate',
								startTime: '$startTime',
								endTime: '$endTime',
							},
							occupied: { $sum: 1 },
						},
					},
					{
						$group: {
							_id: null,
							protectedCount: { $sum: '$occupied' },
							maxOccupied: { $max: '$occupied' },
						},
					},
				])
				.read('primary')
				.exec();
			if (constraints?.protectedCount && changed.length)
				throw new BadRequestException(changed[0] + ' cannot be changed while upcoming reservations exist.');
			if (capacityDecrease && next.programCapacity < (constraints?.maxOccupied ?? 0))
				throw new BadRequestException('Program capacity cannot be reduced below occupied session seats.');
		}
		const result = await this.programModel
			.findOneAndUpdate(
				{
					...selector,
					programStatus: current.programStatus,
					__v: current.__v,
					programRevision: input.expectedRevision,
				},
				{
					$set: {
						...fields,
						programStatus: status,
						...(status === ProgramStatus.DELETE ? { deletedAt: new Date() } : {}),
						...(status !== ProgramStatus.ACTIVE ? { programRank: 0 } : {}),
					},
					$inc: { __v: 1, programRevision: 1 },
				},
				{ new: true, runValidators: true },
			)
			.exec();
		if (!result) {
			const latest = await this.programModel.findOne(selector).read('primary').lean().exec();
			if (!latest || latest.programStatus === ProgramStatus.DELETE)
				throw new NotFoundException('Editable program not found');
			if (latest.programRevision !== input.expectedRevision) this.staleProgramEdit();
			throw new ConflictException({
				message: 'Program is busy. Review the latest data before saving again.',
				reason: 'PROGRAM_WRITE_CONTENTION',
			});
		}
		const modifier = Number(status === ProgramStatus.ACTIVE) - Number(current.programStatus === ProgramStatus.ACTIVE);
		if (modifier)
			await this.memberService.memberStatsEditor({ _id: current.memberId, targetKey: 'memberPrograms', modifier });
		return result;
	}

	private staleProgramEdit(): never {
		throw new ConflictException({
			message: 'Program has changed. Refresh and review the latest data.',
			reason: 'PROGRAM_REVISION_CONFLICT',
		});
	}

	private match(search: ProgramSearch): T {
		const match: T = {};
		if (search.memberId) match.memberId = shapeIntoMongoObjectId(search.memberId);
		for (const [key, field] of [
			['locationList', 'programLocation'],
			['typeList', 'programType'],
			['categoryList', 'programCategory'],
		] as const) {
			if (search[key]?.length) match[field] = { $in: search[key] };
		}
		for (const [key, field] of [
			['pricesRange', 'programPrice'],
			['periodsRange', 'createdAt'],
		] as const) {
			const range = search[key];
			if (range) {
				if (range.start > range.end) throw new BadRequestException('Range start must not exceed end');
				match[field] = { $gte: range.start, $lte: range.end };
			}
		}
		if (search.text) match.programName = { $regex: search.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
		return match;
	}

	private async list(
		memberId: ObjectId | null,
		input: ProgramsInquiry | TrainerProgramsInquiry,
		match: T,
		publicOnly: boolean,
	): Promise<Programs> {
		const sort = input.sort ?? 'createdAt';
		if (!availableProgramSorts.includes(sort)) throw new BadRequestException('Invalid program sort');
		const direction = input.direction ?? Direction.DESC;
		if (
			![Direction.ASC, Direction.DESC].includes(direction) ||
			!Number.isInteger(input.page) ||
			input.page < 1 ||
			!Number.isInteger(input.limit) ||
			input.limit < 1
		)
			throw new BadRequestException('Invalid pagination');
		const [result] = await this.programModel
			.aggregate<Programs>([
				{ $match: match },
				...programOwnerStages(publicOnly),
				{ $sort: { [sort]: direction, _id: direction } },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupAuthMemberLiked(memberId, '$_id', LikeGroup.PROGRAM),
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}

	async getPrograms(memberId: ObjectId | null, input: ProgramsInquiry): Promise<Programs> {
		return this.list(memberId, input, { ...this.match(input.search), programStatus: ProgramStatus.ACTIVE }, true);
	}
	async getTrainerPrograms(memberId: ObjectId, input: TrainerProgramsInquiry): Promise<Programs> {
		if (input.search.programStatus === ProgramStatus.DELETE)
			throw new BadRequestException('Deleted programs are available only to administrators');
		return this.list(
			memberId,
			input,
			{
				...this.match(input.search),
				memberId,
				programStatus: input.search.programStatus ?? { $ne: ProgramStatus.DELETE },
			},
			false,
		);
	}
	async getAllProgramsByAdmin(input: AllProgramsInquiry): Promise<Programs> {
		return this.list(
			null,
			input,
			{
				...this.match(input.search),
				...(input.search.programStatus ? { programStatus: input.search.programStatus } : {}),
			},
			false,
		);
	}
	async getFavorites(memberId: ObjectId, input: OrdinaryInquiry): Promise<Programs> {
		return this.likeService.getFavoritePrograms(memberId, input);
	}
	async getVisited(memberId: ObjectId, input: OrdinaryInquiry): Promise<Programs> {
		return this.viewService.getVisitedPrograms(memberId, input);
	}
	async likeTargetProgram(memberId: ObjectId, programId: ObjectId): Promise<Program> {
		try {
			return await this.programModel.db.transaction(
				async (session) => {
					await this.visibleProgram(programId, session);
					const modifier = await this.likeService.toggleLike(
						{ memberId, likeRefId: programId, likeGroup: LikeGroup.PROGRAM },
						session,
					);
					const program = await this.programModel
						.findByIdAndUpdate(programId, { $inc: { programLikes: modifier } }, { session, new: true })
						.exec();
					if (!program) throw new NotFoundException('Program not found');
					return program;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (error instanceof mongo.MongoServerError && error.hasErrorLabel('TransientTransactionError'))
				throw new ConflictException('Program changed; reload before retrying');
			throw error;
		}
	}
	async removeProgramByAdmin(programId: ObjectId): Promise<Program> {
		try {
			return await this.programModel.db.transaction(
				async (session) => {
					const program = await this.programModel
						.findOneAndUpdate(
							{ _id: programId, programStatus: ProgramStatus.DELETE },
							{ $inc: { __v: 1 } },
							{ session, new: true, timestamps: false },
						)
						.exec();
					if (!program) throw new NotFoundException('Soft-deleted program not found');
					const reservation = await this.reservationModel.exists({ programId }).session(session).exec();
					const review = await this.reviewModel.exists({ programId }).session(session).exec();
					if (reservation || review)
						throw new BadRequestException(
							'Program cannot be permanently deleted because reservation or review history exists.',
						);
					await this.likeService.removeProgramLikes(programId, session);
					await this.viewService.removeProgramViews(programId, session);
					await this.notificationModel.deleteMany({ programId }).session(session).exec();
					const removed = await this.programModel
						.findOneAndDelete({ _id: programId, programStatus: ProgramStatus.DELETE, __v: program.__v })
						.session(session)
						.exec();
					if (!removed) throw new ConflictException('Program already removed');
					return removed;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (error instanceof mongo.MongoServerError && error.hasErrorLabel('TransientTransactionError'))
				throw new ConflictException('Program changed; reload before retrying');
			throw error;
		}
	}
}
