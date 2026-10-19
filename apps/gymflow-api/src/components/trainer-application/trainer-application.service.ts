import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, PipelineStage, Types, mongo } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { TrainerApplication } from '../../libs/dto/trainer-application/trainer-application';
import { TrainerApplicationInput } from '../../libs/dto/trainer-application/trainer-application.input';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { TrainerApplicationStatus } from '../../libs/enums/trainer-application.enum';
import {
	assertTrainerApplicationsInquiry,
	normalizeTrainerApplicationInput,
	normalizeTrainerApplicationReview,
} from '../../libs/trainer-application.validation';
import {
	TrainerApplicationAdmin,
	TrainerApplications,
} from '../../libs/dto/trainer-application/trainer-application-admin';
import {
	TrainerApplicationReview,
	TrainerApplicationsInquiry,
} from '../../libs/dto/trainer-application/trainer-application-admin.input';
import { shapeIntoMongoObjectId } from '../../libs/config';

const applicantLookup: PipelineStage.FacetPipelineStage[] = [
	{
		$lookup: {
			from: 'members',
			localField: 'memberId',
			foreignField: '_id',
			as: 'memberData',
			pipeline: [
				{ $project: { _id: 1, memberNick: 1, memberFullName: 1, memberImage: 1, memberType: 1, memberStatus: 1 } },
			],
		},
	},
	{ $unwind: { path: '$memberData', preserveNullAndEmptyArrays: true } },
];

@Injectable()
export class TrainerApplicationService {
	constructor(
		@InjectModel('TrainerApplication') private readonly applicationModel: Model<TrainerApplication>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

	private async assertActiveAdmin(reviewerId: Types.ObjectId): Promise<void> {
		if (
			!(await this.memberModel
				.exists({ _id: reviewerId, memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE })
				.exec())
		)
			throw new ForbiddenException('An active ADMIN account is required');
	}

	private async adminApplication(
		applicationId: Types.ObjectId,
		session?: ClientSession,
	): Promise<TrainerApplicationAdmin> {
		const query = this.applicationModel.aggregate<TrainerApplicationAdmin>([
			{ $match: { _id: applicationId } },
			...applicantLookup,
		]);
		if (session) query.session(session);
		const [application] = await query.exec();
		if (!application) throw new NotFoundException('Trainer application not found');
		return application;
	}

	public async getTrainerApplicationsByAdmin(
		reviewerId: Types.ObjectId,
		input: TrainerApplicationsInquiry,
	): Promise<TrainerApplications> {
		await this.assertActiveAdmin(reviewerId);
		assertTrainerApplicationsInquiry(input);
		const [result] = await this.applicationModel
			.aggregate<TrainerApplications>([
				{ $match: input.search.status != null ? { status: input.search.status } : {} },
				{ $sort: { createdAt: -1, _id: -1 } },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }, ...applicantLookup],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}

	public async getTrainerApplicationByAdmin(
		reviewerId: Types.ObjectId,
		applicationId: string,
	): Promise<TrainerApplicationAdmin> {
		await this.assertActiveAdmin(reviewerId);
		return await this.adminApplication(shapeIntoMongoObjectId(applicationId));
	}

	public async reviewTrainerApplication(
		reviewerId: Types.ObjectId,
		input: TrainerApplicationReview,
	): Promise<TrainerApplicationAdmin> {
		await this.assertActiveAdmin(reviewerId);
		const normalized = normalizeTrainerApplicationReview(input);
		const applicationId = shapeIntoMongoObjectId(normalized.applicationId);
		// Choose contention identities only; ownership and review state are read again inside the transaction.
		const initial = await this.applicationModel.findById(applicationId).select('memberId').lean().exec();
		if (!initial) throw new NotFoundException('Trainer application not found');
		await this.applicationModel.init();
		try {
			return await this.applicationModel.db.transaction(
				async (session) => {
					const identities = [
						{ _id: reviewerId, isReviewer: true },
						{ _id: initial.memberId, isReviewer: false },
					].sort((left, right) => left._id.toString().localeCompare(right._id.toString()));
					let applicant: Pick<Member, 'memberType' | 'memberStatus'> | null = null;
					for (const identity of identities) {
						const member = await this.memberModel
							.findOneAndUpdate(
								{
									_id: identity._id,
									...(identity.isReviewer ? { memberType: MemberType.ADMIN, memberStatus: MemberStatus.ACTIVE } : {}),
								},
								{ $inc: { __v: 1 } },
								{ session, new: true, timestamps: false },
							)
							.select('_id memberType memberStatus')
							.lean()
							.exec();
						if (identity.isReviewer && !member) throw new ForbiddenException('An active ADMIN account is required');
						if (!identity.isReviewer) applicant = member;
					}
					if (!applicant) throw new ConflictException('Application applicant is missing');
					const current = await this.applicationModel
						.findOne({ _id: applicationId, memberId: initial.memberId })
						.session(session)
						.lean()
						.exec();
					if (!current) throw new ConflictException('Application identity changed; reload before reviewing');
					if (current.status !== TrainerApplicationStatus.PENDING) {
						if (current.status !== normalized.decision)
							throw new ConflictException('Application already has a different review decision');
						const expectedRole =
							current.status === TrainerApplicationStatus.APPROVED ? MemberType.TRAINER : MemberType.USER;
						if (
							applicant.memberType !== expectedRole ||
							!current.reviewedBy ||
							!current.reviewedAt ||
							(current.status === TrainerApplicationStatus.REJECTED && !current.rejectionReason?.trim())
						)
							throw new ConflictException('Reviewed application state is inconsistent');
						return await this.adminApplication(applicationId, session);
					}
					if (applicant.memberType !== MemberType.USER)
						throw new ConflictException('Application applicant role is inconsistent');
					if (normalized.decision === TrainerApplicationStatus.APPROVED) {
						if (applicant.memberStatus !== MemberStatus.ACTIVE)
							throw new ForbiddenException('An active USER account is required for approval');
						const promoted = await this.memberModel
							.findOneAndUpdate(
								{ _id: initial.memberId, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE },
								{ $set: { memberType: MemberType.TRAINER } },
								{ session, new: true, runValidators: true },
							)
							.select('_id')
							.lean()
							.exec();
						if (!promoted) throw new ConflictException('Application applicant changed; reload before reviewing');
					}
					const reviewed = await this.applicationModel
						.findOneAndUpdate(
							{ _id: applicationId, memberId: initial.memberId, status: TrainerApplicationStatus.PENDING },
							{
								$set: {
									status: normalized.decision,
									rejectionReason:
										normalized.decision === TrainerApplicationStatus.REJECTED ? normalized.rejectionReason : null,
									reviewedBy: reviewerId,
									reviewedAt: new Date(),
								},
							},
							{ session, new: true, runValidators: true },
						)
						.select('_id')
						.lean()
						.exec();
					if (!reviewed) throw new ConflictException('Application changed; reload before reviewing');
					return await this.adminApplication(applicationId, session);
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (
				error instanceof mongo.MongoServerError &&
				(error.code === 11000 || error.hasErrorLabel('TransientTransactionError'))
			)
				throw new ConflictException('Application changed concurrently; reload before retrying');
			throw error;
		}
	}

	public async getMyTrainerApplication(memberId: Types.ObjectId): Promise<TrainerApplication | null> {
		if (!(await this.memberModel.exists({ _id: memberId, memberStatus: MemberStatus.ACTIVE }).exec()))
			throw new ForbiddenException('An active account is required');
		return await this.applicationModel.findOne({ memberId }).sort({ createdAt: -1, _id: -1 }).lean().exec();
	}

	public async submitTrainerApplication(
		memberId: Types.ObjectId,
		input: TrainerApplicationInput,
	): Promise<TrainerApplication> {
		const normalized = normalizeTrainerApplicationInput(input);
		await this.applicationModel.init();
		try {
			return await this.applicationModel.db.transaction(
				async (session) => {
					const member = await this.memberModel
						.findOneAndUpdate(
							{ _id: memberId, memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE },
							{ $inc: { __v: 1 } },
							{ session, new: true, timestamps: false },
						)
						.select('_id')
						.lean()
						.exec();
					if (!member) throw new ForbiddenException('An active USER account is required');
					const active = await this.applicationModel
						.findOne({
							memberId,
							status: { $in: [TrainerApplicationStatus.PENDING, TrainerApplicationStatus.APPROVED] },
						})
						.session(session)
						.lean()
						.exec();
					if (active) throw new ConflictException('A pending or approved trainer application already exists');
					const latest = await this.applicationModel
						.findOne({ memberId })
						.sort({ createdAt: -1, _id: -1 })
						.session(session)
						.lean()
						.exec();
					if (
						latest
							? latest.status !== TrainerApplicationStatus.REJECTED ||
								String(latest._id) !== normalized.previousApplicationId?.toLowerCase()
							: normalized.previousApplicationId != null
					)
						throw new ConflictException('Application history changed; reload before submitting');
					const [application] = await this.applicationModel.create(
						[
							{
								memberId,
								status: TrainerApplicationStatus.PENDING,
								fullName: normalized.fullName,
								categories: normalized.categories,
								experienceSummary: normalized.experienceSummary,
								bio: normalized.bio,
							},
						],
						{ session },
					);
					return application;
				},
				{ readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
			);
		} catch (error: unknown) {
			if (
				error instanceof mongo.MongoServerError &&
				(error.code === 11000 || error.hasErrorLabel('TransientTransactionError'))
			)
				throw new ConflictException('Application changed concurrently; reload before retrying');
			throw error;
		}
	}
}
