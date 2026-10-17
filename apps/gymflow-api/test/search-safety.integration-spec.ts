import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import { resolve } from 'node:path';
import { Server } from 'node:http';
import request from 'supertest';
import { ComponentsModule } from '../src/components/components.module';
import { Member } from '../src/libs/dto/member/member';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

const punctuation = [
	'.',
	'*',
	'.*',
	'(',
	'[',
	']',
	'\\',
	'^',
	'$',
	'+',
	'?',
	'|',
	'{}',
	'{1,3}',
	'a{100000}',
	'gym.*',
	'(trainer',
	'[yoga',
];
const names = [
	'gym',
	'trainer',
	'yoga',
	'gym (studio)',
	'gym  studio',
	'\uc694\uac00 \ud2b8\ub808\uc774\ub108',
	...punctuation.map((value) => 'literal ' + value + ' end'),
];
const paths = [
	{ field: 'getTrainers', input: 'TrainersInquiry', label: 'memberNick' },
	{ field: 'getBoardArticles', input: 'BoardArticlesInquiry', label: 'articleTitle' },
	{ field: 'getAllMembersByAdmin', input: 'MembersInquiry', label: 'memberNick', role: 'admin' },
	{ field: 'getPrograms', input: 'ProgramsInquiry', label: 'programName' },
	{ field: 'getTrainerPrograms', input: 'TrainerProgramsInquiry', label: 'programName', role: 'trainer' },
	{ field: 'getAllProgramsByAdmin', input: 'AllProgramsInquiry', label: 'programName', role: 'admin' },
] as const;
type SearchPath = (typeof paths)[number];
type Result = { list: { _id: string; [key: string]: unknown }[]; metaCounter: { total: number }[] };
type Response = { data?: Record<string, Result>; errors?: { message: unknown; extensions?: { code?: string } }[] };

// Never import AppModule/DatabaseModule or read the normal database configuration.
describe('Search safety through GraphQL against disposable MongoDB', () => {
	let mongo: MongoMemoryReplSet | undefined;
	let app: INestApplication | undefined;
	let connection: Connection;
	let trainer: Member, admin: Member, foreign: Member;
	let tokens: { trainer: string; admin: string };
	beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create({
			replSet: {
				count: 1,
				storageEngine: 'wiredTiger',
				ip: '127.0.0.1',
				dbName: 'gymflow_search_' + new Types.ObjectId().toHexString(),
			},
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				ComponentsModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req, res }: GraphQLAuthContext) => ({ req, res }),
				}),
			],
		}).compile();
		app = module.createNestApplication({ logger: false });
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
		const members = await connection.model<Member>('Member').create(
			names.map((memberNick, index) => ({
				memberNick,
				memberType: 'TRAINER',
				memberPhone: 'search-fixture-' + index,
				memberPassword: 'unused-disposable',
			})),
		);
		trainer = members[0];
		[admin, foreign] = await connection.model<Member>('Member').create([
			{
				memberNick: 'owner-admin',
				memberType: 'ADMIN',
				memberPhone: 'search-admin',
				memberPassword: 'unused-disposable',
			},
			{
				memberNick: 'other-owner',
				memberType: 'TRAINER',
				memberPhone: 'search-foreign',
				memberPassword: 'unused-disposable',
			},
		]);
		const offering = {
			memberId: trainer._id,
			programType: 'PT_1ON1',
			programCategory: 'YOGA',
			programLocation: 'SEOUL',
			programAddress: 'Disposable location',
			programPrice: 100,
			programDuration: 60,
			programCapacity: 1,
			programImages: ['uploads/program/search-fixture.png'],
		};
		await connection.model('Program').create(names.map((programName) => ({ ...offering, programName })));
		await connection.model('BoardArticle').create(
			names.map((articleTitle) => ({
				memberId: trainer._id,
				articleCategory: 'FREE',
				articleTitle,
				articleContent: '<p>Disposable search story.</p>',
			})),
		);
		tokens = { trainer: await fixtureAccessToken(trainer, app), admin: await fixtureAccessToken(admin, app) };
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
	});
	async function gql(path: SearchPath, search: object = {}, patch: object = {}, anonymous = false): Promise<Response> {
		if (!app) throw new Error('Disposable application not initialized');
		const operation = request(app.getHttpServer() as Server).post('/graphql');
		if ('role' in path && !anonymous) operation.set('Authorization', 'Bearer ' + tokens[path.role]);
		const response = await operation.send({
			query:
				'query($input:' +
				path.input +
				'!){' +
				path.field +
				'(input:$input){list{_id ' +
				path.label +
				'}metaCounter{total}}}',
			variables: { input: { page: 1, limit: 100, search, ...patch } },
		});
		return response.body as Response;
	}
	function result(body: Response, path: SearchPath): Result {
		expect(body.errors).toBeUndefined();
		const data = body.data?.[path.field];
		expect(data).toBeDefined();
		return data!;
	}
	for (const path of paths) {
		describe(path.field, () => {
			it.each(['gym', 'trainer', 'yoga', 'Gym', 'GYM', '\uc694\uac00', ...punctuation, 'gym (studio)', 'gym  studio'])(
				'matches %j literally without internal errors',
				async (text) => {
					const data = result(await gql(path, { text }), path);
					const expected = names.filter((name) => name.toLowerCase().includes(text.toLowerCase()));
					expect(data.list.map((item) => item[path.label]).sort()).toEqual(expected.sort());
					expect(data.metaCounter[0]?.total ?? 0).toBe(expected.length);
				},
			);
			it('preserves approved blank, null, omitted and outer-whitespace contracts', async () => {
				const baseline = result(await gql(path), path);
				expect(result(await gql(path, { text: null }), path)).toEqual(baseline);
				if (path.label === 'programName') {
					expect((await gql(path, { text: '' })).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
					expect(result(await gql(path, { text: ' gym ' }), path).list).toHaveLength(0);
					expect(result(await gql(path, { text: '   ' }), path).list).toHaveLength(0);
				} else {
					for (const text of ['', '   ']) expect(result(await gql(path, { text }), path)).toEqual(baseline);
					expect(result(await gql(path, { text: ' gym ' }), path)).toEqual(
						result(await gql(path, { text: 'gym' }), path),
					);
				}
			});
			it('enforces nested text bounds on direct GraphQL requests', async () => {
				result(await gql(path, { text: 'x'.repeat(100) }), path);
				const rejected = await gql(path, { text: 'x'.repeat(101) });
				expect(rejected.errors?.[0].extensions?.code).toBe('BAD_REQUEST');
				expect(JSON.stringify(rejected.errors)).toContain('100');
				for (const text of [123, { $regex: '.*' }]) expect((await gql(path, { text })).errors).toBeDefined();
			});
			it('bounds pagination while keeping list/metaCounter consistent', async () => {
				const full = result(await gql(path), path);
				const first = result(await gql(path, {}, { limit: 1 }), path);
				const second = result(await gql(path, {}, { limit: 1, page: 2 }), path);
				expect(first.list).toHaveLength(1);
				expect(second.list).toHaveLength(1);
				expect(first.list[0]._id).not.toBe(second.list[0]._id);
				expect(first.metaCounter).toEqual(full.metaCounter);
				for (const limit of [0, -1, 101, 2147483647])
					expect((await gql(path, {}, { limit })).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
				for (const page of [0, -1])
					expect((await gql(path, {}, { page })).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
				expect((await gql(path, {}, { sort: 'memberPassword' })).errors?.[0].extensions?.code).toBe('BAD_REQUEST');
			});
			it('serves valid requests after malformed-looking searches', async () => {
				for (const text of ['(', '[', '\\', 'a{100000}']) result(await gql(path, { text }), path);
				expect(result(await gql(path, { text: 'gym' }), path).list.length).toBeGreaterThan(0);
			});
			if ('role' in path)
				it('rejects anonymous private/Admin access', async () =>
					expect((await gql(path, {}, {}, true)).errors).toBeDefined());
		});
	}
	it('preserves visibility, ownership and enum filters', async () => {
		const blocked = await connection.model<Member>('Member').create({
			memberNick: 'gym blocked',
			memberType: 'TRAINER',
			memberStatus: 'BLOCK',
			memberPhone: 'search-blocked',
			memberPassword: 'unused-disposable',
		});
		await connection.model<Member>('Member').create({
			memberNick: 'gym user',
			memberType: 'USER',
			memberPhone: 'search-user',
			memberPassword: 'unused-disposable',
		});
		const [trainers, articles, adminMembers, programs, owned, adminPrograms] = paths;
		const visibleTrainers = result(await gql(trainers, { text: 'gym' }), trainers).list.map((item) => item.memberNick);
		expect(visibleTrainers).not.toContain('gym blocked');
		expect(visibleTrainers).not.toContain('gym user');
		expect(
			result(
				await gql(adminMembers, { text: 'gym', memberType: 'TRAINER', memberStatus: 'BLOCK' }),
				adminMembers,
			).list.map((item) => item._id),
		).toEqual([String(blocked._id)]);
		await connection.model('BoardArticle').create([
			{
				memberId: trainer._id,
				articleCategory: 'TIP',
				articleTitle: 'gym tip',
				articleContent: '<p>Disposable search story.</p>',
			},
			{
				memberId: trainer._id,
				articleCategory: 'TIP',
				articleStatus: 'DELETE',
				articleTitle: 'gym deleted',
				articleContent: '<p>Disposable search story.</p>',
			},
		]);
		expect(
			result(await gql(articles, { text: 'gym', articleCategory: 'TIP' }), articles).list.map(
				(item) => item.articleTitle,
			),
		).toEqual(['gym tip']);
		const base = {
			programType: 'GROUP_CLASS',
			programCategory: 'CARDIO',
			programLocation: 'BUSAN',
			programAddress: 'Disposable location',
			programPrice: 100,
			programDuration: 60,
			programCapacity: 5,
			programImages: ['uploads/program/search-fixture.png'],
		};
		await connection.model('Program').create([
			{ ...base, memberId: trainer._id, programStatus: 'PAUSED', programName: 'gym paused' },
			{ ...base, memberId: trainer._id, programStatus: 'DELETE', programName: 'gym deleted' },
			{ ...base, memberId: foreign._id, programName: 'gym foreign' },
			{ ...base, memberId: blocked._id, programName: 'gym blocked owner' },
		]);
		expect(
			result(
				await gql(programs, {
					text: 'gym',
					categoryList: ['CARDIO'],
					locationList: ['BUSAN'],
					typeList: ['GROUP_CLASS'],
				}),
				programs,
			).list.map((item) => item.programName),
		).toEqual(['gym foreign']);
		expect(
			result(await gql(owned, { text: 'gym', memberId: String(foreign._id), programStatus: 'PAUSED' }), owned).list.map(
				(item) => item.programName,
			),
		).toEqual(['gym paused']);
		expect(
			result(await gql(adminPrograms, { text: 'gym', programStatus: 'DELETE' }), adminPrograms).list.map(
				(item) => item.programName,
			),
		).toEqual(['gym deleted']);
	});
});
