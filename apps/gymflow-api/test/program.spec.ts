import 'reflect-metadata';
import { model, Types, PipelineStage } from 'mongoose';
import { assertProgram } from '../src/libs/program.validation';
import ProgramSchema from '../src/schemas/Program.model';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../src/libs/enums/program.enum';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramService } from '../src/components/program/program.service';
import { ProgramResolver } from '../src/components/program/program.resolver';
import { savedProgramStages } from '../src/libs/program.aggregation';

import { ProgramInput } from '../src/libs/dto/program/program.input';
import { ProgramUpdate } from '../src/libs/dto/program/program.update';
import { StatisticModifier } from '../src/libs/types/common';
import { dependency, query } from './helpers';

const id = new Types.ObjectId();
const owner = new Types.ObjectId();
const valid = (): ProgramInput => ({
	programType: ProgramType.PT_1ON1,
	programCategory: ProgramCategory.MUSCLE_GAIN,
	programLocation: ProgramLocation.SEOUL,
	programName: 'Strength session',
	programAddress: 'Seoul gym',
	programPrice: 50000,
	programDuration: 60,
	programCapacity: 1,
	programImages: ['uploads/program/photo.png'],
});
describe('Program validation and persistence contract', () => {
	const ProgramModel = model('ProgramValidationTest', ProgramSchema);
	it.each([
		['programCategory', 'APARTMENT'],
		['programLocation', 'JEJU'],
		['programPrice', -1],
		['programPrice', 1.5],
		['programDuration', 0],
		['programCapacity', 0],
		['programCapacity', 2],
		['programImages', []],
		['programImages', ['']],
		['programName', null],
		['programPrice', null],
		['programAddress', null],
	])('rejects invalid %s=%j', (key, value) => {
		expect(() => assertProgram({ ...valid(), [key]: value })).toThrow();
	});
	it('accepts a complete in-person program', () => expect(() => assertProgram(valid())).not.toThrow());
	it('accepts online with no address, rejects mismatched delivery/location', () => {
		const online = {
			...valid(),
			programType: ProgramType.ONLINE,
			programLocation: ProgramLocation.ONLINE,
			programAddress: null,
			programCapacity: 20,
		};
		expect(() => assertProgram(online)).not.toThrow();
		expect(() => assertProgram({ ...online, programLocation: ProgramLocation.SEOUL })).toThrow();
		expect(() => assertProgram({ ...valid(), programLocation: ProgramLocation.ONLINE })).toThrow();
	});
	it('validates schema defaults and arrays without opening a connection', async () => {
		const doc = new ProgramModel({ ...valid(), memberId: owner });
		await expect(doc.validate()).resolves.toBeUndefined();
		expect(doc.programStatus).toBe(ProgramStatus.ACTIVE);
		expect(doc.programLikes).toBe(0);
		expect(doc.programImages).toEqual(valid().programImages);
		await expect(new ProgramModel({ ...valid(), programCapacity: 3, memberId: owner }).validate()).rejects.toThrow();
		expect(ProgramSchema.get('collection')).toBe('programs');
		expect(ProgramSchema.indexes().every(([, options]) => !options.unique)).toBe(true);
	});
});

describe('Program lifecycle and discovery', () => {
	type State = ProgramInput & {
		_id: Types.ObjectId;
		memberId: Types.ObjectId;
		__v: number;
		programStatus: ProgramStatus;
		programLikes: number;
		programViews: number;
		deletedAt?: Date;
	};
	let state: State;
	const mocks = () => ({
		modelMock: {
			findOne: jest.fn((filter: { memberId?: Types.ObjectId }) =>
				query<State | null>(!filter.memberId || filter.memberId.equals(owner) ? { ...state } : null),
			),
			findOneAndUpdate: jest.fn((filter: { __v: number }, update: { $set: Partial<State> }) => {
				if (filter.__v !== state.__v) return query<State | null>(null);
				state = { ...state, ...update.$set, __v: state.__v + 1 };
				return query<State | null>({ ...state });
			}),
			create: jest.fn((input: Partial<State>) => Promise.resolve({ ...state, ...input })),
			aggregate: jest.fn((...args: [PipelineStage[]]) => {
				void args;
				return query([{ list: [], metaCounter: [] }]);
			}),
			findOneAndDelete: jest.fn(() => query(state)),
		},
		member: {
			memberStatsEditor: jest.fn<Promise<void>, [StatisticModifier]>(() => Promise.resolve()),
			getMember: jest.fn(() => Promise.resolve({ memberType: MemberType.TRAINER, memberStatus: MemberStatus.ACTIVE })),
		},
		like: {
			getFavoritePrograms: jest.fn<Promise<unknown>, [Types.ObjectId, { page: number; limit: number }]>(() =>
				Promise.resolve({ list: [], metaCounter: [] }),
			),
			removeProgramLikes: jest.fn<Promise<void>, [Types.ObjectId]>(() => Promise.resolve()),
		},
		view: { getVisitedPrograms: jest.fn(), removeProgramViews: jest.fn() },
		notifications: { deleteMany: jest.fn(() => query({})) },
	});
	let modelMock: ReturnType<typeof mocks>['modelMock'];
	let member: ReturnType<typeof mocks>['member'];
	let like: ReturnType<typeof mocks>['like'];
	let view: ReturnType<typeof mocks>['view'];
	let notifications: ReturnType<typeof mocks>['notifications'];
	let service: ProgramService;
	beforeEach(() => {
		state = {
			...valid(),
			_id: id,
			memberId: owner,
			__v: 0,
			programStatus: ProgramStatus.ACTIVE,
			programLikes: 0,
			programViews: 0,
		};
		({ modelMock, member, like, view, notifications } = mocks());
		service = new ProgramService(
			dependency(modelMock),
			dependency(notifications),
			dependency(member),
			dependency(view),
			dependency(like),
		);
	});
	it('creates with authenticated ownership and ignores client counters/status', async () => {
		await service.createProgram(owner, {
			...valid(),
			memberId: id,
			programStatus: ProgramStatus.DELETE,
			programLikes: 999,
		} as ProgramInput);
		expect(modelMock.create).toHaveBeenCalledWith(
			expect.objectContaining({ memberId: owner, programStatus: ProgramStatus.ACTIVE }),
		);
		expect(modelMock.create.mock.calls[0][0]).not.toHaveProperty('programLikes');
		expect(member.memberStatsEditor).toHaveBeenCalledWith({ _id: owner, targetKey: 'memberPrograms', modifier: 1 });
	});
	it('rejects a non-trainer owner even when called directly', async () => {
		member.getMember.mockResolvedValue({ memberType: MemberType.USER, memberStatus: MemberStatus.ACTIVE });
		await expect(service.createProgram(owner, valid())).rejects.toThrow();
		expect(modelMock.create).not.toHaveBeenCalled();
	});
	it('pauses, resumes, and deletes with exactly one counter delta per transition', async () => {
		await service.updateProgram(owner, { _id: id, programStatus: ProgramStatus.PAUSED });
		await service.updateProgram(owner, { _id: id, programStatus: ProgramStatus.PAUSED });
		await service.updateProgram(owner, { _id: id, programName: 'Updated session' });
		await service.updateProgram(owner, { _id: id, programStatus: ProgramStatus.ACTIVE });
		const deleted = await service.updateProgram(owner, { _id: id, programStatus: ProgramStatus.DELETE });
		expect(deleted.deletedAt).toBeInstanceOf(Date);
		expect(member.memberStatsEditor.mock.calls.map(([input]) => input.modifier)).toEqual([-1, 1, -1]);
		await expect(service.updateProgram(owner, { _id: id, programStatus: ProgramStatus.ACTIVE })).rejects.toThrow();
		expect(member.memberStatsEditor).toHaveBeenCalledTimes(3);
	});
	it('validates the merged document and rejects null required fields', async () => {
		await expect(service.updateProgram(owner, { _id: id, programType: ProgramType.ONLINE })).rejects.toThrow();
		await expect(
			service.updateProgram(owner, { _id: id, programName: null } as unknown as ProgramUpdate),
		).rejects.toThrow();
		expect(modelMock.findOneAndUpdate).not.toHaveBeenCalled();
	});
	it('denies another trainer and rejects stale concurrent edits without changing counters', async () => {
		await expect(service.updateProgram(new Types.ObjectId(), { _id: id, programName: 'Other' })).rejects.toThrow();
		modelMock.findOneAndUpdate.mockReturnValue(query(null));
		await expect(service.updateProgram(owner, { _id: id, programStatus: ProgramStatus.PAUSED })).rejects.toThrow(
			'Program changed',
		);
		expect(member.memberStatsEditor).not.toHaveBeenCalled();
	});
	it('filters and escapes literal name search; rejects invalid ranges and sorting', async () => {
		await service.getPrograms(null, {
			page: 1,
			limit: 10,
			search: {
				categoryList: [ProgramCategory.YOGA],
				locationList: [ProgramLocation.SEOUL],
				text: '[yoga]',
			},
		});
		const stages = modelMock.aggregate.mock.calls[0][0];
		expect(stages[0]).toMatchObject({ $match: { programName: { $regex: '\\[yoga\\]' } } });
		expect(stages[0]).toMatchObject({ $match: { programCategory: { $in: [ProgramCategory.YOGA] } } });
		const visibility = stages.findIndex((stage) => '$match' in stage && 'memberData.memberStatus' in stage.$match);
		expect(visibility).toBeGreaterThan(0);
		expect(visibility).toBeLessThan(stages.findIndex((stage) => '$facet' in stage));
		await expect(
			service.getPrograms(null, { page: 1, limit: 10, sort: 'memberPassword', search: {} }),
		).rejects.toThrow();
		await expect(
			service.getPrograms(null, { page: 1, limit: 10, search: { pricesRange: { start: 20, end: 10 } } }),
		).rejects.toThrow();
	});
	it('forces owner scope for trainer listings even when search specifies another trainer', async () => {
		await service.getTrainerPrograms(owner, { page: 1, limit: 10, search: { memberId: id.toHexString() } });
		expect(modelMock.aggregate.mock.calls[0][0][0]).toMatchObject({ $match: { memberId: owner } });
	});
	it('routes favorites to the saved-program service, not discovery', async () => {
		const resolver = new ProgramResolver(service);
		await resolver.getFavorites({ page: 1, limit: 10 }, owner);
		expect(like.getFavoritePrograms).toHaveBeenCalledWith(owner, { page: 1, limit: 10 });
		expect(modelMock.aggregate).not.toHaveBeenCalled();
	});
	it('cleans child records before hard delete, without another owner decrement', async () => {
		state.programStatus = ProgramStatus.DELETE;
		await service.removeProgramByAdmin(id);
		expect(like.removeProgramLikes).toHaveBeenCalledWith(id);
		expect(view.removeProgramViews).toHaveBeenCalledWith(id);
		expect(notifications.deleteMany).toHaveBeenCalledWith({ programId: id });
		expect(member.memberStatsEditor).not.toHaveBeenCalled();
	});
	it('leaves the deleted parent available for retry when child cleanup fails', async () => {
		state.programStatus = ProgramStatus.DELETE;
		like.removeProgramLikes.mockRejectedValue(new Error('storage unavailable'));
		await expect(service.removeProgramByAdmin(id)).rejects.toThrow('storage unavailable');
		expect(modelMock.findOneAndDelete).not.toHaveBeenCalled();
	});
	it.each(['like', 'view'] as const)('%s saved lists count only visible programs', (kind) => {
		const stages = savedProgramStages(kind, owner, 2, 5);
		expect(stages[0]).toEqual({ $match: { [kind + 'Group']: 'PROGRAM', memberId: owner } });
		const visibility = stages.findIndex((stage) => '$match' in stage && 'memberData.memberStatus' in stage.$match);
		expect(visibility).toBeLessThan(stages.findIndex((stage) => '$facet' in stage));
		expect(stages.at(-1)).toMatchObject({ $facet: { list: [{ $skip: 5 }, { $limit: 5 }] } });
	});
});
