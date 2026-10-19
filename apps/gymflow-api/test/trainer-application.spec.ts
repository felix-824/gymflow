import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { model, Types } from 'mongoose';
import { TrainerApplicationInput } from '../src/libs/dto/trainer-application/trainer-application.input';
import { ProgramCategory } from '../src/libs/enums/program.enum';
import { TrainerApplicationStatus } from '../src/libs/enums/trainer-application.enum';
import { normalizeTrainerApplicationInput } from '../src/libs/trainer-application.validation';
import TrainerApplicationSchema from '../src/schemas/TrainerApplication.model';
import { dependency } from './helpers';

const valid = () => ({
	fullName: ' Applicant Name ',
	categories: [ProgramCategory.YOGA, ProgramCategory.CARDIO],
	experienceSummary: ' Five years teaching ',
	bio: ' Helping people train safely ',
});
const invalid: [string, Record<string, unknown>][] = [
	['short name', { fullName: ' ab ' }],
	['blank name', { fullName: '   ' }],
	['long name', { fullName: 'a'.repeat(101) }],
	['non-string name', { fullName: 123 }],
	['empty categories', { categories: [] }],
	['duplicate categories', { categories: [ProgramCategory.YOGA, ProgramCategory.YOGA] }],
	['invalid category', { categories: ['OTHER'] }],
	['non-array categories', { categories: ProgramCategory.YOGA }],
	['null categories', { categories: null }],
	['blank experience', { experienceSummary: '  ' }],
	['long experience', { experienceSummary: 'a'.repeat(1001) }],
	['non-string experience', { experienceSummary: null }],
	['blank bio', { bio: '  ' }],
	['long bio', { bio: 'a'.repeat(2001) }],
	['non-string bio', { bio: 12 }],
	['invalid previous ID', { previousApplicationId: 'invalid' }],
	['non-string previous ID', { previousApplicationId: 123 }],
];

describe('Trainer application input and persistence contracts', () => {
	it('normalizes text without mutating input or copying server-owned fields', () => {
		const input = {
			...valid(),
			memberId: new Types.ObjectId(),
			status: TrainerApplicationStatus.APPROVED,
			rejectionReason: 'injected',
			reviewedBy: new Types.ObjectId(),
			reviewedAt: new Date(),
			createdAt: new Date(),
		};
		expect(normalizeTrainerApplicationInput(input)).toEqual({
			fullName: 'Applicant Name',
			categories: [ProgramCategory.YOGA, ProgramCategory.CARDIO],
			experienceSummary: 'Five years teaching',
			bio: 'Helping people train safely',
		});
		expect(input.fullName).toBe(' Applicant Name ');
	});
	it.each(invalid)('rejects %s in direct service validation', (_label, changes) => {
		expect(() =>
			normalizeTrainerApplicationInput(dependency<TrainerApplicationInput>({ ...valid(), ...changes })),
		).toThrow();
	});
	it.each(invalid)('rejects %s at the DTO boundary', async (_label, changes) => {
		expect(
			(await validate(plainToInstance(TrainerApplicationInput, { ...valid(), ...changes }))).length,
		).toBeGreaterThan(0);
	});
	it('accepts exact maximum lengths, all categories, nullable predecessor and trimmed DTO values', async () => {
		const input = {
			fullName: 'a'.repeat(100),
			categories: Object.values(ProgramCategory),
			experienceSummary: 'b'.repeat(1000),
			bio: 'c'.repeat(2000),
			previousApplicationId: null,
		};
		expect(normalizeTrainerApplicationInput(input)).toMatchObject({
			fullName: input.fullName,
			categories: input.categories,
		});
		expect(await validate(plainToInstance(TrainerApplicationInput, input))).toEqual([]);
		const dto = plainToInstance(TrainerApplicationInput, valid());
		expect(await validate(dto)).toEqual([]);
		expect(dto.fullName).toBe('Applicant Name');
	});
	it('enforces persistence bounds/category uniqueness and defaults PENDING', () => {
		const Application = model('TrainerApplicationDisconnected', TrainerApplicationSchema);
		const record = new Application({ ...valid(), memberId: new Types.ObjectId() });
		expect(record.validateSync()).toBeUndefined();
		expect(record.status).toBe(TrainerApplicationStatus.PENDING);
		expect(record.fullName).toBe('Applicant Name');
		for (const changes of [
			{ categories: [] },
			{ categories: ['OTHER'] },
			{ categories: [ProgramCategory.YOGA, ProgramCategory.YOGA] },
			{ fullName: ' ' },
			{ fullName: 'a'.repeat(101) },
			{ experienceSummary: ' ' },
			{ bio: 'a'.repeat(2001) },
			{ status: 'UNKNOWN' },
		]) {
			expect(new Application({ ...valid(), memberId: new Types.ObjectId(), ...changes }).validateSync()).toBeDefined();
		}
	});
});
