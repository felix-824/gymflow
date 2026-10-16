import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { model, Types } from 'mongoose';
import { isArticleContent, isArticleTitle } from '../src/libs/board-article.validation';
import { BoardArticleInput } from '../src/libs/dto/board-article/board-article.input';
import { BoardArticleUpdate } from '../src/libs/dto/board-article/board-article.update';
import { BoardArticleCategory, BoardArticleStatus } from '../src/libs/enums/board-article.enum';
import BoardArticleSchema from '../src/schemas/BoardArticle.model';
import { BoardArticleService } from '../src/components/board-article/board-article.service';
import { dependency, query } from './helpers';

const ArticleModel = model('ArticleAuthoringUnit', BoardArticleSchema);
const owner = new Types.ObjectId();
const valid = () => ({
	articleCategory: BoardArticleCategory.FREE,
	articleTitle: 'Training advice',
	articleContent: '<p>Train consistently.</p>',
});

describe('Community authoring text and DTO validation', () => {
	it.each([3, 50])('accepts a title of %i characters', (length) => {
		expect(isArticleTitle('a'.repeat(length))).toBe(true);
		expect(validateSync(plainToInstance(BoardArticleInput, { ...valid(), articleTitle: 'a'.repeat(length) }))).toEqual(
			[],
		);
	});
	it.each([null, undefined, '', '  ', '   ', '\u200b\u200c\u200d', 'ab', 'a'.repeat(51), ' a '])(
		'rejects meaningless/out-of-range title %j',
		(title) => {
			expect(isArticleTitle(title)).toBe(false);
		},
	);
	it.each(['\u034f', '\ufe0f', '\u3164'])('rejects invisible-only Unicode %j consistently', async (invisible) => {
		const articleTitle = invisible.repeat(3),
			articleContent = '<p>' + invisible.repeat(3) + '</p>';
		expect(isArticleTitle(articleTitle)).toBe(false);
		expect(isArticleContent(articleContent)).toBe(false);
		await expect(new ArticleModel({ ...valid(), memberId: owner, articleTitle }).validate()).rejects.toThrow();
		await expect(new ArticleModel({ ...valid(), memberId: owner, articleContent }).validate()).rejects.toThrow();
	});
	it.each([3, 250, 251, 5000])('accepts create/update content of %i characters', (length) => {
		const articleContent = 'a'.repeat(length);
		expect(isArticleContent(articleContent)).toBe(true);
		expect(validateSync(plainToInstance(BoardArticleInput, { ...valid(), articleContent }))).toEqual([]);
		expect(
			validateSync(
				plainToInstance(BoardArticleUpdate, { _id: owner.toHexString(), expectedRevision: 0, articleContent }),
			),
		).toEqual([]);
	});
	it.each([
		null,
		undefined,
		'',
		'ab',
		' '.repeat(3),
		'\n\t ',
		'a'.repeat(5001),
		'<p></p>',
		'<p><br></p>',
		'<div>\n</div>',
		'<p>&nbsp;</p>',
		'<p>&nbsp</p>',
		'<p>&shy</p>',
		'<p>&#160;&#xA0;&#X20;</p>',
		'<p>&ZeroWidthSpace;&NewLine;&emsp13;</p>',
		'<p>\u200b\u200c\u200d</p>',
		'<p title="not body > text"> </p>',
		'<!-- only a comment -->',
		'<!-- unclosed comment',
		'<script>alert(1)</script>',
		'<style>body {color:red}</style>',
		'<template>hidden text</template>',
		'<head><title>Title is not article content</title></head>',
		'<script>unclosed script',
		'<img src="image.jpg">',
	])('rejects empty/meaningless/out-of-range HTML %j', (content) => {
		expect(isArticleContent(content)).toBe(false);
	});
	it.each(['ApplyFunction', 'af', 'InvisibleTimes', 'it', 'InvisibleComma', 'ic'])(
		'rejects invisible HTML entity %s',
		(name) => {
			expect(isArticleContent('<p>&' + name + ';</p>')).toBe(false);
		},
	);
	it.each([
		'<p>Consistent training matters.</p>',
		'<p>a</p>',
		'<p>&amp;nbsp;</p>',
		'<p>&#38;nbsp;</p>',
		'<p>&emsp</p>',
		'<p>&ZeroWidthSpace</p>',
		'<p>&ApplyFunction</p>',
		'<p>2 &lt; 3</p>',
		'<p>근력 운동</p>',
		'<p><strong>Train</strong> well.</p>',
		'<p>' + 'a'.repeat(4993) + '</p>',
	])('preserves valid HTML %s', (content) => {
		expect(isArticleContent(content)).toBe(true);
	});
	it.each(['articleTitle', 'articleContent', 'articleStatus', 'expectedRevision'])(
		'rejects explicit null %s in update DTO',
		(field) => {
			const errors = validateSync(plainToInstance(BoardArticleUpdate, { _id: owner.toHexString(), [field]: null }));
			expect(errors.some((error) => error.property === field)).toBe(true);
		},
	);
	it('keeps optional image omission/null/empty string and the legacy admin input valid', () => {
		for (const articleImage of [undefined, null, '', 'uploads/article/photo.png']) {
			expect(validateSync(plainToInstance(BoardArticleUpdate, { _id: owner.toHexString(), articleImage }))).toEqual([]);
		}
		expect(
			validateSync(
				plainToInstance(BoardArticleUpdate, { _id: owner.toHexString(), articleStatus: BoardArticleStatus.DELETE }),
			),
		).toEqual([]);
	});
	it.each([-1, 0.5, '0', null])('rejects invalid revision %j', (expectedRevision) => {
		expect(
			validateSync(plainToInstance(BoardArticleUpdate, { _id: owner.toHexString(), expectedRevision })).length,
		).toBeGreaterThan(0);
	});
});

describe('Community authoring Mongoose and direct service boundaries', () => {
	it.each(Object.values(BoardArticleCategory))('accepts category %s and defaults ACTIVE', async (articleCategory) => {
		const doc = new ArticleModel({ ...valid(), memberId: owner, articleCategory });
		await expect(doc.validate()).resolves.toBeUndefined();
		expect(doc.articleStatus).toBe(BoardArticleStatus.ACTIVE);
	});
	it.each([
		{ articleTitle: null },
		{ articleTitle: '   ' },
		{ articleTitle: 'ab' },
		{ articleTitle: 'a'.repeat(51) },
		{ articleContent: null },
		{ articleContent: '   ' },
		{ articleContent: '<p>&nbsp;</p>' },
		{ articleContent: 'a'.repeat(5001) },
		{ articleCategory: 'HUMOR' },
		{ articleStatus: null },
	])('model validation rejects %j', async (patch) => {
		await expect(new ArticleModel({ ...valid(), memberId: owner, ...patch }).validate()).rejects.toThrow();
	});
	it('model and DTO accept Unicode title boundaries consistently', async () => {
		const articleTitle = '🏋'.repeat(50);
		expect(validateSync(plainToInstance(BoardArticleInput, { ...valid(), articleTitle }))).toEqual([]);
		await expect(new ArticleModel({ ...valid(), memberId: owner, articleTitle }).validate()).resolves.toBeUndefined();
	});
	it('requires owner revision before any database write', async () => {
		const write = jest.fn();
		const service = new BoardArticleService(
			dependency({ findOneAndUpdate: write }),
			dependency({}),
			dependency({}),
			dependency({}),
		);
		await expect(service.updateBoardArticle(owner, { _id: owner, articleTitle: 'New title' })).rejects.toThrow(
			'expected article revision',
		);
		expect(write).not.toHaveBeenCalled();
	});
	it('whitelists create ownership/status/counters even for an internal spoofed input', async () => {
		const create = jest.fn((input: object) => Promise.resolve(input));
		const stats = jest.fn(() => Promise.resolve());
		const service = new BoardArticleService(
			dependency({ create }),
			dependency({ memberStatsEditor: stats }),
			dependency({}),
			dependency({}),
		);
		await service.createBoardArticle(owner, {
			...valid(),
			memberId: new Types.ObjectId(),
			articleStatus: 'DELETE',
			articleLikes: 99,
		} as BoardArticleInput);
		expect(create.mock.calls[0][0]).toMatchObject({ memberId: owner, articleStatus: 'ACTIVE' });
		expect(create.mock.calls[0][0]).not.toHaveProperty('articleLikes');
		expect(stats).toHaveBeenCalledWith({ _id: owner, targetKey: 'memberArticles', modifier: 1 });
	});
	it('owner lookup does not call public engagement/member services', async () => {
		const row = { ...valid(), _id: owner, memberId: owner, articleStatus: 'ACTIVE', __v: 0 };
		const result = query(row);
		const findOne = jest.fn(() => ({ ...result, read: () => result }));
		const view = { recordView: jest.fn() },
			member = { getMember: jest.fn() },
			like = { checkLikeExistence: jest.fn() };
		const service = new BoardArticleService(
			dependency({ findOne }),
			dependency(member),
			dependency(view),
			dependency(like),
		);
		await expect(service.getMyBoardArticle(owner, owner)).resolves.toEqual(row);
		expect(findOne).toHaveBeenCalledWith({ _id: owner, memberId: owner, articleStatus: 'ACTIVE' });
		expect(view.recordView).not.toHaveBeenCalled();
		expect(member.getMember).not.toHaveBeenCalled();
		expect(like.checkLikeExistence).not.toHaveBeenCalled();
	});
	it('owner listing ignores supplied ownership/status/sorting and has no public side effects', async () => {
		const row = { ...valid(), _id: owner, memberId: owner, articleStatus: 'ACTIVE', __v: 0 };
		const list = { list: [row], metaCounter: [{ total: 1 }] };
		const result = query([list]);
		const read = jest.fn(() => result);
		const aggregate = jest.fn(() => ({ ...result, read }));
		const member = { getMember: jest.fn(), memberStatsEditor: jest.fn() },
			view = { recordView: jest.fn() },
			like = { checkLikeExistence: jest.fn() };
		const service = new BoardArticleService(
			dependency({ aggregate }),
			dependency(member),
			dependency(view),
			dependency(like),
		);
		const inquiry = {
			page: 2,
			limit: 3,
			memberId: new Types.ObjectId(),
			articleStatus: BoardArticleStatus.DELETE,
			sort: 'articleViews',
			direction: 'ASC',
			search: { memberId: new Types.ObjectId() },
		};
		await expect(service.getMyBoardArticles(owner, inquiry)).resolves.toEqual(list);
		expect(aggregate).toHaveBeenCalledWith([
			{ $match: { memberId: owner, articleStatus: BoardArticleStatus.ACTIVE } },
			{ $sort: { createdAt: -1, _id: -1 } },
			{ $facet: { list: [{ $skip: 3 }, { $limit: 3 }], metaCounter: [{ $count: 'total' }] } },
		]);
		expect(read).toHaveBeenCalledWith('primary');
		expect(member.getMember).not.toHaveBeenCalled();
		expect(member.memberStatsEditor).not.toHaveBeenCalled();
		expect(view.recordView).not.toHaveBeenCalled();
		expect(like.checkLikeExistence).not.toHaveBeenCalled();
	});
});
