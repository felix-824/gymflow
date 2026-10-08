import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { MemberService } from '../member/member.service';
import { BoardArticleService } from '../board-article/board-article.service';
import { CommentInput, CommentsInquiry } from '../../libs/dto/comment/comment.input';
import { CommentUpdate } from '../../libs/dto/comment/comment.update';
import { Comment, Comments } from '../../libs/dto/comment/comment';
import { CommentStatus } from '../../libs/enums/comment.enum';
import { BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { Direction } from '../../libs/enums/common.enum';
import { lookupMember, shapeIntoMongoObjectId } from '../../libs/config';

@Injectable()
export class CommentService {
	constructor(
		@InjectModel('Comment') private readonly commentModel: Model<Comment>,
		@InjectModel('BoardArticle') private readonly articleModel: Model<any>,
		private readonly memberService: MemberService,
		private readonly boardArticleService: BoardArticleService,
	) {}
	private async counters(comment: Comment, modifier: number): Promise<void> {
		await this.boardArticleService.boardArticleStatsEditor({
			_id: comment.articleId,
			targetKey: 'articleComments',
			modifier,
		});
		await this.memberService.memberStatsEditor({ _id: comment.memberId, targetKey: 'memberComments', modifier });
	}
	async createComment(memberId: ObjectId, input: CommentInput): Promise<Comment> {
		const articleId = shapeIntoMongoObjectId(input.articleId);
		if (!(await this.articleModel.exists({ _id: articleId, articleStatus: BoardArticleStatus.ACTIVE }).exec()))
			throw new NotFoundException('Active article not found');
		const result = await this.commentModel.create({ memberId, articleId, commentContent: input.commentContent });
		await this.counters(result, 1);
		return result;
	}
	async updateComment(memberId: ObjectId, input: CommentUpdate): Promise<Comment> {
		if (input.commentStatus !== undefined && !Object.values(CommentStatus).includes(input.commentStatus))
			throw new BadRequestException('Invalid comment status');
		const before = await this.commentModel
			.findOneAndUpdate(
				{ _id: input._id, memberId, commentStatus: CommentStatus.ACTIVE },
				{
					$set: {
						...(input.commentContent !== undefined ? { commentContent: input.commentContent } : {}),
						...(input.commentStatus !== undefined ? { commentStatus: input.commentStatus } : {}),
					},
				},
				{ new: true, runValidators: true },
			)
			.exec();
		if (!before) throw new NotFoundException('Active comment not found');
		if (input.commentStatus === CommentStatus.DELETE) await this.counters(before, -1);
		return before;
	}
	async getComments(_memberId: ObjectId, input: CommentsInquiry): Promise<Comments> {
		const [result] = await this.commentModel
			.aggregate<Comments>([
				{ $match: { articleId: shapeIntoMongoObjectId(input.search.articleId), commentStatus: CommentStatus.ACTIVE } },
				{
					$sort: {
						[input.sort ?? 'createdAt']: input.direction ?? Direction.DESC,
						_id: input.direction ?? Direction.DESC,
					},
				},
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupMember,
							{ $unwind: { path: '$memberData', preserveNullAndEmptyArrays: true } },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();
		return result ?? { list: [], metaCounter: [] };
	}
	async removeCommentByAdmin(id: ObjectId): Promise<Comment> {
		const removed = await this.commentModel.findByIdAndDelete(id).exec();
		if (!removed) throw new NotFoundException('Comment not found');
		if (removed.commentStatus === CommentStatus.ACTIVE) await this.counters(removed, -1);
		return removed;
	}
}
