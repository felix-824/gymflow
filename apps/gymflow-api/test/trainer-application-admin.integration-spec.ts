import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule, GraphQLSchemaHost } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { GraphQLObjectType } from 'graphql';
import request from 'supertest';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import { ComponentsModule } from '../src/components/components.module';
import { TrainerApplicationService } from '../src/components/trainer-application/trainer-application.service';
import { TrainerApplication } from '../src/libs/dto/trainer-application/trainer-application';
import {
	TrainerApplicationAdmin,
	TrainerApplications,
} from '../src/libs/dto/trainer-application/trainer-application-admin';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import { ProgramCategory, ProgramLocation, ProgramType } from '../src/libs/enums/program.enum';
import { TrainerApplicationStatus as Status } from '../src/libs/enums/trainer-application.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
import { dependency } from './helpers';
import * as availability from '../src/libs/availability';

interface Result {
	data?: {
		getTrainerApplicationsByAdmin?: TrainerApplications;
		getTrainerApplicationByAdmin?: TrainerApplicationAdmin;
		reviewTrainerApplication?: TrainerApplicationAdmin;
		getMyReservations?: { list: Reservation[]; metaCounter: { total: number }[] };
		cancelReservation?: Reservation;
		createReview?: { _id: string };
	};
	errors?: { message: string }[];
}
const fields =
	'_id memberId status fullName categories experienceSummary bio rejectionReason reviewedBy reviewedAt createdAt updatedAt memberData{_id memberNick memberFullName memberImage memberType memberStatus}';
const listQuery =
	'query($input:TrainerApplicationsInquiry!){getTrainerApplicationsByAdmin(input:$input){list{' +
	fields +
	'} metaCounter{total}}}';
const detailQuery =
	'query($applicationId:String!){getTrainerApplicationByAdmin(applicationId:$applicationId){' + fields + '}}';
const reviewMutation =
	'mutation($input:TrainerApplicationReview!){reviewTrainerApplication(input:$input){' + fields + '}}';
function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

// All state is owned disposable replica-set data. No AppModule, DatabaseModule, application URI or .env.
describe('Admin trainer review against real GraphQL and disposable MongoDB', () => {
	let app: INestApplication, mongo: MongoMemoryReplSet, connection: Connection, service: TrainerApplicationService;
	let members: Model<Member>,
		applications: Model<TrainerApplication>,
		programs: Model<Program>,
		reservations: Model<Reservation>;
	let user: Member, other: Member, trainer: Member, admin: Member, adminB: Member;
	beforeAll(async () => {
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger', dbName: 'admin_trainer_review_owned' },
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri()),
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
		members = connection.model<Member>('Member');
		applications = connection.model<TrainerApplication>('TrainerApplication');
		programs = connection.model<Program>('Program');
		reservations = connection.model<Reservation>('Reservation');
		service = module.get(TrainerApplicationService);
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
	});
	afterEach(() => jest.restoreAllMocks());
	beforeEach(async () => {
		await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
		[user, other, trainer, admin, adminB] = await members.create([
			{
				_id: new Types.ObjectId('100000000000000000000001'),
				memberNick: 'review-user',
				memberPhone: 'private-phone',
				memberPassword: 'private-password',
				memberType: MemberType.USER,
				memberAddress: 'private-address',
			},
			{
				_id: new Types.ObjectId('100000000000000000000002'),
				memberNick: 'review-other',
				memberPhone: 'private-2',
				memberPassword: 'fixture',
				memberType: MemberType.USER,
			},
			{
				_id: new Types.ObjectId('200000000000000000000001'),
				memberNick: 'review-trainer',
				memberPhone: 'private-3',
				memberPassword: 'fixture',
				memberType: MemberType.TRAINER,
			},
			{
				_id: new Types.ObjectId('000000000000000000000001'),
				memberNick: 'review-admin',
				memberPhone: 'private-4',
				memberPassword: 'fixture',
				memberType: MemberType.ADMIN,
			},
			{
				_id: new Types.ObjectId('f00000000000000000000001'),
				memberNick: 'review-admin-b',
				memberPhone: 'private-5',
				memberPassword: 'fixture',
				memberType: MemberType.ADMIN,
			},
		]);
	});
	async function gql(
		query: string,
		variables: Record<string, unknown> = {},
		actor: Member | null = admin,
		token?: string,
	): Promise<Result> {
		const operation = request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true');
		if (token || actor) operation.set('Authorization', 'Bearer ' + (token ?? (await fixtureAccessToken(actor!, app))));
		return (await operation.send({ query, variables })).body as Result;
	}
	const seed = (memberId = user._id, extra: object = {}) =>
		applications.create({
			memberId,
			fullName: 'Applicant Name',
			categories: [ProgramCategory.YOGA],
			experienceSummary: 'Five years',
			bio: 'Teaching fitness',
			...extra,
		});
	const review = (
		record: TrainerApplication,
		decision = Status.APPROVED,
		actor: Member | null = admin,
		extra: object = {},
	) =>
		gql(
			reviewMutation,
			{
				input: {
					applicationId: String(record._id),
					decision,
					...(decision === Status.REJECTED ? { rejectionReason: ' More experience needed ' } : {}),
					...extra,
				},
			},
			actor,
		);
	const snapshot = async () =>
		JSON.stringify([
			await members.find({}).sort({ _id: 1 }).lean(),
			await applications.find({}).sort({ _id: 1 }).lean(),
		]);
	const failed = (result: Result) => {
		expect(result.errors?.length).toBeGreaterThan(0);
		expect(result.data?.reviewTrainerApplication).toBeFalsy();
	};
	it.each(['guest', 'USER', 'TRAINER', 'BLOCK', 'DELETE'])(
		'denies %s across all admin endpoints and direct service calls',
		async (kind) => {
			const record = await seed();
			const actor = kind === 'guest' ? null : kind === 'USER' ? user : kind === 'TRAINER' ? trainer : admin;
			if (kind === 'BLOCK' || kind === 'DELETE') await members.updateOne({ _id: admin._id }, { memberStatus: kind });
			const before = await snapshot();
			expect((await gql(listQuery, { input: { page: 1, limit: 10, search: {} } }, actor)).errors).toBeDefined();
			expect((await gql(detailQuery, { applicationId: String(record._id) }, actor)).errors).toBeDefined();
			failed(await review(record, Status.APPROVED, actor));
			if (actor) {
				await expect(
					service.getTrainerApplicationsByAdmin(actor._id, { page: 1, limit: 10, search: {} }),
				).rejects.toThrow('active ADMIN');
				await expect(service.getTrainerApplicationByAdmin(actor._id, String(record._id))).rejects.toThrow(
					'active ADMIN',
				);
				await expect(
					service.reviewTrainerApplication(actor._id, { applicationId: String(record._id), decision: Status.APPROVED }),
				).rejects.toThrow('active ADMIN');
			}
			expect(await snapshot()).toBe(before);
		},
	);
	it('paginates newest first with deterministic ties and filters before totals/pagination', async () => {
		const first = await seed(user._id, { status: Status.REJECTED, createdAt: new Date('2026-01-01') });
		const second = await seed(user._id, { createdAt: new Date('2026-02-01') });
		const third = await seed(other._id, { createdAt: new Date('2026-02-01') });
		const result = await gql(listQuery, { input: { page: 1, limit: 1, search: {} } });
		expect(result.errors).toBeUndefined();
		expect(String(result.data!.getTrainerApplicationsByAdmin!.list[0]._id)).toBe(String(third._id));
		expect(result.data!.getTrainerApplicationsByAdmin!.metaCounter).toEqual([{ total: 3 }]);
		const page = await gql(listQuery, { input: { page: 2, limit: 1, search: { status: Status.PENDING } } });
		expect(String(page.data!.getTrainerApplicationsByAdmin!.list[0]._id)).toBe(String(second._id));
		expect(page.data!.getTrainerApplicationsByAdmin!.metaCounter).toEqual([{ total: 2 }]);
		const rejected = await gql(listQuery, { input: { page: 1, limit: 10, search: { status: Status.REJECTED } } });
		expect(String(rejected.data!.getTrainerApplicationsByAdmin!.list[0]._id)).toBe(String(first._id));
		const empty = await gql(listQuery, { input: { page: 1, limit: 10, search: { status: Status.APPROVED } } });
		expect(empty.data!.getTrainerApplicationsByAdmin).toEqual({ list: [], metaCounter: [] });
	});
	it('returns safe detail and rejects missing/malformed identities without leaking Member secrets', async () => {
		const record = await seed();
		const result = await gql(detailQuery, { applicationId: String(record._id) });
		expect(result.errors).toBeUndefined();
		expect(result.data!.getTrainerApplicationByAdmin!.memberData).toMatchObject({
			_id: String(user._id),
			memberType: MemberType.USER,
			memberStatus: MemberStatus.ACTIVE,
		});
		const raw = await service.getTrainerApplicationByAdmin(admin._id, String(record._id));
		expect(Object.keys(raw.memberData!).sort()).toEqual([
			'_id',
			'memberImage',
			'memberNick',
			'memberStatus',
			'memberType',
		]);
		expect(JSON.stringify(raw)).not.toMatch(
			/private-phone|private-password|private-address|memberAuthType|authSession|refreshDigest/,
		);
		for (const applicationId of ['bad', String(new Types.ObjectId())])
			expect((await gql(detailQuery, { applicationId })).errors).toBeDefined();
		const schema = app.get(GraphQLSchemaHost).schema;
		const ownerFields = (schema.getType('TrainerApplication') as GraphQLObjectType).getFields();
		expect(ownerFields.reviewedBy).toBeUndefined();
		expect(ownerFields.memberData).toBeUndefined();
		expect((await gql('{getMyTrainerApplication{reviewedBy memberData{_id}}}', {}, user)).errors).toBeDefined();
	});
	it('atomically approves PENDING + USER, sets server audit fields, and updates current-token role', async () => {
		const record = await seed();
		const token = await fixtureAccessToken(user, app);
		const before = Date.now();
		const result = await review(record);
		expect(result.errors).toBeUndefined();
		expect(result.data!.reviewTrainerApplication).toMatchObject({
			status: Status.APPROVED,
			reviewedBy: String(admin._id),
			rejectionReason: null,
			memberData: { memberType: MemberType.TRAINER },
		});
		const persisted = (await applications.findById(record._id))!;
		expect(persisted.reviewedAt!.getTime()).toBeGreaterThanOrEqual(before);
		expect(persisted.reviewedAt!.getTime()).toBeLessThanOrEqual(Date.now());
		expect(persisted.reviewedBy!.equals(admin._id)).toBe(true);
		expect((await members.findById(user._id))!.memberType).toBe(MemberType.TRAINER);
		expect(
			(await gql('{getTrainerPrograms(input:{page:1,limit:10,search:{}}){list{_id}}}', {}, null, token)).errors,
		).toBeUndefined();
	});
	it.each([MemberStatus.ACTIVE, MemberStatus.BLOCK, MemberStatus.DELETE])(
		'rejects a pending %s USER without restoring or promoting the account',
		async (memberStatus) => {
			const record = await seed();
			await members.updateOne({ _id: user._id }, { memberStatus });
			const result = await review(record, Status.REJECTED);
			expect(result.errors).toBeUndefined();
			const persisted = (await applications.findById(record._id))!;
			expect(persisted.status).toBe(Status.REJECTED);
			expect(persisted.rejectionReason).toBe('More experience needed');
			expect(persisted.reviewedBy!.equals(admin._id)).toBe(true);
			expect(persisted.reviewedAt).toBeInstanceOf(Date);
			expect((await members.findById(user._id))!).toMatchObject({ memberType: MemberType.USER, memberStatus });
		},
	);
	it.each([MemberStatus.BLOCK, MemberStatus.DELETE])(
		'denies approval of %s applicants with no partial change',
		async (memberStatus) => {
			const record = await seed();
			await members.updateOne({ _id: user._id }, { memberStatus });
			const before = await snapshot();
			failed(await review(record));
			expect(await snapshot()).toBe(before);
		},
	);
	it.each([
		{ decision: Status.PENDING },
		{ rejectionReason: null },
		{ rejectionReason: ' ' },
		{ rejectionReason: 'a'.repeat(1001) },
		{ decision: Status.APPROVED, rejectionReason: 'not allowed' },
		{ decision: Status.APPROVED, rejectionReason: null },
	])('rejects invalid review input %# without writes', async (change) => {
		const record = await seed();
		const before = await snapshot();
		failed(await review(record, Status.REJECTED, admin, change));
		expect(await snapshot()).toBe(before);
	});
	it('requires a rejection reason when omitted and rejects client-owned audit/identity/role fields', async () => {
		const record = await seed();
		const before = await snapshot();
		failed(await gql(reviewMutation, { input: { applicationId: String(record._id), decision: Status.REJECTED } }));
		for (const key of ['memberId', 'memberType', 'reviewedBy', 'reviewedAt'])
			failed(await review(record, Status.APPROVED, admin, { [key]: String(other._id) }));
		expect(await snapshot()).toBe(before);
	});
	it.each([Status.APPROVED, Status.REJECTED])(
		'retries a committed %s decision without overwriting audit fields',
		async (decision) => {
			const record = await seed();
			expect((await review(record, decision)).errors).toBeUndefined();
			const before = await applications.findById(record._id).lean();
			expect(
				(
					await review(
						record,
						decision,
						adminB,
						decision === Status.REJECTED ? { rejectionReason: 'Different retry reason' } : {},
					)
				).errors,
			).toBeUndefined();
			expect(await applications.findById(record._id).lean()).toEqual(before);
			failed(await review(record, decision === Status.APPROVED ? Status.REJECTED : Status.APPROVED, adminB));
			expect(await applications.findById(record._id).lean()).toEqual(before);
		},
	);
	it('does not silently repair APPROVED + USER on retry', async () => {
		const record = await seed();
		expect((await review(record)).errors).toBeUndefined();
		await members.updateOne({ _id: user._id }, { memberType: MemberType.USER });
		const before = await snapshot();
		failed(await review(record));
		expect(await snapshot()).toBe(before);
	});
	it.each([MemberType.TRAINER, MemberType.ADMIN])(
		'rejects inconsistent pending applicant role %s without promoting or demoting',
		async (memberType) => {
			const record = await seed();
			await members.updateOne({ _id: user._id }, { memberType });
			const before = await snapshot();
			failed(await review(record));
			failed(await review(record, Status.REJECTED));
			expect(await snapshot()).toBe(before);
		},
	);
	it('does not review an orphaned application', async () => {
		const record = await seed();
		await members.deleteOne({ _id: user._id });
		const before = await snapshot();
		failed(await review(record));
		failed(await review(record, Status.REJECTED));
		expect(await snapshot()).toBe(before);
	});
	it('rolls back when the conditional member transition fails', async () => {
		const record = await seed();
		const before = await snapshot();
		const original = members.collection.findOneAndUpdate.bind(
			members.collection,
		) as typeof members.collection.findOneAndUpdate;
		jest
			.spyOn(members.collection, 'findOneAndUpdate')
			.mockImplementationOnce(original)
			.mockImplementationOnce(original)
			.mockResolvedValueOnce(dependency<Awaited<ReturnType<typeof original>>>(null));
		failed(await review(record));
		expect(await snapshot()).toBe(before);
	});
	it.each([Status.APPROVED, Status.REJECTED])(
		'rolls back %s when the conditional application transition loses its precondition',
		async (decision) => {
			const record = await seed();
			const before = await snapshot();
			jest
				.spyOn(applications.collection, 'findOneAndUpdate')
				.mockResolvedValueOnce(dependency<Awaited<ReturnType<typeof applications.collection.findOneAndUpdate>>>(null));
			failed(await review(record, decision));
			expect(await snapshot()).toBe(before);
		},
	);
	it.each([Status.APPROVED, Status.REJECTED])(
		'rolls back %s after real writes if the final transactional read fails',
		async (decision) => {
			const record = await seed();
			const before = await snapshot();
			jest.spyOn(applications, 'aggregate').mockImplementationOnce(() => {
				throw new Error('Injected failure after review writes');
			});
			failed(await review(record, decision));
			expect(await snapshot()).toBe(before);
		},
	);
	it.each([
		[Status.APPROVED, Status.APPROVED],
		[Status.APPROVED, Status.REJECTED],
		[Status.REJECTED, Status.REJECTED],
	])('first committed terminal decision wins for %s versus %s', async (first, second) => {
		const record = await seed();
		const results = await Promise.all([review(record, first), review(record, second, adminB)]);
		const committed = (await applications.findById(record._id))!;
		expect([first, second]).toContain(committed.status);
		expect((await members.findById(user._id))!.memberType).toBe(
			committed.status === Status.APPROVED ? MemberType.TRAINER : MemberType.USER,
		);
		expect([String(admin._id), String(adminB._id)]).toContain(String(committed.reviewedBy));
		expect(committed.reviewedAt).toBeInstanceOf(Date);
		if (first === second) expect(results.every((result) => !result.errors)).toBe(true);
		else expect(results.filter((result) => !result.errors)).toHaveLength(1);
		const before = await applications.findById(record._id).lean();
		expect((await review(record, committed.status, adminB)).errors).toBeUndefined();
		expect(await applications.findById(record._id).lean()).toEqual(before);
	});
	it.each(['applicant-BLOCK', 'applicant-DELETE', 'reviewer-BLOCK', 'reviewer-DELETE', 'reviewer-role'])(
		'revalidates concurrent %s after a real transaction snapshot/member write',
		async (kind) => {
			const record = await seed();
			const entered = barrier(),
				resume = barrier();
			const original = members.collection.findOneAndUpdate.bind(
				members.collection,
			) as typeof members.collection.findOneAndUpdate;
			jest
				.spyOn(members.collection, 'findOneAndUpdate')
				.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
					const result = await original(...args);
					entered.release();
					await resume.promise;
					return result;
				});
			const reviewer = kind.startsWith('applicant') ? admin : adminB;
			const pending = review(record, Status.APPROVED, reviewer);
			await entered.promise;
			try {
				await members.updateOne(
					{ _id: kind.startsWith('applicant') ? user._id : reviewer._id },
					kind.endsWith('role')
						? { memberType: MemberType.USER }
						: { memberStatus: kind.endsWith('BLOCK') ? MemberStatus.BLOCK : MemberStatus.DELETE },
				);
			} finally {
				resume.release();
			}
			failed(await pending);
			expect((await applications.findById(record._id))!).toMatchObject({
				status: Status.PENDING,
				reviewedBy: null,
				reviewedAt: null,
			});
			expect((await members.findById(user._id))!.memberType).toBe(MemberType.USER);
		},
	);
	it('rejects a changed application owner instead of promoting the preliminary owner', async () => {
		const record = await seed();
		jest.spyOn(applications, 'init').mockImplementationOnce(async () => {
			await applications.collection.updateOne({ _id: record._id }, { $set: { memberId: other._id } });
			return applications;
		});
		failed(await review(record));
		expect((await members.findById(user._id))!.memberType).toBe(MemberType.USER);
		expect((await members.findById(other._id))!.memberType).toBe(MemberType.USER);
		expect((await applications.findById(record._id))!.status).toBe(Status.PENDING);
	});
	it('preserves the generic admin TRAINER promotion restriction', async () => {
		const record = await seed();
		const before = await snapshot();
		expect(
			(await gql('mutation{updateMemberByAdmin(input:{_id:"' + String(user._id) + '",memberType:TRAINER}){_id}}'))
				.errors,
		).toBeDefined();
		expect(await snapshot()).toBe(before);
		expect((await applications.findById(record._id))!.status).toBe(Status.PENDING);
	});
	it('retains rejection history through real reapplication and approval without changing grandfathered trainers', async () => {
		const record = await seed();
		const grandfathered = await members.findById(trainer._id).lean();
		expect((await review(record, Status.REJECTED)).errors).toBeUndefined();
		const rejected = await applications.findById(record._id).lean();
		const result = await gql(
			'mutation($input:TrainerApplicationInput!){submitTrainerApplication(input:$input){_id}}',
			{
				input: {
					fullName: 'Applicant Name',
					categories: [ProgramCategory.YOGA],
					experienceSummary: 'More experience',
					bio: 'Teaching fitness',
					previousApplicationId: String(record._id),
				},
			},
			user,
		);
		expect(result.errors).toBeUndefined();
		const pending = (await applications.findOne({ memberId: user._id, status: Status.PENDING }))!;
		expect(pending).not.toBeNull();
		expect((await review(pending)).errors).toBeUndefined();
		expect(await applications.findById(record._id).lean()).toEqual(rejected);
		expect(await applications.countDocuments({ memberId: user._id })).toBe(2);
		expect(await members.findById(trainer._id).lean()).toEqual(grandfathered);
		expect(await applications.countDocuments({ memberId: trainer._id })).toBe(0);
	});
	it('preserves promoted TRAINER customer history, eligible cancellation/review, and USER-only new booking', async () => {
		jest.spyOn(availability, 'getSeoulDateTime').mockReturnValue({ reservationDate: '2030-01-08', time: '08:00' });
		const program = await programs.create({
			memberId: trainer._id,
			programName: 'History training',
			programCategory: ProgramCategory.YOGA,
			programType: ProgramType.PT_1ON1,
			programLocation: ProgramLocation.SEOUL,
			programAddress: 'Seoul gym',
			programPrice: 10000,
			programDuration: 60,
			programCapacity: 1,
			programImages: ['fixture.webp'],
		});
		const [future, completed] = await reservations.create([
			{
				memberId: user._id,
				trainerId: trainer._id,
				programId: program._id,
				reservationDate: '2030-01-09',
				startTime: '09:00',
				endTime: '10:00',
				reservationStatus: ReservationStatus.CONFIRMED,
			},
			{
				memberId: user._id,
				trainerId: trainer._id,
				programId: program._id,
				reservationDate: '2030-01-07',
				startTime: '09:00',
				endTime: '10:00',
				reservationStatus: ReservationStatus.COMPLETED,
			},
			{
				memberId: other._id,
				trainerId: trainer._id,
				programId: program._id,
				reservationDate: '2030-01-09',
				startTime: '10:00',
				endTime: '11:00',
				reservationStatus: ReservationStatus.PENDING,
			},
		]);
		const record = await seed();
		const token = await fixtureAccessToken(user, app);
		expect((await review(record)).errors).toBeUndefined();
		for (const period of ['UPCOMING', 'HISTORY']) {
			const result = await gql(
				'{getMyReservations(input:{page:1,limit:100,search:{period:' +
					period +
					'}}){list{_id memberId} metaCounter{total}}}',
				{},
				null,
				token,
			);
			expect(result.errors).toBeUndefined();
			expect(result.data!.getMyReservations!.metaCounter).toEqual([{ total: 1 }]);
			expect(result.data!.getMyReservations!.list.every((row) => String(row.memberId) === String(user._id))).toBe(true);
		}
		expect(
			(
				await gql(
					'mutation{cancelReservation(reservationId:"' + String(future._id) + '"){reservationStatus}}',
					{},
					null,
					token,
				)
			).errors,
		).toBeUndefined();
		expect(
			(
				await gql(
					'mutation{createReview(input:{reservationId:"' +
						String(completed._id) +
						'",rating:5,content:"Good session"}){_id}}',
					{},
					null,
					token,
				)
			).errors,
		).toBeUndefined();
		expect(await connection.model('Review').countDocuments({ memberId: user._id })).toBe(1);
		expect(
			(
				await gql(
					'mutation{createReservation(input:{programId:"' +
						String(program._id) +
						'",reservationDate:"2030-01-09",startTime:"11:00"}){_id}}',
					{},
					null,
					token,
				)
			).errors,
		).toBeDefined();
		expect(await reservations.countDocuments({})).toBe(3);
		expect((await members.findById(user._id))!.memberType).toBe(MemberType.TRAINER);
	});
});
