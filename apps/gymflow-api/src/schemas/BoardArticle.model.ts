import { Schema } from 'mongoose';
import { BoardArticleCategory, BoardArticleStatus } from '../libs/enums/board-article.enum';
import { isArticleContent, isArticleTitle } from '../libs/board-article.validation';

const BoardArticleSchema = new Schema(
	{
		articleCategory: {
			type: String,
			enum: BoardArticleCategory,
			required: true,
		},

		articleStatus: {
			type: String,
			enum: BoardArticleStatus,
			default: BoardArticleStatus.ACTIVE,
			required: true,
		},

		articleTitle: {
			type: String,
			required: true,
			validate: isArticleTitle,
		},

		articleContent: {
			type: String,
			required: true,
			validate: isArticleContent,
		},

		articleImage: {
			type: String,
		},

		articleLikes: {
			type: Number,
			default: 0,
		},

		articleViews: {
			type: Number,
			default: 0,
		},

		articleComments: {
			type: Number,
			default: 0,
		},

		memberId: {
			type: Schema.Types.ObjectId,
			required: true,
			ref: 'Member',
		},
	},
	{ timestamps: true, collection: 'boardArticles' },
);

export default BoardArticleSchema;
