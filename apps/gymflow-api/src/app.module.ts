import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { AppResolver } from './app.resolver';
import { ComponentsModule } from './components/components.module';
import { DatabaseModule } from './database/database.module';
import { graphqlOptions } from './libs/graphql.config';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
	imports: [
		ConfigModule.forRoot(), //.env
		GraphQLModule.forRootAsync({ driver: ApolloDriver, useFactory: () => graphqlOptions() }), //REST > GraphQl

		ComponentsModule, // MODULLARni chaqirish
		DatabaseModule, // DATABASE TCP ni hosil qilyabdi
	],
	controllers: [AppController, OperationsController],
	providers: [AppService, AppResolver, OperationsService],
})
export class AppModule {}
