import { Schema } from 'mongoose';
import { CommentStatus } from '../libs/enums/comment.enum';
const CommentSchema = new Schema(
	{
		commentStatus: { type: String, enum: CommentStatus, required: true, default: CommentStatus.ACTIVE },
		commentContent: { type: String, required: true, minlength: 1, maxlength: 100 },
		articleId: { type: Schema.Types.ObjectId, required: true, ref: 'BoardArticle' },
		memberId: { type: Schema.Types.ObjectId, required: true, ref: 'Member' },
	},
	{ timestamps: true, collection: 'comments' },
);
CommentSchema.index({ articleId: 1, commentStatus: 1, createdAt: -1 });
export default CommentSchema;
