import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLObjectType, GraphQLSchema, parse, validate } from 'graphql';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { Server } from 'node:http';
import request from 'supertest';
import { ComponentsModule } from '../src/components/components.module';
import { MemberService } from '../src/components/member/member.service';
import { AuthService } from '../src/components/auth/auth.service';
import { ProgramService } from '../src/components/program/program.service';
import { BoardArticleService } from '../src/components/board-article/board-article.service';
import { CommentService } from '../src/components/comment/comment.service';
import { FollowService } from '../src/components/follow/follow.service';
import { Member } from '../src/libs/dto/member/member';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory, ProgramLocation, ProgramStatus, ProgramType } from '../src/libs/enums/program.enum';
import { BoardArticleCategory } from '../src/libs/enums/board-article.enum';
import { BoardArticle } from '../src/libs/dto/board-article/board-article';
import { Program } from '../src/libs/dto/program/program';
import { publicMemberProjection } from '../src/libs/config';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

const forbidden = [
	'memberPhone',
	'memberAddress',
	'memberStatus',
	'memberAuthType',
	'memberPoints',
	'memberWarnings',
	'memberBlocks',
	'deletedAt',
	'createdAt',
	'updatedAt',
	'memberPassword',
	'accessToken',
	'__v',
];

// Only this suite's loopback database is used; never import AppModule or application DB configuration.
describe('Member privacy boundary against disposable MongoDB', () => {
	let mongo: MongoMemoryServer | undefined;
	let app: INestApplication | undefined;
	let connection: Connection;
	let schema: GraphQLSchema;
	let members: Model<Member>;
	let memberService: MemberService;
	let auth: AuthService;
	let accounts: Member[];
	let trainer: Member;
	let user: Member;
	let admin: Member;
	let blocked: Member;
	let program: Program;
	let article: BoardArticle;
	const password = 'pass123';

	beforeAll(async () => {
		mongo = await MongoMemoryServer.create({
			instance: { ip: '127.0.0.1', dbName: 'gymflow_member_privacy_' + new Types.ObjectId().toHexString() },
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri(), { serverSelectionTimeoutMS: 5000 }),
				ComponentsModule,
				GraphQLModule.forRoot<ApolloDriverConfig>({
					driver: ApolloDriver,
					autoSchemaFile: true,
					context: ({ req }: GraphQLAuthContext) => ({ req }),
				}),
			],
		})
			.overrideProvider(JwtService)
			.useValue(new JwtService({ secret: 'disposable-member-privacy', signOptions: { expiresIn: '1h' } }))
			.compile();
		app = module.createNestApplication({ logger: false });
		app.useGlobalPipes(new ValidationPipe());
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		schema = module.get(GraphQLSchemaHost).schema;
		members = connection.model<Member>('Member');
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
		memberService = module.get(MemberService);
		auth = module.get(AuthService);
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
	});
	beforeEach(async () => {
		await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
		const memberPassword = await auth.hashPassword(password);
		accounts = await members.create(
			[MemberType.TRAINER, MemberType.USER, MemberType.ADMIN, MemberType.TRAINER, MemberType.TRAINER].map(
				(memberType, index) => ({
					memberType,
					memberNick: 'privacy-' + index,
					memberPhone: 'private-phone-' + index,
					memberAddress: 'Private address ' + index,
					memberPassword,
					memberFullName: 'Public name ' + index,
					memberDesc: 'Published biography',
					memberWarnings: 2,
					memberPoints: 3,
					memberStatus: index === 3 ? MemberStatus.BLOCK : MemberStatus.ACTIVE,
				}),
			),
		);
		[trainer, user, admin, blocked] = accounts;
		const offerings = await connection.model<Program>('Program').create(
			[trainer, blocked, user, accounts[4]].map((owner, index) => ({
				memberId: owner._id,
				programType: ProgramType.PT_1ON1,
				programCategory: ProgramCategory.MUSCLE_GAIN,
				programLocation: ProgramLocation.SEOUL,
				programAddress: 'Published training location',
				programName: 'Privacy program ' + index,
				programPrice: 10000,
				programDuration: 60,
				programCapacity: 1,
				programImages: ['uploads/program/privacy-test.png'],
			})),
		);
		program = offerings[0];
		article = await connection.model<BoardArticle>('BoardArticle').create({
			memberId: user._id,
			articleCategory: BoardArticleCategory.FREE,
			articleTitle: 'A public story',
			articleContent: '<p>Published story content</p>',
		});
		await connection.model('Comment').create({
			memberId: trainer._id,
			articleId: article._id,
			commentContent: 'Public comment',
		});
	});

	async function gql<T = Record<string, unknown>>(query: string, account?: Member) {
		if (!app) throw new Error('Fixture not initialized');
		const req = request(app.getHttpServer() as Server).post('/graphql');
		if (account) req.set('Authorization', 'Bearer ' + (await auth.createToken(account)));
		const response = await req.send({ query });
		expect([200, 400]).toContain(response.status);
		return response.body as { data?: T; errors?: { message: string }[] };
	}
	function safeIdentity(member: object | null | undefined) {
		expect(member).toBeTruthy();
		for (const key of Object.keys(member!)) expect(Object.keys(publicMemberProjection)).toContain(key);
		for (const key of forbidden) expect(member).not.toHaveProperty(key);
	}

	it('has explicit public/owner/admin output contracts and an argument-free self query', () => {
		const fields = (name: string) => Object.keys((schema.getType(name) as GraphQLObjectType).getFields());
		expect(fields('PublicMember').sort()).toEqual(Object.keys(publicMemberProjection).sort());
		expect(schema.getQueryType()!.getFields().getMyMember.args).toEqual([]);
		expect(schema.getQueryType()!.getFields().getMyMember.type.toString()).toBe('OwnerMember!');
		for (const key of ['memberWarnings', 'memberBlocks', 'deletedAt', 'memberPassword', '__v']) {
			expect(fields('OwnerMember')).not.toContain(key);
		}
		for (const key of ['accessToken', 'memberPassword', '__v']) expect(fields('Member')).not.toContain(key);
	});

	it.each(forbidden)('rejects public %s through roots, nested paths, aliases and fragments', (field) => {
		const id = trainer._id.toHexString();
		const paths = [
			`getMember(memberId:"${id}"){alias:${field}}`,
			`getTrainers(input:{page:1,limit:1,search:{}}){list{${field}}}`,
			`getProgram(programId:"${program._id.toHexString()}"){memberData{${field}}}`,
			`getPrograms(input:{page:1,limit:1,search:{}}){list{memberData{${field}}}}`,
			`getTrainerPrograms(input:{page:1,limit:1,search:{}}){list{memberData{${field}}}}`,
			`getFavorites(input:{page:1,limit:1}){list{memberData{${field}}}}`,
			`getVisited(input:{page:1,limit:1}){list{memberData{${field}}}}`,
			`getBoardArticle(articleId:"${article._id.toHexString()}"){memberData{${field}}}`,
			`getBoardArticles(input:{page:1,limit:1,search:{}}){list{memberData{${field}}}}`,
			`getComments(input:{page:1,limit:1,search:{articleId:"${article._id.toHexString()}"}}){list{memberData{${field}}}}`,
			`getMemberFollowers(input:{page:1,limit:1,search:{followingId:"${id}"}}){list{followerData{${field}}}}`,
			`getMemberFollowings(input:{page:1,limit:1,search:{followerId:"${id}"}}){list{followingData{${field}}}}`,
			`getAllProgramsByAdmin(input:{page:1,limit:1,search:{}}){list{memberData{${field}}}}`,
			`getAllBoardArticlesByAdmin(input:{page:1,limit:1,search:{}}){list{memberData{${field}}}}`,
		];
		for (const query of paths) {
			const errors = validate(schema, parse(`query {${query}}`));
			expect(errors.some((error) => error.message.includes(`Cannot query field "${field}"`))).toBe(true);
		}
		for (const query of [
			`mutation{likeTargetMember(memberId:"${id}"){${field}}}`,
			`query{getMember(memberId:"${id}"){...Private}} fragment Private on PublicMember{${field}}`,
		]) {
			expect(
				validate(schema, parse(query)).some((error) => error.message.includes(`Cannot query field "${field}"`)),
			).toBe(true);
		}
	});

	it.each([MemberType.USER, MemberType.TRAINER, MemberType.ADMIN])(
		'restores only the authenticated %s without view side effects',
		async (role) => {
			const account = accounts.find((member) => member.memberType === role)!;
			const before = (await members.findById(account._id).lean().exec())!.memberViews;
			const result = await gql(
				'{getMyMember{_id memberPhone memberAddress memberStatus memberPoints accessToken}}',
				account,
			);
			expect(result.errors).toBeUndefined();
			expect(result.data?.getMyMember).toMatchObject({
				_id: account._id.toHexString(),
				memberPhone: account.memberPhone,
				memberAddress: account.memberAddress,
				memberStatus: MemberStatus.ACTIVE,
				accessToken: null,
			});
			expect((await members.findById(account._id).lean().exec())!.memberViews).toBe(before);
			expect(await connection.model('View').countDocuments({})).toBe(0);
			expect((await gql(`{getMyMember(memberId:"${trainer._id.toHexString()}"){_id}}`, account)).errors).toBeDefined();
		},
	);

	it('rejects guest/inactive self reads and cross-account contact queries for every role', async () => {
		expect((await gql('{getMyMember{memberPhone}}')).errors).toBeDefined();
		expect((await gql('{getMyMember{memberPhone}}', blocked)).errors).toBeDefined();
		for (const account of [undefined, user, trainer, admin]) {
			expect(
				(await gql(`{getMember(memberId:"${user._id.toHexString()}"){memberPhone memberAddress}}`, account)).errors,
			).toBeDefined();
		}
	});

	it('keeps signup/login/self-update owner data but strips credentials and moderation output', async () => {
		const created = await memberService.signup({
			memberNick: 'new-owner',
			memberPhone: 'new-private',
			memberPassword: password,
		});
		expect(created.accessToken).toBeTruthy();
		for (const member of [
			created,
			await memberService.login({ memberNick: created.memberNick, memberPassword: password }),
			await memberService.updateMember(created._id, { memberAddress: 'Owned new address' }),
		]) {
			expect(member.memberPhone).toBe('new-private');
			for (const field of ['memberPassword', 'memberWarnings', 'memberBlocks', 'deletedAt', '__v'])
				expect(member).not.toHaveProperty(field);
		}
		const login = await gql<{ login: { memberPhone: string; accessToken: string } }>(
			`mutation{login(input:{memberNick:"${trainer.memberNick}",memberPassword:"${password}"}){memberPhone memberAddress accessToken}}`,
		);
		expect(login.errors).toBeUndefined();
		expect(login.data?.login.memberPhone).toBe(trainer.memberPhone);
		expect(login.data?.login.accessToken).toBeTruthy();
	});

	it('preserves Admin management fields and rejects USER/TRAINER/guest access', async () => {
		const query =
			'{getAllMembersByAdmin(input:{page:1,limit:10,search:{}}){list{_id memberPhone memberAddress memberStatus memberWarnings memberBlocks deletedAt} metaCounter{total}}}';
		for (const account of [undefined, user, trainer]) expect((await gql(query, account)).errors).toBeDefined();
		expect((await gql(query, admin)).errors).toBeUndefined();
		const list = await memberService.getAllMembersByAdmin({ page: 1, limit: 10, search: {} });
		for (const member of list.list) {
			expect(member.memberPhone).toBeTruthy();
			for (const field of ['memberPassword', 'accessToken', '__v']) expect(member).not.toHaveProperty(field);
		}
		const updated = await memberService.updateMemberByAdmin({ _id: trainer._id, memberStatus: MemberStatus.BLOCK });
		expect(updated.memberStatus).toBe(MemberStatus.BLOCK);
		expect(updated.memberWarnings).toBe(2);
		expect(updated.memberPhone).toBe(trainer.memberPhone);
		for (const field of ['memberPassword', 'accessToken', '__v'])
			expect(JSON.parse(JSON.stringify(updated))).not.toHaveProperty(field);
	});

	it('preserves discovery totals/page boundaries, identity/bio and viewer-specific state', async () => {
		const module = app!.get(FollowService);
		await module.subscribe(user._id, trainer._id);
		const inquiry = { page: 1, limit: 1, search: {} };
		const guest = await memberService.getTrainers(null, inquiry);
		expect(guest.metaCounter[0].total).toBe(2);
		expect(guest.list).toHaveLength(1);
		const full = await memberService.getTrainers(user._id, { ...inquiry, limit: 10 });
		for (const member of full.list) safeIdentity(member);
		expect(full.list.find((member) => member._id.equals(trainer._id))?.meFollowed?.[0]?.myFollowing).toBe(true);
		expect((await memberService.getPublicMember(null, trainer._id)).memberDesc).toBe(trainer.memberDesc);
		await expect(memberService.getPublicMember(null, blocked._id)).rejects.toThrow();
		expect((await memberService.getMember(null, blocked._id)).memberStatus).toBe(MemberStatus.BLOCK);
	});

	it('strips contacts/hashes from actual Program, author, comment and follow aggregation objects', async () => {
		const programs = await app!.get(ProgramService).getPrograms(null, { page: 1, limit: 10, search: {} });
		expect(programs.metaCounter[0].total).toBe(2);
		for (const item of programs.list) {
			safeIdentity(item.memberData);
			expect(item.programAddress).toBe('Published training location');
		}
		const articles = app!.get(BoardArticleService);
		safeIdentity((await articles.getBoardArticle(null, article._id)).memberData);
		safeIdentity((await articles.getBoardArticles(null, { page: 1, limit: 10, search: {} })).list[0].memberData);
		safeIdentity(
			(await app!.get(CommentService).getComments(null, { page: 1, limit: 10, search: { articleId: article._id } }))
				.list[0].memberData,
		);
		const follow = app!.get(FollowService);
		await follow.subscribe(user._id, trainer._id);
		safeIdentity(
			(await follow.getMemberFollowings(null, { page: 1, limit: 10, search: { followerId: user._id } })).list[0]
				.followingData,
		);
		safeIdentity(
			(await follow.getMemberFollowers(null, { page: 1, limit: 10, search: { followingId: trainer._id } })).list[0]
				.followerData,
		);
	});

	it('keeps member-like, Favorites and Visited identities public while preserving saved totals', async () => {
		safeIdentity(await memberService.likeTargetMember(user._id, trainer._id));
		const service = app!.get(ProgramService);
		await service.likeTargetProgram(user._id, program._id);
		await service.getProgram(user._id, program._id);
		for (const result of [
			await service.getFavorites(user._id, { page: 1, limit: 10 }),
			await service.getVisited(user._id, { page: 1, limit: 10 }),
		]) {
			expect(result.metaCounter[0].total).toBe(1);
			safeIdentity(result.list[0].memberData);
		}
		await connection.model('Program').updateOne({ _id: program._id }, { programStatus: ProgramStatus.PAUSED });
		expect((await service.getFavorites(user._id, { page: 1, limit: 10 })).list).toEqual([]);
	});

	it('keeps review/reservation identity summaries restricted and legacy chat unregistered', () => {
		for (const type of ['ReviewMemberSummary', 'ReservationMemberSummary', 'ReservationTrainerSummary']) {
			const fields = (schema.getType(type) as GraphQLObjectType).getFields();
			for (const field of forbidden) expect(fields).not.toHaveProperty(field);
		}
		const appSource = readFileSync(resolve('apps/gymflow-api/src/app.module.ts'), 'utf8');
		const mainSource = readFileSync(resolve('apps/gymflow-api/src/main.ts'), 'utf8');
		expect(appSource).not.toMatch(/SocketModule/);
		expect(mainSource).not.toMatch(/WsAdapter|useWebSocketAdapter/);
	});
});
