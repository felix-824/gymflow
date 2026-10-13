import { registerEnumType } from '@nestjs/graphql';

export enum BoardArticleCategory {
	FREE = 'FREE',
	TIP = 'TIP',
	SUCCESS_STORY = 'SUCCESS_STORY',
	NEWS = 'NEWS',
}
registerEnumType(BoardArticleCategory, {
	name: 'BoardArticleCategory',
});

export enum BoardArticleStatus {
	ACTIVE = 'ACTIVE',
	DELETE = 'DELETE',
}
registerEnumType(BoardArticleStatus, {
	name: 'BoardArticleStatus',
});
