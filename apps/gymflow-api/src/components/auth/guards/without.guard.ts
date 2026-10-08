import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthService } from '../auth.service';
import { GraphQLAuthContext } from '../../../libs/types/auth-context';

@Injectable()
export class WithoutGuard implements CanActivate {
	constructor(private readonly authService: AuthService) {}
	async canActivate(context: ExecutionContext): Promise<boolean> {
		const req = GqlExecutionContext.create(context).getContext<GraphQLAuthContext>().req;
		req.body ??= {};
		req.body.authMember = null;
		const token = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
		if (token) {
			try {
				req.body.authMember = await this.authService.verifyToken(token);
			} catch {
				/* Public reads remain available to unauthenticated visitors. */
			}
		}
		return true;
	}
}
