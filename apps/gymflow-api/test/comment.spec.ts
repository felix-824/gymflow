import 'reflect-metadata';
import { Types } from 'mongoose';
import { CommentService } from '../src/components/comment/comment.service';
import { CommentStatus } from '../src/libs/enums/comment.enum';
import { dependency, query } from './helpers';
import { StatisticModifier } from '../src/libs/types/common';
const id = new Types.ObjectId();
const articleId = new Types.ObjectId();
const authorId = new Types.ObjectId();
describe('Article comments and counters', () => {
	type State = {
		_id: Types.ObjectId;
		articleId: Types.ObjectId;
		memberId: Types.ObjectId;
		commentContent: string;
		commentStatus: CommentStatus;
	};
	let state: State;
	const mocks = () => ({
		db: {
			create: jest.fn((input: Partial<State>) => Promise.resolve({ ...state, ...input })),
			findOneAndUpdate: jest.fn((filter: { memberId: Types.ObjectId }, update: { $set: Partial<State> }) => {
				if (state.commentStatus !== CommentStatus.ACTIVE || !filter.memberId.equals(authorId))
					return query<State | null>(null);
				state = { ...state, ...update.$set };
				return query<State | null>(state);
			}),
			findByIdAndDelete: jest.fn(() => query(state)),
		},
		articles: { exists: jest.fn(() => query<{ _id: Types.ObjectId } | null>({ _id: articleId })) },
		member: { memberStatsEditor: jest.fn<Promise<void>, [StatisticModifier]>(() => Promise.resolve()) },
		articleService: { boardArticleStatsEditor: jest.fn<Promise<void>, [StatisticModifier]>(() => Promise.resolve()) },
	});
	let service: CommentService;
	let db: ReturnType<typeof mocks>['db'];
	let articles: ReturnType<typeof mocks>['articles'];
	let member: ReturnType<typeof mocks>['member'];
	let articleService: ReturnType<typeof mocks>['articleService'];
	beforeEach(() => {
		state = {
			_id: id,
			articleId,
			memberId: authorId,
			commentContent: 'Good article',
			commentStatus: CommentStatus.ACTIVE,
		};
		({ db, articles, member, articleService } = mocks());
		service = new CommentService(dependency(db), dependency(articles), dependency(member), dependency(articleService));
	});
	it('creates only on an existing active article and counts the author', async () => {
		await service.createComment(authorId, { articleId, commentContent: 'Helpful' });
		expect(articleService.boardArticleStatsEditor).toHaveBeenCalledWith({
			_id: articleId,
			targetKey: 'articleComments',
			modifier: 1,
		});
		expect(member.memberStatsEditor).toHaveBeenCalledWith({ _id: authorId, targetKey: 'memberComments', modifier: 1 });
	});
	it('rejects missing/deleted article without inserting or changing counters', async () => {
		articles.exists.mockReturnValue(query(null));
		await expect(service.createComment(authorId, { articleId, commentContent: 'Helpful' })).rejects.toThrow();
		expect(db.create).not.toHaveBeenCalled();
		expect(member.memberStatsEditor).not.toHaveBeenCalled();
	});
	it('does not allow another author to update a comment', async () => {
		await expect(service.updateComment(articleId, { _id: id, commentContent: 'Changed' })).rejects.toThrow();
		expect(member.memberStatsEditor).not.toHaveBeenCalled();
	});
	it('decrements once on soft deletion, not again on hard removal', async () => {
		const result = await service.updateComment(authorId, { _id: id, commentStatus: CommentStatus.DELETE });
		expect(result.commentStatus).toBe(CommentStatus.DELETE);
		await expect(service.updateComment(authorId, { _id: id, commentStatus: CommentStatus.DELETE })).rejects.toThrow();
		await service.removeCommentByAdmin(id);
		expect(member.memberStatsEditor).toHaveBeenCalledTimes(1);
		expect(articleService.boardArticleStatsEditor).toHaveBeenCalledTimes(1);
	});
	it('decrements both counters when an admin removes an active comment', async () => {
		await service.removeCommentByAdmin(id);
		expect(member.memberStatsEditor).toHaveBeenCalledWith({ _id: authorId, targetKey: 'memberComments', modifier: -1 });
		expect(articleService.boardArticleStatsEditor).toHaveBeenCalledWith({
			_id: articleId,
			targetKey: 'articleComments',
			modifier: -1,
		});
	});
});
