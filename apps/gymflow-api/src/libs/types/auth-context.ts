import { Request, Response } from 'express';
import { Member } from '../dto/member/member';

export interface GraphQLAuthContext {
	req: Request & { body: { authMember?: Member | null } };
	res: Response;
}
