import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { Connection, createConnection } from 'mongoose';
import { GraphQLEnumType, GraphQLInputObjectType, printSchema, parse, validate } from 'graphql';
import { ComponentsModule } from '../src/components/components.module';
import { ProgramResolver } from '../src/components/program/program.resolver';
import { MemberResolver } from '../src/components/member/member.resolver';
import { CommentResolver } from '../src/components/comment/comment.resolver';
import { BoardArticleResolver } from '../src/components/board-article/board-article.resolver';
import { FollowResolver } from '../src/components/follow/follow.resolver';
import { ProgramService } from '../src/components/program/program.service';

@Global()
@Module({
	providers: [{ provide: getConnectionToken(), useFactory: () => createConnection() }],
	exports: [getConnectionToken()],
})
class DisconnectedDatabaseModule {}

describe('GraphQL contract and Nest dependency graph (no database connection)', () => {
	it('compiles every reusable feature and builds only the new catalog contract', async () => {
		const module = await Test.createTestingModule({
			imports: [DisconnectedDatabaseModule, ComponentsModule, GraphQLSchemaBuilderModule],
		}).compile();
		try {
			expect(module.get(ProgramService)).toBeDefined();
			expect(module.get<Connection>(getConnectionToken()).readyState).toBe(0);
			const schema = await module
				.get(GraphQLSchemaFactory)
				.create([ProgramResolver, MemberResolver, CommentResolver, BoardArticleResolver, FollowResolver]);
			const text = printSchema(schema);
			for (const operation of [
				'createProgram',
				'updateProgram',
				'getProgram',
				'getPrograms',
				'getTrainerPrograms',
				'getAllProgramsByAdmin',
				'updateProgramByAdmin',
				'removeProgramByAdmin',
				'likeTargetProgram',
				'getTrainers',
				'getFavorites',
				'getVisited',
				'subscribe',
				'getBoardArticles',
				'signup',
				'login',
			])
				expect(text).toContain(operation + '(');
			expect(text).not.toMatch(/Property|Properties|AGENT|property|Agent|commentGroup|commentRefId|programComments/);
			const roleEnum = schema.getType('MemberType') as GraphQLEnumType;
			expect(roleEnum.getValues().map((value) => value.name)).toEqual(['USER', 'TRAINER', 'ADMIN']);
			const status = schema.getType('ProgramStatus') as GraphQLEnumType;
			expect(status.getValues().map((value) => value.name)).toEqual(['ACTIVE', 'PAUSED', 'DELETE']);
			for (const [name, values] of [
				['ProgramType', ['PT_1ON1', 'GROUP_CLASS', 'ONLINE']],
				['ProgramCategory', ['WEIGHT_LOSS', 'MUSCLE_GAIN', 'YOGA', 'PILATES', 'CROSSFIT', 'CARDIO', 'REHAB']],
				['ProgramLocation', ['SEOUL', 'GYEONGGI', 'INCHEON', 'BUSAN', 'DAEGU', 'DAEJEON', 'GWANGJU', 'ONLINE', 'ETC']],
			] as const) {
				const enumType = schema.getType(name) as GraphQLEnumType;
				expect(enumType.getValues().map((value) => value.name)).toEqual(values);
			}
			const selfUpdate = schema.getType('MemberSelfUpdate') as GraphQLInputObjectType;
			expect(Object.keys(selfUpdate.getFields())).not.toEqual(expect.arrayContaining(['memberType']));
			expect(selfUpdate.getFields()).not.toHaveProperty('memberStatus');
			expect(selfUpdate.getFields()).not.toHaveProperty('_id');
			const programInput = schema.getType('ProgramInput') as GraphQLInputObjectType;
			expect(programInput.getFields()).not.toHaveProperty('memberId');
			expect(programInput.getFields()).not.toHaveProperty('programLikes');
			expect(programInput.getFields().programPrice.type.toString()).toBe('Int!');
			const commentInput = schema.getType('CommentInput') as GraphQLInputObjectType;
			expect(commentInput.getFields()).toHaveProperty('articleId');
			expect(commentInput.getFields()).not.toHaveProperty('commentRefId');
			expect(
				validate(
					schema,
					parse(
						'{ getFavorites(input: {page: 1, limit: 5}) { list { programName programCategory programImages } metaCounter {total} } }',
					),
				),
			).toEqual([]);
			expect(
				validate(schema, parse('mutation { updateMember(input: {memberType: ADMIN}) {_id} }')).length,
			).toBeGreaterThan(0);
			expect(
				validate(
					schema,
					parse('{ getPrograms(input: {page: 1, limit: 5, search: {typeList: [APARTMENT]}}) {list {_id}} }'),
				).length,
			).toBeGreaterThan(0);
		} finally {
			await module.get<Connection>(getConnectionToken()).close();
			await module.close();
		}
	});
});
