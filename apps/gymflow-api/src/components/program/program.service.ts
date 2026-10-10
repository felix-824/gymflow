import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { ProgramStatus } from '../../libs/enums/program.enum';
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
export class ProgramService {
	constructor(
		@InjectModel('Program') private readonly programModel: Model<Program>,
		@InjectModel('Notification') private readonly notificationModel: Model<any>,
		private readonly memberService: MemberService,
		private readonly viewService: ViewService,
		private readonly likeService: LikeService,
	) {}

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

	private async visibleProgram(programId: ObjectId): Promise<Program> {
		const [program] = await this.programModel
			.aggregate<Program>([{ $match: { _id: programId } }, ...programOwnerStages(true)])
			.exec();
		if (!program) throw new NotFoundException('Program not found');
		return program;
	}

	async getProgram(memberId: ObjectId | null, programId: ObjectId): Promise<Program> {
		const program = await this.visibleProgram(programId);
		if (memberId) {
			const recorded = await this.viewService.recordView({
				memberId,
				viewRefId: programId,
				viewGroup: ViewGroup.PROGRAM,
			});
			if (recorded) {
				const updated = await this.programModel
					.findByIdAndUpdate(programId, { $inc: { programViews: 1 } }, { new: true })
					.exec();
				program.programViews = updated?.programViews ?? program.programViews;
			}
			program.meLiked = await this.likeService.checkLikeExistence({
				memberId,
				likeRefId: programId,
				likeGroup: LikeGroup.PROGRAM,
			});
		}
		return program;
	}

	async updateProgram(memberId: ObjectId, input: ProgramUpdate): Promise<Program> {
		return this.update(input, memberId);
	}

	async updateProgramByAdmin(input: ProgramUpdate): Promise<Program> {
		return this.update(input);
	}

	private async update(input: ProgramUpdate, memberId?: ObjectId): Promise<Program> {
		const selector = { _id: input._id, ...(memberId ? { memberId } : {}) };
		const current = await this.programModel.findOne(selector).lean().exec();
		if (!current || current.programStatus === ProgramStatus.DELETE)
			throw new NotFoundException('Editable program not found');
		const status = input.programStatus === undefined ? current.programStatus : input.programStatus;
		if (!Object.values(ProgramStatus).includes(status)) throw new BadRequestException('Invalid program status');
		const fields = this.pickFields(input);
		assertProgram({ ...current, ...fields });
		const result = await this.programModel
			.findOneAndUpdate(
				{ ...selector, programStatus: current.programStatus, __v: current.__v },
				{
					$set: {
						...fields,
						programStatus: status,
						...(status === ProgramStatus.DELETE ? { deletedAt: new Date() } : {}),
						...(status !== ProgramStatus.ACTIVE ? { programRank: 0 } : {}),
					},
					$inc: { __v: 1 },
				},
				{ new: true, runValidators: true },
			)
			.exec();
		if (!result) throw new ConflictException('Program changed; reload before retrying');
		const modifier = Number(status === ProgramStatus.ACTIVE) - Number(current.programStatus === ProgramStatus.ACTIVE);
		if (modifier)
			await this.memberService.memberStatsEditor({ _id: current.memberId, targetKey: 'memberPrograms', modifier });
		return result;
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
		await this.visibleProgram(programId);
		const modifier = await this.likeService.toggleLike({
			memberId,
			likeRefId: programId,
			likeGroup: LikeGroup.PROGRAM,
		});
		const program = await this.programModel
			.findByIdAndUpdate(programId, { $inc: { programLikes: modifier } }, { new: true })
			.exec();
		if (!program) throw new NotFoundException('Program not found');
		return program;
	}
	async removeProgramByAdmin(programId: ObjectId): Promise<Program> {
		const program = await this.programModel.findOne({ _id: programId, programStatus: ProgramStatus.DELETE }).exec();
		if (!program) throw new NotFoundException('Soft-deleted program not found');
		// Cleanup first: a failure leaves a soft-deleted parent so the operation can be retried.
		await this.likeService.removeProgramLikes(programId);
		await this.viewService.removeProgramViews(programId);
		await this.notificationModel.deleteMany({ programId }).exec();
		const removed = await this.programModel
			.findOneAndDelete({ _id: programId, programStatus: ProgramStatus.DELETE })
			.exec();
		if (!removed) throw new ConflictException('Program already removed');
		return removed;
	}
}
