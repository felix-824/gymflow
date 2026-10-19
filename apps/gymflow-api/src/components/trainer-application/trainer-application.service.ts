import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';
import { Member } from '../../libs/dto/member/member';
import { TrainerApplication } from '../../libs/dto/trainer-application/trainer-application';
import { TrainerApplicationInput } from '../../libs/dto/trainer-application/trainer-application.input';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import { TrainerApplicationStatus } from '../../libs/enums/trainer-application.enum';
import { normalizeTrainerApplicationInput } from '../../libs/trainer-application.validation';

@Injectable()
export class TrainerApplicationService {
	constructor(
		@InjectModel('TrainerApplication') private readonly applicationModel: Model<TrainerApplication>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}

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
