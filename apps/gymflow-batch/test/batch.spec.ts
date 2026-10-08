import 'reflect-metadata';
import { BatchService } from '../src/batch.service';
import { BatchController } from '../src/batch.controller';
import { MemberStatus, MemberType } from '../../gymflow-api/src/libs/enums/member.enum';
import { ProgramStatus } from '../../gymflow-api/src/libs/enums/program.enum';
import { Types } from 'mongoose';
import { dependency, query } from '../../gymflow-api/test/helpers';
const trainer = new Types.ObjectId();
const empty = new Types.ObjectId();
describe('Program and trainer batch jobs', () => {
	it('reconciles trainer counts, including zero-program members, repeatedly', async () => {
		const programs = {
			aggregate: jest.fn(() => query([{ _id: trainer, total: 2 }])),
			updateMany: jest.fn((_filter: unknown, _update: unknown) => {
				void _filter;
				void _update;
				return query({});
			}),
		};
		const members = {
			find: jest.fn(() => query([{ _id: trainer }, { _id: empty }])),
			bulkWrite: jest.fn<Promise<void>, [unknown[]]>(() => Promise.resolve()),
			updateMany: jest.fn((_filter: unknown, _update: unknown) => {
				void _filter;
				void _update;
				return query({});
			}),
		};
		const batch = new BatchService(dependency(programs), dependency(members));
		await batch.batchRollback();
		await batch.batchRollback();
		expect(members.bulkWrite).toHaveBeenCalledTimes(2);
		expect(members.bulkWrite.mock.calls[0][0]).toEqual([
			{ updateOne: { filter: { _id: trainer }, update: { $set: { memberPrograms: 2 } } } },
			{ updateOne: { filter: { _id: empty }, update: { $set: { memberPrograms: 0 } } } },
		]);
		expect(members.bulkWrite.mock.calls[1][0]).toEqual(members.bulkWrite.mock.calls[0][0]);
		expect(programs.updateMany.mock.calls[0][1]).toEqual({ $set: { programRank: 0 } });
	});
	it('ranks eligible programs and resets paused or blocked-owner programs', async () => {
		const owner = [{ memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE }];
		const fixtures = [
			{ _id: 'active', programStatus: ProgramStatus.ACTIVE, programLikes: 3, programViews: 5, owner },
			{ _id: 'paused', programStatus: ProgramStatus.PAUSED, programLikes: 3, programViews: 5, owner },
			{
				_id: 'blocked',
				programStatus: ProgramStatus.ACTIVE,
				programLikes: 3,
				programViews: 5,
				owner: [{ memberType: MemberType.TRAINER, memberStatus: MemberStatus.BLOCK }],
			},
		];
		const db = {
			aggregate: jest.fn(() => query(fixtures)),
			updateOne: jest.fn((_filter: unknown, update: { $set: { programRank: number } }) => query({ ...update })),
		};
		await new BatchService(dependency(db), dependency({})).batchTopPrograms();
		expect(db.updateOne.mock.calls.map(([, update]) => update.$set.programRank)).toEqual([11, 0, 0]);
		expect(db.updateOne.mock.calls[0][0]).toEqual({ _id: 'active', programStatus: ProgramStatus.ACTIVE });
	});
	it('computes trainer rank from current counters without a rank-zero condition', async () => {
		const programs = { aggregate: () => query([]) };
		const members = {
			find: () => query([]),
			updateMany: jest.fn((_filter: unknown, _update: unknown) => {
				void _filter;
				void _update;
				return query({});
			}),
		};
		await new BatchService(dependency(programs), dependency(members)).batchTopTrainers();
		const [filter, pipeline] = members.updateMany.mock.calls[0];
		expect(filter).toEqual({ memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE });
		expect(pipeline).toMatchObject([
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
		]);
	});
	it('preserves the 0/20/40 second schedules', () => {
		const methods = ['batchRollback', 'batchTopPrograms', 'batchTopTrainers'] as const;
		const options = methods.map(
			(method) =>
				Reflect.getMetadata(
					'SCHEDULE_CRON_OPTIONS',
					Object.getOwnPropertyDescriptor(BatchController.prototype, method)?.value as object,
				) as { cronTime: string; name: string },
		);
		expect(options.map((option) => option.cronTime)).toEqual(['00 * * * * *', '20 * * * * *', '40 * * * * *']);
		expect(options.map((option) => option.name)).toEqual([
			'BATCH_ROLLBACK',
			'BATCH_TOP_PROGRAMS',
			'BATCH_TOP_TRAINERS',
		]);
	});
});
