import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import {
	TrainerApplicationReview,
	TrainerApplicationsInquiry,
} from '../src/libs/dto/trainer-application/trainer-application-admin.input';
import { TrainerApplicationStatus } from '../src/libs/enums/trainer-application.enum';
import {
	assertTrainerApplicationsInquiry,
	normalizeTrainerApplicationReview,
} from '../src/libs/trainer-application.validation';
import { dependency } from './helpers';

const applicationId = String(new Types.ObjectId());
const approve = { applicationId, decision: TrainerApplicationStatus.APPROVED };
const reject = { applicationId, decision: TrainerApplicationStatus.REJECTED, rejectionReason: ' Add experience ' };
describe('Admin trainer application contracts', () => {
	it('accepts explicit terminal decisions and normalizes rejection reasons without copying client audit fields', async () => {
		for (const input of [approve, reject])
			expect(await validate(plainToInstance(TrainerApplicationReview, input))).toEqual([]);
		expect(normalizeTrainerApplicationReview(approve)).toEqual(approve);
		expect(
			normalizeTrainerApplicationReview({
				...reject,
				reviewedBy: 'injected',
				reviewedAt: new Date(),
			} as TrainerApplicationReview),
		).toEqual({ ...reject, rejectionReason: 'Add experience' });
	});
	it.each([
		{ decision: TrainerApplicationStatus.PENDING },
		{ decision: 'UNKNOWN' },
		{ applicationId: 'bad' },
		{ decision: null },
		{ rejectionReason: '' },
		{ rejectionReason: '   ' },
		{ rejectionReason: null },
		{ rejectionReason: undefined },
		{ rejectionReason: 'a'.repeat(1001) },
	])('rejects invalid rejection input at DTO and service boundaries: %#', async (change) => {
		const input = plainToInstance(TrainerApplicationReview, { ...reject, ...change });
		expect((await validate(input)).length).toBeGreaterThan(0);
		expect(() => normalizeTrainerApplicationReview(input)).toThrow();
	});
	it.each([null, '', '   ', 'A reason'])('rejects a supplied approval rejectionReason %j', (rejectionReason) => {
		expect(() => normalizeTrainerApplicationReview({ ...approve, rejectionReason })).toThrow('must not include');
	});
	it('accepts a maximum-length trimmed rejection reason', async () => {
		const input = plainToInstance(TrainerApplicationReview, {
			...reject,
			rejectionReason: ' ' + 'a'.repeat(1000) + ' ',
		});
		expect(await validate(input)).toEqual([]);
		expect(normalizeTrainerApplicationReview(input).rejectionReason).toHaveLength(1000);
	});
	it.each([undefined, null, ...Object.values(TrainerApplicationStatus)])(
		'accepts bounded list filtering %s',
		async (status) => {
			const input = plainToInstance(TrainerApplicationsInquiry, { page: 1, limit: 100, search: { status } });
			expect(await validate(input)).toEqual([]);
			expect(() => assertTrainerApplicationsInquiry(input)).not.toThrow();
		},
	);
	it.each([
		{ page: 0 },
		{ page: 1.5 },
		{ limit: 0 },
		{ limit: 101 },
		{ limit: 1.5 },
		{ search: null },
		{ search: [] },
		{ search: { status: 'UNKNOWN' } },
	])('rejects invalid inquiry %#', async (change) => {
		const input = plainToInstance(TrainerApplicationsInquiry, { page: 1, limit: 10, search: {}, ...change });
		expect((await validate(input)).length).toBeGreaterThan(0);
		expect(() => assertTrainerApplicationsInquiry(input)).toThrow();
	});
	it('also rejects an overflowing page in direct service calls', () => {
		expect(() =>
			assertTrainerApplicationsInquiry(dependency({ page: Number.MAX_SAFE_INTEGER, limit: 10, search: {} })),
		).toThrow();
	});
});
