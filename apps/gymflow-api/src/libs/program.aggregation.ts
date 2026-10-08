import type { PipelineStage } from 'mongoose';
import { MemberStatus, MemberType } from './enums/member.enum';
import { ProgramStatus } from './enums/program.enum';

// Run before pagination/counting so missing or unavailable owners never inflate totals.
export function programOwnerStages(publicOnly: boolean): PipelineStage[] {
	return [
		{
			$lookup: {
				from: 'members',
				localField: 'memberId',
				foreignField: '_id',
				as: 'memberData',
				pipeline: [{ $project: { memberPassword: 0 } }],
			},
		},
		{ $unwind: { path: '$memberData', preserveNullAndEmptyArrays: !publicOnly } },
		...(publicOnly
			? [
					{
						$match: {
							programStatus: ProgramStatus.ACTIVE,
							'memberData.memberType': MemberType.TRAINER,
							'memberData.memberStatus': MemberStatus.ACTIVE,
						},
					},
				]
			: []),
	];
}

export function savedProgramStages(
	kind: 'like' | 'view',
	memberId: unknown,
	page: number,
	limit: number,
): PipelineStage[] {
	return [
		{ $match: { [kind + 'Group']: 'PROGRAM', memberId } },
		{ $sort: { updatedAt: -1, _id: -1 } },
		{ $lookup: { from: 'programs', localField: kind + 'RefId', foreignField: '_id', as: 'program' } },
		{ $unwind: '$program' },
		{ $replaceRoot: { newRoot: '$program' } },
		...programOwnerStages(true),
		{
			$facet: {
				list: [{ $skip: (page - 1) * limit }, { $limit: limit }],
				metaCounter: [{ $count: 'total' }],
			},
		},
	];
}
