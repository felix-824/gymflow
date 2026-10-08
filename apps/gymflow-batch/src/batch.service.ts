import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Member } from 'apps/gymflow-api/src/libs/dto/member/member';
import { Program } from 'apps/gymflow-api/src/libs/dto/program/program';
import { MemberStatus, MemberType } from 'apps/gymflow-api/src/libs/enums/member.enum';
import { ProgramStatus } from 'apps/gymflow-api/src/libs/enums/program.enum';
import { Model, Types } from 'mongoose';

@Injectable()
export class BatchService {
	constructor(
		@InjectModel('Program') private readonly programModel: Model<Program>,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
	) {}
	private async reconcilePrograms(): Promise<void> {
		const counts = await this.programModel
			.aggregate<{ _id: Types.ObjectId; total: number }>([
				{ $match: { programStatus: ProgramStatus.ACTIVE } },
				{ $group: { _id: '$memberId', total: { $sum: 1 } } },
			])
			.exec();
		const totals = new Map(counts.map((item) => [item._id.toHexString(), item.total]));
		const members = await this.memberModel.find().select('_id').lean().exec();
		if (members.length)
			await this.memberModel.bulkWrite(
				members.map((member) => ({
					updateOne: {
						filter: { _id: member._id },
						update: { $set: { memberPrograms: totals.get(member._id.toHexString()) ?? 0 } },
					},
				})),
			);
	}
	async batchRollback(): Promise<void> {
		await this.reconcilePrograms();
		const trainers = await this.memberModel
			.find({ memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE })
			.select('_id')
			.lean()
			.exec();
		await this.programModel
			.updateMany(
				{
					$or: [
						{ programStatus: { $ne: ProgramStatus.ACTIVE } },
						{ memberId: { $nin: trainers.map((trainer) => trainer._id) } },
					],
				},
				{ $set: { programRank: 0 } },
			)
			.exec();
		await this.memberModel
			.updateMany(
				{ $or: [{ memberType: { $ne: MemberType.TRAINER } }, { memberStatus: { $ne: MemberStatus.ACTIVE } }] },
				{ $set: { memberRank: 0 } },
			)
			.exec();
	}
	async batchTopPrograms(): Promise<void> {
		// Reconcile engagement caches as well as rank after interrupted API updates.
		const programs = await this.programModel
			.aggregate<Program & { owner: Member[] }>([
				{
					$lookup: {
						from: 'likes',
						let: { id: '$_id' },
						pipeline: [
							{ $match: { likeGroup: 'PROGRAM', $expr: { $eq: ['$likeRefId', '$$id'] } } },
							{ $count: 'total' },
						],
						as: 'likes',
					},
				},
				{
					$lookup: {
						from: 'views',
						let: { id: '$_id' },
						pipeline: [
							{ $match: { viewGroup: 'PROGRAM', $expr: { $eq: ['$viewRefId', '$$id'] } } },
							{ $count: 'total' },
						],
						as: 'views',
					},
				},
				{ $lookup: { from: 'members', localField: 'memberId', foreignField: '_id', as: 'owner' } },
				{
					$set: {
						programLikes: { $ifNull: [{ $arrayElemAt: ['$likes.total', 0] }, 0] },
						programViews: { $ifNull: [{ $arrayElemAt: ['$views.total', 0] }, 0] },
					},
				},
			])
			.exec();
		for (const program of programs) {
			const eligible =
				program.programStatus === ProgramStatus.ACTIVE &&
				program.owner[0]?.memberType === MemberType.TRAINER &&
				program.owner[0]?.memberStatus === MemberStatus.ACTIVE;
			await this.programModel
				.updateOne(
					{ _id: program._id, programStatus: program.programStatus },
					{
						$set: {
							programLikes: program.programLikes,
							programViews: program.programViews,
							programRank: eligible ? program.programLikes * 2 + program.programViews : 0,
						},
					},
				)
				.exec();
		}
	}
	async batchTopTrainers(): Promise<void> {
		await this.reconcilePrograms();
		// Update pipeline computes from the latest stored counters, without a rank=0 gate.
		await this.memberModel
			.updateMany({ memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE }, [
				{
					$set: {
						memberRank: {
							$add: [
								{ $multiply: [{ $ifNull: ['$memberPrograms', 0] }, 5] },
								{ $multiply: [{ $ifNull: ['$memberArticles', 0] }, 3] },
								{ $multiply: [{ $ifNull: ['$memberLikes', 0] }, 2] },
								{ $ifNull: ['$memberViews', 0] },
							],
						},
					},
				},
			])
			.exec();
		await this.memberModel
			.updateMany(
				{ $or: [{ memberType: { $ne: MemberType.TRAINER } }, { memberStatus: { $ne: MemberStatus.ACTIVE } }] },
				{ $set: { memberRank: 0 } },
			)
			.exec();
	}
	getHello(): string {
		return 'Welcome to GymFlow BATCH Server!';
	}
}
