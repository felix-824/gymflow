import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { T } from './libs/types/common';
import type { GraphQLAuthContext } from './libs/types/auth-context';

@Module({
	imports: [
		ConfigModule.forRoot(), //.env
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		GraphQLModule.forRoot({ 
			driver: ApolloDriver,
			playground: true,
			uploads: false,
			autoSchemaFile: true,
			context: ({ req, res }: GraphQLAuthContext) => ({ req, res }),
			formatError: (error: T) => {
				const response = error?.extensions?.originalError ?? error?.extensions?.exception?.response ?? error?.extensions?.response;
				const code = error?.extensions?.code;
				console.warn('GraphQL operation failed', { code });
				return {
					code,
					message: response?.message || error?.message,
					extensions: { code, ...(typeof response?.reason === 'string' ? { reason: response.reason } : {}) },
				};
			},
		}), //REST > GraphQl

		ComponentsModule, // MODULLARni chaqirish
		DatabaseModule,   // DATABASE TCP ni hosil qilyabdi
	],
	controllers: [AppController],
	providers: [AppService, AppResolver],
})
export class AppModule {}
