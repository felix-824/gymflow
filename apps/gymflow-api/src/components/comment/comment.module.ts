import { Module } from '@nestjs/common';
import { CommentResolver } from './comment.resolver';
import { CommentService } from './comment.service';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { MemberModule } from '../member/member.module';
import CommentSchema from '../../schemas/Comment.model';
import BoardArticleSchema from '../../schemas/BoardArticle.model';
import { BoardArticleModule } from '../board-article/board-article.module';

@Module({
	imports: [
		MongooseModule.forFeature([
			{
				name: 'Comment',
				schema: CommentSchema,
			},
			{ name: 'BoardArticle', schema: BoardArticleSchema },
		]),
		AuthModule,
		MemberModule,

		BoardArticleModule,
	],
	providers: [CommentResolver, CommentService],
})
export class CommentModule {}
