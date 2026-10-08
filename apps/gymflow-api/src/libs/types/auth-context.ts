import { Member } from '../dto/member/member';
export interface GraphQLAuthContext {
	req: { headers: { authorization?: string }; body?: { authMember?: Member | null } };
}
