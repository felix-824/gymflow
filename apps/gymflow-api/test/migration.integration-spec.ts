import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import { graphqlUploadExpress } from 'graphql-upload';
import { ComponentsModule } from '../src/components/components.module';
import { ProgramService } from '../src/components/program/program.service';
import { MemberService } from '../src/components/member/member.service';
import { CommentService } from '../src/components/comment/comment.service';
import { LikeService } from '../src/components/like/like.service';
import { ViewService } from '../src/components/view/view.service';
import { FollowService } from '../src/components/follow/follow.service';
import { BoardArticleService } from '../src/components/board-article/board-article.service';
import { AuthService } from '../src/components/auth/auth.service';
import { BatchService } from '../../gymflow-batch/src/batch.service';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { ProgramInput } from '../src/libs/dto/program/program.input';
import { Like } from '../src/libs/dto/like/like';
import { View } from '../src/libs/dto/view/view';
import { BoardArticle } from '../src/libs/dto/board-article/board-article';
import { MemberType, MemberStatus } from '../src/libs/enums/member.enum';
import { ProgramType, ProgramCategory, ProgramLocation, ProgramStatus } from '../src/libs/enums/program.enum';
import { BoardArticleCategory, BoardArticleStatus } from '../src/libs/enums/board-article.enum';
import { LikeGroup } from '../src/libs/enums/like.enum';
import { ViewGroup } from '../src/libs/enums/view.enum';
import { CommentStatus } from '../src/libs/enums/comment.enum';
import { NotificationGroup, NotificationType } from '../src/libs/enums/notification.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

const offering = (name = 'Strength session'): ProgramInput => ({
	programType: ProgramType.PT_1ON1,
	programCategory: ProgramCategory.MUSCLE_GAIN,
	programLocation: ProgramLocation.SEOUL,
	programAddress: 'Seoul gym',
	programName: name,
	programPrice: 50000,
	programDuration: 60,
	programCapacity: 1,
	programImages: ['uploads/program/test.png'],
});
interface GraphQLResponse<T> {
	data?: T;
	errors?: { message: string }[];
}

// This suite creates its own loopback server. It never reads an application database URI
// or imports AppModule/DatabaseModule/ScheduleModule, and no cron jobs are started.
describe('GymFlow migration against disposable MongoDB', () => {
	let mongo: MongoMemoryServer | undefined;
	let app: INestApplication | undefined;
	let connection: Connection;
	let programs: Model<Program>;
	let members: Model<Member>;
	let likes: Model<Like>;
	let views: Model<View>;
	let articles: Model<BoardArticle>;
	let programService: ProgramService;
	let memberService: MemberService;
	let commentService: CommentService;
	let likeService: LikeService;
	let viewService: ViewService;
	let auth: AuthService;
	let batch: BatchService;
	let trainer: Member;
	let otherTrainer: Member;
	let user: Member;
	let admin: Member;

	beforeAll(async () => {
		mongo = await MongoMemoryServer.create({
			instance: { ip: '127.0.0.1', dbName: 'gymflow_test_' + new Types.ObjectId().toHexString() },
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
			.useValue(new JwtService({ secret: 'disposable-test-key', signOptions: { expiresIn: '1h' } }))
			.compile();
		app = module.createNestApplication();
		app.useGlobalPipes(new ValidationPipe());
		app.use(graphqlUploadExpress({ maxFileSize: 15000000, maxFiles: 10 }));
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		programs = connection.model<Program>('Program');
		members = connection.model<Member>('Member');
		likes = connection.model<Like>('Like');
		views = connection.model<View>('View');
		articles = connection.model<BoardArticle>('BoardArticle');
		// Install actual compound uniqueness indexes before testing races.
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
		programService = module.get(ProgramService);
		memberService = module.get(MemberService);
		commentService = module.get(CommentService);
		likeService = module.get(LikeService);
		viewService = module.get(ViewService);
		auth = module.get(AuthService);
		batch = new BatchService(programs, members);
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
	});
	beforeEach(async () => {
		// Connection is owned exclusively by the disposable server created above.
		await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
		const accounts = await members.create([
			{ memberNick: 'trainer', memberPhone: '1', memberPassword: 'test', memberType: MemberType.TRAINER },
			{ memberNick: 'other', memberPhone: '2', memberPassword: 'test', memberType: MemberType.TRAINER },
			{ memberNick: 'user', memberPhone: '3', memberPassword: 'test', memberType: MemberType.USER },
			{ memberNick: 'admin', memberPhone: '4', memberPassword: 'test', memberType: MemberType.ADMIN },
		]);
		[trainer, otherTrainer, user, admin] = accounts;
	});
	async function gql<T>(
		query: string,
		variables: Record<string, unknown> = {},
		account?: Member,
	): Promise<GraphQLResponse<T>> {
		if (!app) throw new Error('Test application not initialized');
		const req = request(app.getHttpServer() as Server).post('/graphql');
		if (account) req.set('Authorization', 'Bearer ' + (await auth.createToken(account)));
		const response = await req.send({ query, variables });
		expect([200, 400]).toContain(response.status);
		return response.body as GraphQLResponse<T>;
	}
	async function count(): Promise<number | undefined> {
		return (await members.findById(trainer._id).lean().exec())?.memberPrograms;
	}

	it('enforces actual GraphQL role, ownership, current-role and blocked-account guards', async () => {
		const create = 'mutation($input: ProgramInput!) { createProgram(input: $input) {_id memberId programStatus} }';
		expect((await gql(create, { input: offering() }, user)).errors).toBeDefined();
		const result = await gql<{ createProgram: { _id: string; memberId: string; programStatus: string } }>(
			create,
			{ input: offering() },
			trainer,
		);
		expect(result.errors).toBeUndefined();
		expect(result.data?.createProgram.memberId).toBe(trainer._id.toHexString());
		const programId = result.data?.createProgram._id;
		const update = 'mutation($input: ProgramUpdate!) { updateProgram(input: $input) {_id programName} }';
		expect(
			(await gql(update, { input: { _id: programId, programName: 'Forbidden edit' } }, otherTrainer)).errors,
		).toBeDefined();
		const staleToken = await auth.createToken(trainer);
		await memberService.updateMemberByAdmin({ _id: trainer._id, memberType: MemberType.USER });
		expect((await auth.verifyToken(staleToken)).memberType).toBe(MemberType.USER);
		expect((await gql(create, { input: offering() }, trainer)).errors).toBeDefined();
		await memberService.updateMemberByAdmin({ _id: trainer._id, memberStatus: MemberStatus.BLOCK });
		await expect(auth.verifyToken(staleToken)).rejects.toThrow('active account');
		expect((await gql(create, { input: offering() }, trainer)).errors).toBeDefined();
		expect(await count()).toBe(1);
	});

	it('validates HTTP inputs and rejects public or self-service administrative escalation', async () => {
		const create = 'mutation($input: ProgramInput!) { createProgram(input: $input) {_id} }';
		for (const invalid of [
			{ programCapacity: 2 },
			{ programPrice: -1 },
			{ programPrice: 1.5 },
			{ programDuration: 0 },
			{ programCategory: 'APARTMENT' },
			{ programLocation: 'JEJU' },
			{ programType: ProgramType.ONLINE },
			{ programAddress: null },
		]) {
			const res = await gql(create, { input: { ...offering(), ...invalid } }, trainer);
			expect(res.errors).toBeDefined();
		}
		expect(await programs.countDocuments()).toBe(0);
		const signup = await gql(
			'mutation {signup(input:{memberType: ADMIN, memberNick:"escalate", memberPhone:"5", memberPassword:"secret12"}) {_id}}',
		);
		expect(signup.errors).toBeDefined();
		expect((await gql('mutation { updateMember(input:{memberType: ADMIN}) {_id} }', {}, user)).errors).toBeDefined();
		expect((await members.findById(user._id).lean().exec())?.memberType).toBe(MemberType.USER);
	});

	it('persists pause/resume/delete and allows one counter effect in concurrent status writes', async () => {
		const program = await programService.createProgram(trainer._id, offering());
		await programService.updateProgram(trainer._id, { _id: program._id, programStatus: ProgramStatus.PAUSED });
		await programService.updateProgram(trainer._id, { _id: program._id, programStatus: ProgramStatus.PAUSED });
		expect(await count()).toBe(0);
		await programService.updateProgram(trainer._id, { _id: program._id, programStatus: ProgramStatus.ACTIVE });
		const attempts = await Promise.allSettled([
			programService.updateProgram(trainer._id, { _id: program._id, programStatus: ProgramStatus.PAUSED }),
			programService.updateProgram(trainer._id, { _id: program._id, programStatus: ProgramStatus.PAUSED }),
		]);
		expect(attempts.some((attempt) => attempt.status === 'fulfilled')).toBe(true);
		expect(await count()).toBe(0);
		const removed = await programService.updateProgramByAdmin({
			_id: program._id,
			programStatus: ProgramStatus.DELETE,
		});
		expect(removed.deletedAt).toBeInstanceOf(Date);
		expect((await programs.findById(program._id).lean().exec())?.deletedAt).toBeInstanceOf(Date);
		await expect(
			programService.updateProgram(trainer._id, { _id: program._id, programStatus: ProgramStatus.ACTIVE }),
		).rejects.toThrow();
		expect(await count()).toBe(0);
	});

	it('filters public discovery, favorites and history before paging and counting', async () => {
		const visible = await programService.createProgram(trainer._id, offering('Visible strength'));
		const paused = await programService.createProgram(trainer._id, offering('Paused strength'));
		const hidden = await programService.createProgram(otherTrainer._id, offering('Hidden strength'));
		await programService.updateProgram(trainer._id, { _id: paused._id, programStatus: ProgramStatus.PAUSED });
		await members.updateOne({ _id: otherTrainer._id }, { memberStatus: MemberStatus.BLOCK }).exec();
		for (const program of [visible, paused, hidden]) {
			await likeService.toggleLike({ memberId: user._id, likeRefId: program._id, likeGroup: LikeGroup.PROGRAM });
			await viewService.recordView({ memberId: user._id, viewRefId: program._id, viewGroup: ViewGroup.PROGRAM });
		}
		const missing = new Types.ObjectId();
		await likeService.toggleLike({ memberId: user._id, likeRefId: missing, likeGroup: LikeGroup.PROGRAM });
		const input = { page: 1, limit: 1 };
		for (const list of [
			await programService.getFavorites(user._id, input),
			await programService.getVisited(user._id, input),
		]) {
			expect(list.metaCounter).toEqual([{ total: 1 }]);
			expect(list.list[0]._id.equals(visible._id)).toBe(true);
			expect(list.list[0].memberData?.memberNick).toBe('trainer');
			expect(list.list[0].memberData).not.toHaveProperty('memberPassword');
		}
		const discovery = await programService.getPrograms(null, {
			...input,
			search: {
				typeList: [ProgramType.PT_1ON1],
				categoryList: [ProgramCategory.MUSCLE_GAIN],
				locationList: [ProgramLocation.SEOUL],
				pricesRange: { start: 50000, end: 50000 },
				text: 'Visible',
			},
		});
		expect(discovery.metaCounter).toEqual([{ total: 1 }]);
		expect((await programService.getFavorites(user._id, { ...input, page: 2 })).list).toEqual([]);
		expect(
			(await programService.getTrainerPrograms(trainer._id, { page: 1, limit: 10, search: {} })).list,
		).toHaveLength(2);
		await expect(programService.getProgram(user._id, paused._id)).rejects.toThrow();
		await expect(programService.getProgram(user._id, hidden._id)).rejects.toThrow();
	});

	it('installs group-scoped unique indexes and records repeated concurrent views once', async () => {
		const program = await programService.createProgram(trainer._id, offering());
		await Promise.all(Array.from({ length: 5 }, () => programService.getProgram(user._id, program._id)));
		expect((await programs.findById(program._id).lean().exec())?.programViews).toBe(1);
		expect(await views.countDocuments({ viewGroup: ViewGroup.PROGRAM })).toBe(1);
		await viewService.recordView({ memberId: user._id, viewRefId: program._id, viewGroup: ViewGroup.ARTICLE });
		expect(await views.countDocuments()).toBe(2);
		const likesResults = await Promise.all(
			Array.from({ length: 4 }, () =>
				likes.create({ memberId: user._id, likeRefId: program._id, likeGroup: LikeGroup.PROGRAM }).then(
					() => 'created',
					() => 'duplicate',
				),
			),
		);
		expect(likesResults.filter((value) => value === 'created')).toHaveLength(1);
		await likes.create({ memberId: user._id, likeRefId: program._id, likeGroup: LikeGroup.MEMBER });
		expect(await likes.countDocuments()).toBe(2);
	});

	it('maintains article comment counters on soft/hard removal and rejects unavailable targets', async () => {
		const article = await articles.create({
			memberId: trainer._id,
			articleCategory: BoardArticleCategory.FREE,
			articleTitle: 'Training advice',
			articleContent: 'Good advice',
		});
		const comment = await commentService.createComment(user._id, { articleId: article._id, commentContent: 'Helpful' });
		expect((await articles.findById(article._id).lean().exec())?.articleComments).toBe(1);
		expect((await members.findById(user._id).lean().exec())?.memberComments).toBe(1);
		await commentService.updateComment(user._id, { _id: comment._id, commentStatus: CommentStatus.DELETE });
		await commentService.removeCommentByAdmin(comment._id);
		expect((await articles.findById(article._id).lean().exec())?.articleComments).toBe(0);
		expect((await members.findById(user._id).lean().exec())?.memberComments).toBe(0);
		const active = await commentService.createComment(user._id, { articleId: article._id, commentContent: 'Another' });
		await commentService.removeCommentByAdmin(active._id);
		expect((await members.findById(user._id).lean().exec())?.memberComments).toBe(0);
		await articles.updateOne({ _id: article._id }, { articleStatus: BoardArticleStatus.DELETE }).exec();
		await expect(
			commentService.createComment(user._id, { articleId: article._id, commentContent: 'Invalid' }),
		).rejects.toThrow();
		await expect(
			commentService.createComment(user._id, { articleId: new Types.ObjectId(), commentContent: 'Invalid' }),
		).rejects.toThrow();
	});

	it('reconciles corrupted caches and repeatable ranks with real aggregation and pipeline updates', async () => {
		const program = await programService.createProgram(trainer._id, offering());
		const paused = await programService.createProgram(trainer._id, offering('Paused program'));
		await programService.updateProgram(trainer._id, { _id: paused._id, programStatus: ProgramStatus.PAUSED });
		await programService.likeTargetProgram(user._id, program._id);
		await programService.getProgram(user._id, program._id);
		await programs.updateMany({}, { programRank: 999, programViews: 999, programLikes: 999 }).exec();
		await members.updateMany({}, { memberPrograms: 999, memberRank: 999 }).exec();
		await members.updateOne({ _id: trainer._id }, { memberArticles: 2, memberLikes: 3, memberViews: 4 }).exec();
		for (let repeat = 0; repeat < 2; repeat++) {
			await batch.batchRollback();
			await batch.batchTopPrograms();
			await batch.batchTopTrainers();
			expect(await programs.findById(program._id).lean().exec()).toMatchObject({
				programLikes: 1,
				programViews: 1,
				programRank: 3,
			});
			expect((await programs.findById(paused._id).lean().exec())?.programRank).toBe(0);
			expect(await members.findById(trainer._id).lean().exec()).toMatchObject({ memberPrograms: 1, memberRank: 21 });
			expect(await members.findById(user._id).lean().exec()).toMatchObject({ memberPrograms: 0, memberRank: 0 });
		}
		await members.updateOne({ _id: trainer._id }, { memberStatus: MemberStatus.BLOCK }).exec();
		await batch.batchTopPrograms();
		await batch.batchTopTrainers();
		expect((await programs.findById(program._id).lean().exec())?.programRank).toBe(0);
		expect((await members.findById(trainer._id).lean().exec())?.memberRank).toBe(0);
	});

	it('hard-deletes only DELETE programs and cleans program children without decrementing twice', async () => {
		const program = await programService.createProgram(trainer._id, offering());
		await programService.likeTargetProgram(user._id, program._id);
		await programService.getProgram(user._id, program._id);
		await connection.model('Notification').create({
			programId: program._id,
			receiverId: user._id,
			notificationType: NotificationType.LIKE,
			notificationGroup: NotificationGroup.PROGRAM,
			notificationTitle: 'Liked',
			notificationDesc: 'Program liked',
		});
		await expect(programService.removeProgramByAdmin(program._id)).rejects.toThrow();
		await programService.updateProgramByAdmin({ _id: program._id, programStatus: ProgramStatus.DELETE });
		const removal = await gql(
			'mutation($id: String!) { removeProgramByAdmin(programId:$id) {_id} }',
			{ id: program._id.toHexString() },
			admin,
		);
		expect(removal.errors).toBeUndefined();
		expect(await programs.findById(program._id).exec()).toBeNull();
		expect(await likes.countDocuments()).toBe(0);
		expect(await views.countDocuments()).toBe(0);
		expect(await connection.model('Notification').countDocuments()).toBe(0);
		expect(await count()).toBe(0);
	});

	it('retains member/article engagement, follows, signup/login and safe password changes', async () => {
		const signed = await memberService.signup({
			memberType: MemberType.USER,
			memberNick: 'signup',
			memberPhone: '5',
			memberPassword: 'secret12',
		});
		expect(
			(await memberService.login({ memberNick: 'signup', memberPassword: 'secret12' }))._id.equals(signed._id),
		).toBe(true);
		await memberService.updateMember(signed._id, { memberPassword: 'changed12', memberFullName: 'Updated user' });
		await expect(memberService.login({ memberNick: 'signup', memberPassword: 'secret12' })).rejects.toThrow();
		expect(
			(await memberService.login({ memberNick: 'signup', memberPassword: 'changed12' }))._id.equals(signed._id),
		).toBe(true);
		await memberService.likeTargetMember(user._id, trainer._id);
		const articleService = app!.get(BoardArticleService);
		const article = await articleService.createBoardArticle(trainer._id, {
			articleCategory: BoardArticleCategory.FREE,
			articleTitle: 'Training advice',
			articleContent: 'Training advice content',
		});
		await articleService.likeTargetBoardArticle(user._id, article._id);
		await articleService.getBoardArticle(user._id, article._id);
		await articleService.getBoardArticle(user._id, article._id);
		expect(await articles.findById(article._id).lean().exec()).toMatchObject({ articleLikes: 1, articleViews: 1 });
		const followService = app!.get(FollowService);
		await followService.subscribe(user._id, trainer._id);
		expect((await members.findById(trainer._id).lean().exec())?.memberFollowers).toBe(1);
		await followService.unsubscribe(user._id, trainer._id);
		expect((await members.findById(trainer._id).lean().exec())?.memberFollowers).toBe(0);
	});
	it('accepts an authenticated multipart program image and preserves its bytes', async () => {
		if (!app) throw new Error('Test application not initialized');
		const bytes = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
			'base64',
		);
		const response = await request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Authorization', 'Bearer ' + (await auth.createToken(trainer)))
			.set('Apollo-Require-Preflight', 'true')
			.field(
				'operations',
				JSON.stringify({
					query: 'mutation($file: Upload!) { imageUploader(file:$file, target:"program") }',
					variables: { file: null },
				}),
			)
			.field('map', JSON.stringify({ '0': ['variables.file'] }))
			.attach('0', bytes, { filename: 'test.png', contentType: 'image/png' })
			.expect(200);
		const body = response.body as GraphQLResponse<{ imageUploader: string }>;
		expect(body.errors).toBeUndefined();
		const file = body.data?.imageUploader;
		if (!file || !/^uploads\/program\/[a-f0-9-]+\.png$/.test(file)) throw new Error('Unexpected test upload path');
		try {
			expect(await readFile(file)).toEqual(bytes);
		} finally {
			await unlink(file);
		} // Only the UUID file created by this test is removed.
	});
});
