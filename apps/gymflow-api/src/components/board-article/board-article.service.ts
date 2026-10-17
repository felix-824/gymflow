import {
	BadRequestException,
	ConflictException,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
type ObjectId = Types.ObjectId;
import { BoardArticle, BoardArticles } from '../../libs/dto/board-article/board-article';
import {
	AllBoardArticlesInquiry,
	BoardArticleInput,
	BoardArticlesInquiry,
} from '../../libs/dto/board-article/board-article.input';
import { MemberService } from '../member/member.service';
import { ViewService } from '../view/view.service';
import { Direction, Message } from '../../libs/enums/common.enum';
import { BoardArticleCategory, BoardArticleStatus } from '../../libs/enums/board-article.enum';
import { isArticleContent, isArticleTitle } from '../../libs/board-article.validation';
import { ViewGroup } from '../../libs/enums/view.enum';
import { StatisticModifier, T } from '../../libs/types/common';
import { BoardArticleUpdate } from '../../libs/dto/board-article/board-article.update';
import { OrdinaryInquiry } from '../../libs/dto/common/inquiry';
import {
	escapeRegex,
	lookupAuthMemberLiked,
	lookupMember,
	publicMemberData,
	shapeIntoMongoObjectId,
} from '../../libs/config';
import { LikeService } from '../like/like.service';
import { LikeGroup } from '../../libs/enums/like.enum';
import { LikeInput } from '../../libs/dto/like/like.input';

@Injectable()
export class BoardArticleService {
	constructor(
		@InjectModel('BoardArticle')
		private readonly boardArticleModel: Model<BoardArticle>,

		private readonly memberService: MemberService,
		private readonly viewService: ViewService,
		private readonly likeService: LikeService,
	) {}

	// Yangi board article yaratadi va memberArticles sonini 1 taga oshiradi.
	public async createBoardArticle(memberId: ObjectId, input: BoardArticleInput): Promise<BoardArticle> {
		if (!Object.values(BoardArticleCategory).includes(input.articleCategory))
			throw new BadRequestException('Invalid article category');
		const fields = this.articleUpdateFields(input, true);

		try {
			const result = await this.boardArticleModel.create({
				...fields,
				articleCategory: input.articleCategory,
				memberId,
				articleStatus: BoardArticleStatus.ACTIVE,
			});

			await this.memberService.memberStatsEditor({
				_id: memberId,
				targetKey: 'memberArticles',
				modifier: 1,
			});

			return result;
		} catch (err) {
			console.log('Error, Service.model:', (err as Error).message);
			throw new BadRequestException(Message.CREATE_FAILED);
		}
	}

	// Login memberning target article'ga
	// LIKE/UNLIKE bosishini boshqaradi
	public async likeTargetBoardArticle(memberId: ObjectId, likeRefId: ObjectId): Promise<BoardArticle> {
		const target = await this.boardArticleModel
			.findOne({ _id: likeRefId, articleStatus: BoardArticleStatus.ACTIVE })
			.exec();

		if (!target) throw new InternalServerErrorException(Message.NO_DATA_FOUND);

		const input: LikeInput = {
			memberId: memberId,
			likeRefId: likeRefId,
			likeGroup: LikeGroup.ARTICLE,
		};

		const modifier: number = await this.likeService.toggleLike(input);

		const result = await this.boardArticleStatsEditor({
			_id: likeRefId,
			targetKey: 'articleLikes',
			modifier: modifier,
		});

		if (!result) throw new InternalServerErrorException(Message.SOMETHING_WENT_WRONG);

		return result;
	}

	// Bitta ACTIVE article'ni ID orqali oladi,
	//  view'ni hisoblaydi va muallif ma'lumotini qo‘shadi.
	public async getBoardArticle(memberId: ObjectId, articleId: ObjectId): Promise<BoardArticle> {
		const search: T = {
			_id: articleId,
			articleStatus: BoardArticleStatus.ACTIVE,
		};

		const targetBoardArticle: BoardArticle | null = await this.boardArticleModel.findOne(search).lean().exec();

		if (!targetBoardArticle) {
			throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		}

		if (memberId) {
			const viewInput = {
				memberId: memberId,
				viewRefId: articleId,
				viewGroup: ViewGroup.ARTICLE,
			};

			const newView = await this.viewService.recordView(viewInput);

			if (newView) {
				await this.boardArticleStatsEditor({
					_id: articleId,
					targetKey: 'articleViews',
					modifier: 1,
				});

				targetBoardArticle.articleViews++;

				console.log('after articleViews =>', targetBoardArticle.articleViews);
			}

			// meLiked
			const likeInput = { memberId: memberId, likeRefId: articleId, likeGroup: LikeGroup.ARTICLE };
			targetBoardArticle.meLiked = await this.likeService.checkLikeExistence(likeInput);
		}

		targetBoardArticle.memberData = publicMemberData(
			await this.memberService.getMember(null, targetBoardArticle.memberId),
		);

		return targetBoardArticle;
	}

	public async getMyBoardArticle(memberId: ObjectId, articleId: ObjectId): Promise<BoardArticle> {
		const result = await this.boardArticleModel
			.findOne({ _id: articleId, memberId, articleStatus: BoardArticleStatus.ACTIVE })
			.read('primary')
			.lean()
			.exec();
		if (!result) throw new NotFoundException(Message.NO_DATA_FOUND);
		return result;
	}

	public async getMyBoardArticles(memberId: ObjectId, input: OrdinaryInquiry): Promise<BoardArticles> {
		const match: T = { memberId, articleStatus: BoardArticleStatus.ACTIVE };
		const sort: T = { createdAt: Direction.DESC, _id: Direction.DESC };
		const result = await this.boardArticleModel
			.aggregate<BoardArticles>([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [{ $skip: (input.page - 1) * input.limit }, { $limit: input.limit }],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.read('primary')
			.exec();
		if (!result.length) throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		return result[0];
	}

	// Memberga tegishli ACTIVE article'ni yangilaydi,

	//  DELETE bo‘lsa memberArticles sonini kamaytiradi.
	public async updateBoardArticle(memberId: ObjectId, input: BoardArticleUpdate): Promise<BoardArticle> {
		const { _id, articleStatus, expectedRevision } = input;
		this.assertRevision(expectedRevision);
		if ('articleCategory' in input) throw new BadRequestException('Article category cannot be changed');
		const fields = this.articleUpdateFields(input);

		const result = await this.boardArticleModel
			.findOneAndUpdate(
				{
					_id: _id,
					memberId: memberId,
					articleStatus: BoardArticleStatus.ACTIVE,
					__v: expectedRevision,
				},
				{ $set: fields, $inc: { __v: 1 } },
				{
					new: true,
					runValidators: true,
				},
			)
			.exec();

		if (!result) {
			return await this.articleUpdateFailure(_id, expectedRevision, memberId);
		}

		if (articleStatus === BoardArticleStatus.DELETE) {
			await this.memberService.memberStatsEditor({
				_id: memberId,
				targetKey: 'memberArticles',
				modifier: -1,
			});
		}

		return result;
	}

	// ACTIVE board article'larni filter, search, sort va pagination bilan
	//  olib keladi.
	public async getBoardArticles(memberId: ObjectId, input: BoardArticlesInquiry): Promise<BoardArticles> {
		const { articleCategory } = input.search;
		const text = input.search.text?.trim();
		const match: T = { articleStatus: BoardArticleStatus.ACTIVE };

		const sort: T = { [input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC };

		if (articleCategory) {
			match.articleCategory = articleCategory;
		}

		if (text) {
			match.articleTitle = {
				$regex: escapeRegex(text),
				$options: 'i',
			};
		}

		if (input.search?.memberId) {
			match.memberId = shapeIntoMongoObjectId(input.search.memberId);
		}

		console.log('match:', match);

		const result = await this.boardArticleModel
			.aggregate<BoardArticles>([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{ $skip: (input.page - 1) * input.limit },
							{ $limit: input.limit },
							lookupAuthMemberLiked(memberId, '$_id', LikeGroup.ARTICLE),
							// meLiked
							lookupMember,
							{ $unwind: '$memberData' },
						],
						metaCounter: [{ $count: 'total' }],
					},
				},
			])
			.exec();

		if (!result.length) {
			throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		}

		return result[0];
	}

	// Admin barcha board article'larni status va kategoriya bo‘yicha
	//  filter qilib, pagination bilan olib keladi.
	public async getAllBoardArticlesByAdmin(input: AllBoardArticlesInquiry): Promise<BoardArticles> {
		const { articleStatus, articleCategory } = input.search;

		const match: T = {};

		const sort: T = {
			[input?.sort ?? 'createdAt']: input?.direction ?? Direction.DESC,
		};

		if (articleStatus) {
			match.articleStatus = articleStatus;
		}

		if (articleCategory) {
			match.articleCategory = articleCategory;
		}

		const result = await this.boardArticleModel
			.aggregate<BoardArticles>([
				{ $match: match },
				{ $sort: sort },
				{
					$facet: {
						list: [
							{
								$skip: (input.page - 1) * input.limit,
							},
							{
								$limit: input.limit,
							},
							lookupMember,
							{
								$unwind: '$memberData',
							},
						],

						metaCounter: [
							{
								$count: 'total',
							},
						],
					},
				},
			])
			.exec();

		if (!result.length) {
			throw new InternalServerErrorException(Message.NO_DATA_FOUND);
		}

		return result[0];
	}

	// Admin ACTIVE board article'ni yangilaydi,
	//  DELETE qilinsa memberArticles sonini 1 taga kamaytiradi.
	public async updateBoardArticleByAdmin(input: BoardArticleUpdate): Promise<BoardArticle> {
		const { _id, articleStatus, expectedRevision } = input;
		if (expectedRevision !== undefined) this.assertRevision(expectedRevision);
		if ('articleCategory' in input) throw new BadRequestException('Article category cannot be changed');
		const fields = this.articleUpdateFields(input);

		const result = await this.boardArticleModel
			.findOneAndUpdate(
				{
					_id: _id,
					articleStatus: BoardArticleStatus.ACTIVE,
					...(expectedRevision !== undefined ? { __v: expectedRevision } : {}),
				},
				{ $set: fields, $inc: { __v: 1 } },
				{
					new: true,
					runValidators: true,
				},
			)
			.exec();

		if (!result) {
			return await this.articleUpdateFailure(_id, expectedRevision);
		}

		if (articleStatus === BoardArticleStatus.DELETE) {
			await this.memberService.memberStatsEditor({
				_id: result.memberId,
				targetKey: 'memberArticles',
				modifier: -1,
			});
		}

		return result;
	}

	private assertRevision(revision: number | undefined): void {
		if (!Number.isInteger(revision) || revision! < 0 || revision! >= 2147483647)
			throw new BadRequestException('A valid expected article revision is required');
	}

	private articleUpdateFields(input: Partial<BoardArticleUpdate>, creating = false): Partial<BoardArticle> {
		if ((creating || input.articleTitle !== undefined) && !isArticleTitle(input.articleTitle))
			throw new BadRequestException('Article title must contain 3–50 meaningful characters');
		if ((creating || input.articleContent !== undefined) && !isArticleContent(input.articleContent))
			throw new BadRequestException('Article content must contain meaningful text and 3–5000 characters');
		if (input.articleImage != null && typeof input.articleImage !== 'string')
			throw new BadRequestException('Invalid article image');
		if (input.articleStatus !== undefined && !Object.values(BoardArticleStatus).includes(input.articleStatus))
			throw new BadRequestException('Invalid article status');
		const fields: Partial<BoardArticle> = {};
		for (const key of ['articleTitle', 'articleContent', 'articleImage', 'articleStatus'] as const) {
			if (input[key] !== undefined) Object.assign(fields, { [key]: input[key] });
		}
		return fields;
	}

	private async articleUpdateFailure(_id: ObjectId, expectedRevision?: number, memberId?: ObjectId): Promise<never> {
		const current = await this.boardArticleModel
			.findOne({ _id, ...(memberId ? { memberId } : {}) })
			.read('primary')
			.select('__v')
			.lean()
			.exec();
		if (current && expectedRevision !== undefined && current.__v !== expectedRevision)
			throw new ConflictException('Article changed; reload before saving again');
		throw new NotFoundException(Message.NO_DATA_FOUND);
	}

	// DELETE statusdagi board article'ni database butunlay o‘chiradi.
	public async removeBoardArticleByAdmin(articleId: ObjectId): Promise<BoardArticle> {
		const search: T = {
			_id: articleId,
			articleStatus: BoardArticleStatus.DELETE,
		};

		const result = await this.boardArticleModel.findOneAndDelete(search).exec();

		if (!result) {
			throw new InternalServerErrorException(Message.REMOVE_FAILED);
		}

		return result;
	}

	// Article statistik qiymatini oshiradi yoki kamaytiradi.
	public async boardArticleStatsEditor(input: StatisticModifier): Promise<BoardArticle | null> {
		const { _id, targetKey, modifier } = input;

		return await this.boardArticleModel
			.findByIdAndUpdate(
				_id,
				{
					$inc: { [targetKey]: modifier },
				},
				{
					new: true,
				},
			)
			.exec();
	}
}
