import { Query, Resolver } from '@nestjs/graphql';

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
@Resolver()
export class AppResolver {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	@Query(() => String)
	public sayHello(): string {
		return 'GraphQl API Server';
	}
}
