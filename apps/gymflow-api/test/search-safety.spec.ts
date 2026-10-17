import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { escapeRegex } from '../src/libs/config';
import { MembersInquiry, TrainersInquiry } from '../src/libs/dto/member/member.input';
import { BoardArticlesInquiry } from '../src/libs/dto/board-article/board-article.input';
import { AllProgramsInquiry, ProgramsInquiry, TrainerProgramsInquiry } from '../src/libs/dto/program/program.input';
import { OrdinaryInquiry } from '../src/libs/dto/common/inquiry';

const inquiries = [
	TrainersInquiry,
	MembersInquiry,
	BoardArticlesInquiry,
	ProgramsInquiry,
	TrainerProgramsInquiry,
	AllProgramsInquiry,
];
describe('Literal search safety', () => {
	it.each([
		'gym',
		'.',
		'*',
		'.*',
		'(',
		'[',
		']',
		'\\',
		'^',
		'$',
		'+',
		'?',
		'|',
		'{}',
		'{1,3}',
		'a{100000}',
		'gym.*',
		'(trainer',
		'[yoga',
		'\uc694\uac00',
	])('escapes %j as literal text', (text) => {
		const pattern = new RegExp(escapeRegex(text), 'i');
		expect(pattern.test('before ' + text + ' after')).toBe(true);
		expect(pattern.test('unrelated text')).toBe(false);
	});
	it('preserves case-insensitive substring matching and internal whitespace', () => {
		expect(new RegExp(escapeRegex('gym  studio'), 'i').test('A GYM  STUDIO session')).toBe(true);
		expect(new RegExp(escapeRegex('gym  studio'), 'i').test('gym studio')).toBe(false);
	});
	for (const inquiry of inquiries) {
		describe(inquiry.name, () => {
			const errors = (patch: object) =>
				validateSync(plainToInstance(inquiry, { page: 1, limit: 10, search: {}, ...patch }));
			it('validates nested text: 100 accepted, 101 and non-string rejected', () => {
				expect(errors({ search: { text: 'x'.repeat(100) } })).toHaveLength(0);
				for (const text of ['x'.repeat(101), 123, {}]) {
					expect(
						errors({ search: { text } }).some(
							(error) => error.property === 'search' && error.children?.some((child) => child.property === 'text'),
						),
					).toBe(true);
				}
			});
			it('allows omitted/null text and preserves explicit empty Program behavior', () => {
				expect(errors({ search: {} })).toHaveLength(0);
				expect(errors({ search: { text: null } })).toHaveLength(0);
				expect(errors({ search: { text: '' } }).length > 0).toBe(
					inquiry !== TrainersInquiry && inquiry !== MembersInquiry && inquiry !== BoardArticlesInquiry,
				);
			});
			it.each([1, 100])('accepts limit %i', (limit) => expect(errors({ limit })).toHaveLength(0));
			it.each([0, -1, 101, 2147483647])('rejects limit %i', (limit) =>
				expect(errors({ limit }).length).toBeGreaterThan(0),
			);
		});
	}
	it('does not change unrelated OrdinaryInquiry limits', () =>
		expect(validateSync(plainToInstance(OrdinaryInquiry, { page: 1, limit: 101 }))).toHaveLength(0));
});
