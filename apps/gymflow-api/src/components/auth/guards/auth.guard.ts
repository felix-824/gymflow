import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthService } from '../auth.service';
import { GraphQLAuthContext } from '../../../libs/types/auth-context';

@Injectable()
export class AuthGuard implements CanActivate {
	constructor(private readonly authService: AuthService) {}
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = GqlExecutionContext.create(context).getContext<GraphQLAuthContext>().req;
		const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
		if (!token) throw new UnauthorizedException('Authentication required');
		req.body ??= {};
		req.body.authMember = await this.authService.verifyToken(token);
		return true;
	}
}
