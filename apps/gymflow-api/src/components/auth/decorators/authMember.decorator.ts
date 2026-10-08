import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GraphQLAuthContext } from '../../../libs/types/auth-context';
import { Member } from '../../../libs/dto/member/member';

export const AuthMember = createParamDecorator(
	(data: keyof Member | undefined, context: ExecutionContext): Member | Member[keyof Member] | null => {
		const req = GqlExecutionContext.create(context).getContext<GraphQLAuthContext>().req;
		const member = req.body?.authMember;
		if (!member) return null;
		return data ? member[data] : member;
	},
);
