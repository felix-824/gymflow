import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthService } from '../auth.service';
import { GraphQLAuthContext } from '../../../libs/types/auth-context';

@Injectable()
export class RolesGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly authService: AuthService,
	) {}
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const roles = this.reflector.get<string[]>('roles', context.getHandler());
		if (!roles) return true;
		const req = GqlExecutionContext.create(context).getContext<GraphQLAuthContext>().req;
		const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
		if (!token) throw new ForbiddenException('Authentication required');
		const member = await this.authService.verifyToken(token);
		if (!roles.includes(member.memberType)) throw new ForbiddenException('Role not permitted');
		req.body ??= {};
		req.body.authMember = member;
		return true;
	}
}
