import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AuthToken {
	@Field(() => String)
	accessToken: string;
}
