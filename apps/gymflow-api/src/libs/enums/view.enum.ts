import { registerEnumType } from '@nestjs/graphql';

export enum ViewGroup {
	MEMBER = 'MEMBER',
	ARTICLE = 'ARTICLE',
	PROGRAM = 'PROGRAM',
}
registerEnumType(ViewGroup, {
	name: 'ViewGroup',
});
