import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLInputObjectType, isNonNullType } from 'graphql';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { BoardArticleModule } from '../src/components/board-article/board-article.module';
import { CommentModule } from '../src/components/comment/comment.module';
import { BoardArticle, BoardArticles } from '../src/libs/dto/board-article/board-article';
import { Member } from '../src/libs/dto/member/member';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { BoardArticleCategory, BoardArticleStatus } from '../src/libs/enums/board-article.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

type ArticleResult = Omit<BoardArticle, '__v'> & { articleRevision: number };
interface Result<T = ArticleResult> {
	data?: Record<string, T> | null;
	errors?: { message: string; extensions?: { code?: string; originalError?: { statusCode?: number } } }[];
}
const fields =
	'_id articleCategory articleTitle articleContent articleImage articleStatus memberId articleRevision articleViews articleLikes articleComments createdAt updatedAt';
const valid = () => ({
	articleCategory: BoardArticleCategory.FREE,
	articleTitle: 'Training advice',
	articleContent: '<p>Train with consistency.</p>',
});

// This suite owns its replica set and never imports AppModule/DatabaseModule or application connection values.
describe('Community authoring against disposable GraphQL and MongoDB', () => {
	let mongo: MongoMemoryReplSet | undefined, app: INestApplication | undefined;
	let connection: Connection, members: Model<Member>, articles: Model<BoardArticle>;
	let user: Member, other: Member, trainer: Member, admin: Member;
	let article: BoardArticle;
	const previousDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const token = (member: Member) => app!.get(JwtService).sign({ sub: member._id.toHexString() });
	const gql = async <T = ArticleResult>(
		query: string,
		variables: object,
		viewer: Member | null = user,
	): Promise<Result<T>> => {
		const operation = request(app!.getHttpServer() as Server).post('/graphql');
		if (viewer) operation.set('Authorization', 'Bearer ' + token(viewer));
		const result = await operation.send({ query, variables });
		expect([200, 400]).toContain(result.status);
		return result.body as Result<T>;
	};
	const create = (input: object = valid(), viewer: Member | null = user) =>
		gql(`mutation($input: BoardArticleInput!) { createBoardArticle(input: $input) { ${fields} } }`, { input }, viewer);
	const edit = (patch: object = {}, viewer: Member | null = user, byAdmin = false) => {
		const operation = byAdmin ? 'updateBoardArticleByAdmin' : 'updateBoardArticle';
		return gql(
			`mutation($input: BoardArticleUpdate!) { ${operation}(input: $input) { ${fields} } }`,
			{ input: { _id: article._id.toHexString(), ...(byAdmin ? {} : { expectedRevision: 0 }), ...patch } },
			viewer,
		);
	};
	const lookup = (id = article._id.toHexString(), viewer: Member | null = user) =>
		gql(`query($id: String!) { getMyBoardArticle(articleId: $id) { ${fields} } }`, { id }, viewer);
	const success = (result: Result, operation: string) => {
		expect(result.errors).toBeUndefined();
		expect(result.data?.[operation]).toBeDefined();
		return result.data![operation];
	};
	const snapshot = async () =>
		JSON.stringify(
			await Promise.all(
				['Member', 'BoardArticle', 'Like', 'View', 'Comment'].map((name) =>
					connection.model(name).collection.find({}).sort({ _id: 1 }).toArray(),
				),
			),
		);
	const rejected = async (pending: () => Promise<Result>) => {
		const before = await snapshot();
		const result = await pending();
		expect(result.errors?.length).toBeGreaterThan(0);
		expect(await snapshot()).toBe(before);
		return result;
	};

	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: {
				count: 1,
				ip: '127.0.0.1',
				storageEngine: 'wiredTiger',
				dbName: 'gymflow_articles_' + new Types.ObjectId().toHexString(),
			},
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				BoardArticleModule,
				CommentModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req }: GraphQLAuthContext) => ({ req }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'isolated-community-authoring-test-key' }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		members = connection.model<Member>('Member');
		articles = connection.model<BoardArticle>('BoardArticle');
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		if (previousDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = previousDownload;
	});
	beforeEach(async () => {
		await Promise.all(
			['Member', 'BoardArticle', 'Like', 'View', 'Comment'].map((name) => connection.model(name).deleteMany({})),
		);
		[user, other, trainer, admin] = await members.create([
			{
				memberNick: 'article-user',
				memberPhone: 'article-1',
				memberPassword: 'test',
				memberType: MemberType.USER,
				memberArticles: 1,
			},
			{ memberNick: 'article-other', memberPhone: 'article-2', memberPassword: 'test', memberType: MemberType.USER },
			{
				memberNick: 'article-trainer',
				memberPhone: 'article-3',
				memberPassword: 'test',
				memberType: MemberType.TRAINER,
			},
			{ memberNick: 'article-admin', memberPhone: 'article-4', memberPassword: 'test', memberType: MemberType.ADMIN },
		]);
		article = await articles.create({ ...valid(), articleImage: 'uploads/article/existing.jpg', memberId: user._id });
	});
	afterEach(() => jest.restoreAllMocks());

	it.each([3, 50])('CREATE accepts title boundary %i', async (length) => {
		expect(
			success(await create({ ...valid(), articleTitle: 'a'.repeat(length) }), 'createBoardArticle').articleTitle,
		).toHaveLength(length);
	});
	it.each([3, 5000])('CREATE accepts content boundary %i without truncation', async (length) => {
		expect(
			success(await create({ ...valid(), articleContent: 'a'.repeat(length) }), 'createBoardArticle').articleContent,
		).toHaveLength(length);
	});
	it.each([
		{ articleTitle: 'ab' },
		{ articleTitle: 'a'.repeat(51) },
		{ articleTitle: '   ' },
		{ articleTitle: '\u200b\u200c\u200d' },
		{ articleTitle: null },
		{ articleContent: 'ab' },
		{ articleContent: 'a'.repeat(5001) },
		{ articleContent: '   ' },
		{ articleContent: null },
		{ articleContent: '<p><br></p>' },
		{ articleContent: '<p>&nbsp;&#160;&#xA0;</p>' },
		{ articleContent: '<script>alert(1)</script>' },
	])('CREATE rejects invalid input without writes: %j', async (patch) => {
		await rejected(() => create({ ...valid(), ...patch }));
	});
	it.each(['\u034f', '\ufe0f', '\u3164'])(
		'CREATE/UPDATE reject invisible-only Unicode %j without writes',
		async (invisible) => {
			for (const patch of [
				{ articleTitle: invisible.repeat(3) },
				{ articleContent: '<p>' + invisible.repeat(3) + '</p>' },
				{ articleContent: '<p>&#' + invisible.codePointAt(0) + ';</p>' },
			]) {
				await rejected(() => create({ ...valid(), ...patch }));
				await rejected(() => edit(patch));
			}
		},
	);
	it('CREATE/UPDATE reject invisible named entities and preserve visible literal entity text', async () => {
		for (const name of ['ApplyFunction', 'af', 'InvisibleTimes', 'it', 'InvisibleComma', 'ic']) {
			const patch = { articleContent: '<p>&' + name + ';</p>' };
			await rejected(() => create({ ...valid(), ...patch }));
			await rejected(() => edit(patch));
		}
		for (const name of ['emsp', 'ZeroWidthSpace', 'ApplyFunction']) {
			const articleContent = '<p>&' + name + '</p>';
			expect(success(await create({ ...valid(), articleContent }), 'createBoardArticle').articleContent).toBe(
				articleContent,
			);
			const revision = success(await lookup(), 'getMyBoardArticle').articleRevision;
			expect(
				success(await edit({ articleContent, expectedRevision: revision }), 'updateBoardArticle').articleContent,
			).toBe(articleContent);
		}
	});
	it('CREATE/UPDATE preserve visible Unicode and inline-image HTML byte-for-byte', async () => {
		const articleTitle = 'Training \u{1f3cb}\ufe0f',
			articleContent =
				'<p>Train \u{1f3cb}\ufe0f consistently.</p><img src="uploads/article/inline.jpg" alt="Training">';
		const created = success(await create({ ...valid(), articleTitle, articleContent }), 'createBoardArticle');
		expect(created).toMatchObject({ articleTitle, articleContent });
		const updated = success(await edit({ articleTitle, articleContent }), 'updateBoardArticle');
		expect(updated).toMatchObject({ articleTitle, articleContent });
		expect(await articles.findById(created._id).lean().exec()).toMatchObject({ articleTitle, articleContent });
		expect(await articles.findById(article._id).lean().exec()).toMatchObject({ articleTitle, articleContent });
	});
	it.each(Object.values(BoardArticleCategory))(
		'CREATE publishes category %s as ACTIVE, owned, revision zero',
		async (articleCategory) => {
			const result = success(await create({ ...valid(), articleCategory }), 'createBoardArticle');
			expect(result).toMatchObject({
				articleCategory,
				articleStatus: 'ACTIVE',
				articleRevision: 0,
				memberId: user._id.toHexString(),
			});
			expect((await members.findById(user._id))?.memberArticles).toBe(2);
		},
	);
	it.each(['user', 'trainer', 'admin'])('CREATE allows authenticated ACTIVE %s', async (role) => {
		const viewer = role === 'user' ? user : role === 'trainer' ? trainer : admin;
		expect(success(await create(valid(), viewer), 'createBoardArticle').memberId).toBe(viewer._id.toHexString());
	});
	it('CREATE preserves HTML exactly and image is optional', async () => {
		const articleContent = '<p><strong>근력 운동</strong> &amp; consistency.</p>';
		const result = success(await create({ ...valid(), articleContent }), 'createBoardArticle');
		expect(result.articleContent).toBe(articleContent);
		expect(result.articleImage).toBeNull();
		expect((await articles.findById(result._id))?.articleContent).toBe(articleContent);
	});
	it.each(['memberId', 'articleStatus', 'articleLikes', 'articleRevision'])(
		'CREATE rejects client-owned/server-owned field %s',
		async (field) => {
			await rejected(() =>
				create({
					...valid(),
					[field]: field === 'memberId' ? other._id.toHexString() : field === 'articleStatus' ? 'DELETE' : 99,
				}),
			);
		},
	);
	it.each(['guest', 'blocked', 'deleted'])('CREATE and owner lookup deny %s', async (state) => {
		if (state !== 'guest')
			await members.updateOne(
				{ _id: user._id },
				{ memberStatus: state === 'blocked' ? MemberStatus.BLOCK : MemberStatus.DELETE },
			);
		await rejected(() => create(valid(), state === 'guest' ? null : user));
		await rejected(() => lookup(article._id.toHexString(), state === 'guest' ? null : user));
		await rejected(() => edit({ articleTitle: 'Denied save' }, state === 'guest' ? null : user));
	});

	it('OWNER LOOKUP returns revision and existing content without public views or counter writes', async () => {
		const before = await snapshot();
		const result = success(await lookup(), 'getMyBoardArticle');
		expect(result).toMatchObject({
			articleRevision: 0,
			articleViews: 0,
			articleContent: valid().articleContent,
			articleImage: 'uploads/article/existing.jpg',
		});
		expect(await snapshot()).toBe(before);
	});
	it.each(['foreign', 'deleted', 'missing', 'malformed'])('OWNER LOOKUP rejects %s', async (state) => {
		if (state === 'deleted')
			await articles.updateOne({ _id: article._id }, { articleStatus: BoardArticleStatus.DELETE });
		await rejected(() =>
			lookup(
				state === 'missing'
					? new Types.ObjectId().toHexString()
					: state === 'malformed'
						? 'not-an-id'
						: article._id.toHexString(),
				state === 'foreign' ? other : user,
			),
		);
	});
	it('OWNER LOOKUP also works for trainer/admin-owned articles', async () => {
		for (const viewer of [trainer, admin]) {
			const result = success(await create(valid(), viewer), 'createBoardArticle');
			expect(success(await lookup(result._id.toString(), viewer), 'getMyBoardArticle').memberId).toBe(
				viewer._id.toHexString(),
			);
		}
	});

	it.each([250, 251, 5000])('UPDATE accepts %i content characters and atomically advances revision', async (length) => {
		const result = success(await edit({ articleContent: 'a'.repeat(length) }), 'updateBoardArticle');
		expect(result.articleContent).toHaveLength(length);
		expect(result.articleRevision).toBe(1);
		const stored = await articles.findById(article._id).lean().exec();
		expect(stored?.__v).toBe(1);
		expect(stored).not.toHaveProperty('expectedRevision');
		expect(stored).not.toHaveProperty('articleRevision');
	});
	it.each([
		{ articleTitle: null },
		{ articleContent: null },
		{ articleStatus: null },
		{ expectedRevision: null },
		{ articleTitle: '' },
		{ articleTitle: '   ' },
		{ articleTitle: '\u200b\u200c\u200d' },
		{ articleContent: '' },
		{ articleContent: '   ' },
		{ articleContent: '<p>&nbsp;</p>' },
		{ articleContent: '<p><br></p>' },
		{ articleContent: 'a'.repeat(5001) },
		{ articleCategory: 'NEWS' },
		{ memberId: 'f'.repeat(24) },
		{ articleRevision: 2 },
		{ expectedRevision: undefined },
		{ expectedRevision: -1 },
		{ expectedRevision: 0.5 },
		{ expectedRevision: '0' },
	])('UPDATE rejects invalid/unsupported input without writes: %j', async (patch) => {
		await rejected(() => edit(patch));
	});
	it('UPDATE rejects a spoofed owner even if the caller guesses the correct revision', async () => {
		await rejected(() => edit({ articleTitle: 'Foreign edit' }, other));
	});
	it('UPDATE rejects an already DELETE article with its current revision', async () => {
		success(await edit({ articleStatus: 'DELETE' }), 'updateBoardArticle');
		await rejected(() => edit({ expectedRevision: 1, articleTitle: 'Cannot restore', articleStatus: 'ACTIVE' }));
	});
	it('UPDATE preserves omitted image, permits replacement, and clears with null/empty string', async () => {
		expect(success(await edit({ articleTitle: 'New title' }), 'updateBoardArticle').articleImage).toBe(
			'uploads/article/existing.jpg',
		);
		expect(
			success(await edit({ expectedRevision: 1, articleImage: 'uploads/article/new.png' }), 'updateBoardArticle')
				.articleImage,
		).toBe('uploads/article/new.png');
		expect(
			success(await edit({ expectedRevision: 2, articleImage: null }), 'updateBoardArticle').articleImage,
		).toBeNull();
		expect(success(await edit({ expectedRevision: 3, articleImage: '' }), 'updateBoardArticle').articleImage).toBe('');
	});

	it('REVISION rejects a stale second editor with distinct conflict and no retry', async () => {
		const first = success(await lookup(), 'getMyBoardArticle'),
			second = success(await lookup(), 'getMyBoardArticle');
		success(
			await edit({ expectedRevision: first.articleRevision, articleTitle: 'First editor saves' }),
			'updateBoardArticle',
		);
		const write = jest.spyOn(articles, 'findOneAndUpdate');
		const result = await rejected(() =>
			edit({ expectedRevision: second.articleRevision, articleTitle: 'Stale editor loses' }),
		);
		expect(result.errors?.[0].extensions?.originalError?.statusCode).toBe(409);
		expect(result.errors?.[0].message).toContain('Article changed');
		expect(write).toHaveBeenCalledTimes(1);
		expect((await articles.findById(article._id))?.articleTitle).toBe('First editor saves');
	});
	it('REVISION permits exactly one of two concurrent saves with the same loaded revision', async () => {
		const results = await Promise.all([
			edit({ articleTitle: 'Concurrent first' }),
			edit({ articleTitle: 'Concurrent second' }),
		]);
		expect(results.filter((result) => !result.errors)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.[0].extensions?.originalError?.statusCode === 409)).toHaveLength(
			1,
		);
		expect((await articles.findById(article._id))?.__v).toBe(1);
		expect((await members.findById(user._id))?.memberArticles).toBe(1);
	});
	it.each(['edit-first', 'delete-first'])('REVISION edit versus delete: %s', async (order) => {
		success(
			await edit(order === 'edit-first' ? { articleTitle: 'Saved before delete' } : { articleStatus: 'DELETE' }),
			'updateBoardArticle',
		);
		const result = await rejected(() =>
			edit(order === 'edit-first' ? { articleStatus: 'DELETE' } : { articleTitle: 'Stale after delete' }),
		);
		expect(result.errors?.[0].extensions?.originalError?.statusCode).toBe(409);
		expect((await members.findById(user._id))?.memberArticles).toBe(order === 'edit-first' ? 1 : 0);
	});
	it('REVISION concurrent edit/delete has one winner and at most one counter decrement', async () => {
		const results = await Promise.all([
			edit({ articleTitle: 'Concurrent content save' }),
			edit({ articleStatus: 'DELETE' }),
		]);
		expect(results.filter((result) => !result.errors)).toHaveLength(1);
		expect(results.filter((result) => result.errors?.[0].extensions?.originalError?.statusCode === 409)).toHaveLength(
			1,
		);
		const stored = await articles.findById(article._id);
		expect(stored?.__v).toBe(1);
		expect((await members.findById(user._id))?.memberArticles).toBe(
			stored?.articleStatus === BoardArticleStatus.DELETE ? 0 : 1,
		);
	});
	it('COUNTER first soft-delete decrements once; stale/repeated requests cannot decrement again', async () => {
		expect(success(await edit({ articleStatus: 'DELETE' }), 'updateBoardArticle').articleRevision).toBe(1);
		expect((await members.findById(user._id))?.memberArticles).toBe(0);
		await rejected(() => edit({ articleStatus: 'DELETE' }));
		await rejected(() => edit({ expectedRevision: 1, articleStatus: 'DELETE' }));
		expect((await members.findById(user._id))?.memberArticles).toBe(0);
	});
	it('COUNTER stale delete cannot decrement after a successful content edit', async () => {
		success(await edit({ articleTitle: 'Updated first' }), 'updateBoardArticle');
		await rejected(() => edit({ articleStatus: 'DELETE' }));
		expect((await members.findById(user._id))?.memberArticles).toBe(1);
	});

	it('ENGAGEMENT real likes, public views and comments do not invalidate the loaded content revision', async () => {
		const loaded = success(await lookup(), 'getMyBoardArticle');
		success(
			await gql(
				`mutation($id: String!) { likeTargetBoardArticle(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				other,
			),
			'likeTargetBoardArticle',
		);
		success(
			await gql(
				`query($id: String!) { getBoardArticle(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				other,
			),
			'getBoardArticle',
		);
		const comment = await gql(
			'mutation($input: CommentInput!) { createComment(input: $input) { _id } }',
			{ input: { articleId: article._id.toHexString(), commentContent: 'Helpful training advice' } },
			other,
		);
		expect(comment.errors).toBeUndefined();
		expect(await articles.findById(article._id).lean().exec()).toMatchObject({
			__v: 0,
			articleLikes: 1,
			articleViews: 1,
			articleComments: 1,
		});
		const result = success(
			await edit({ expectedRevision: loaded.articleRevision, articleTitle: 'Saved after engagement' }),
			'updateBoardArticle',
		);
		expect(result).toMatchObject({ articleRevision: 1, articleLikes: 1, articleViews: 1, articleComments: 1 });
	});

	it('ADMIN legacy no-revision update remains compatible and invalidates owner revisions', async () => {
		const result = success(await edit({ articleTitle: 'Admin correction' }, admin, true), 'updateBoardArticleByAdmin');
		expect(result.articleRevision).toBe(1);
		await rejected(() => edit({ articleTitle: 'Stale owner' }));
	});
	it('ADMIN can opt into revision checks; stale admin edits are rejected', async () => {
		success(
			await edit({ expectedRevision: 0, articleContent: 'a'.repeat(251) }, admin, true),
			'updateBoardArticleByAdmin',
		);
		const result = await rejected(() => edit({ expectedRevision: 0, articleTitle: 'Stale admin' }, admin, true));
		expect(result.errors?.[0].extensions?.originalError?.statusCode).toBe(409);
	});
	it.each([null, 'user', 'trainer'])('ADMIN update/hard-delete denies %s', async (role) => {
		const viewer = role === null ? null : role === 'user' ? user : trainer;
		await rejected(() => edit({ articleStatus: 'DELETE' }, viewer, true));
		await rejected(() =>
			gql(
				`mutation($id: String!) { removeBoardArticleByAdmin(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				viewer,
			),
		);
	});
	it('ADMIN preserves soft-delete/hard-delete lifecycle without a second counter decrement or restore', async () => {
		await rejected(() =>
			gql(
				`mutation($id: String!) { removeBoardArticleByAdmin(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				admin,
			),
		);
		expect(
			success(await edit({ articleStatus: 'DELETE' }, admin, true), 'updateBoardArticleByAdmin').articleRevision,
		).toBe(1);
		await rejected(() => edit({ articleStatus: 'ACTIVE' }, admin, true));
		success(
			await gql(
				`mutation($id: String!) { removeBoardArticleByAdmin(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				admin,
			),
			'removeBoardArticleByAdmin',
		);
		expect(await articles.findById(article._id)).toBeNull();
		expect((await members.findById(user._id))?.memberArticles).toBe(0);
	});
	it.each([
		{ articleTitle: null },
		{ articleContent: null },
		{ articleContent: '<p>&nbsp;</p>' },
		{ articleCategory: 'NEWS' },
	])('ADMIN cannot bypass content/category validation: %j', async (patch) => {
		await rejected(() => edit(patch, admin, true));
	});

	it('SCHEMA adds only owner lookup, output revision and optional shared-input revision', () => {
		const schema = app!.get(GraphQLSchemaHost).schema;
		const output = schema.getType('BoardArticle');
		expect(output && 'getFields' in output && String(output.getFields().articleRevision.type)).toBe('Int!');
		expect(output && 'getFields' in output && output.getFields().__v).toBeUndefined();
		const input = schema.getType('BoardArticleUpdate') as GraphQLInputObjectType;
		expect(String(input.getFields().expectedRevision.type)).toBe('Int');
		expect(isNonNullType(input.getFields().expectedRevision.type)).toBe(false);
		expect(input.getFields().articleCategory).toBeUndefined();
		expect(input.getFields().memberId).toBeUndefined();
		expect(
			schema
				.getQueryType()!
				.getFields()
				.getMyBoardArticle.args.map((arg) => [arg.name, String(arg.type)]),
		).toEqual([['articleId', 'String!']]);
	});
	it('PUBLIC list/detail remain ACTIVE-only with their existing data and engagement semantics', async () => {
		const before = await snapshot();
		const listed = await gql<BoardArticles>(
			`query($input: BoardArticlesInquiry!) { getBoardArticles(input: $input) { list { _id articleTitle articleComments } metaCounter { total } } }`,
			{ input: { page: 1, limit: 10, search: { memberId: user._id.toHexString() } } },
			null,
		);
		expect(listed.errors).toBeUndefined();
		expect(listed.data?.getBoardArticles.list).toHaveLength(1);
		expect(await snapshot()).toBe(before);
		success(
			await gql(
				`query($id: String!) { getBoardArticle(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				other,
			),
			'getBoardArticle',
		);
		expect((await articles.findById(article._id))?.articleViews).toBe(1);
		success(await edit({ articleStatus: 'DELETE' }), 'updateBoardArticle');
		await rejected(() =>
			gql(
				`query($id: String!) { getBoardArticle(articleId: $id) { ${fields} } }`,
				{ id: article._id.toHexString() },
				other,
			),
		);
	});
});
