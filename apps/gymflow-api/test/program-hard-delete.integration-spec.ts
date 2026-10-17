import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { Server } from 'node:http';
import { resolve } from 'node:path';
import request from 'supertest';
import { ComponentsModule } from '../src/components/components.module';
import { ProgramService } from '../src/components/program/program.service';
import { ReservationService } from '../src/components/reservation/reservation.service';
import { ReviewService } from '../src/components/review/review.service';
import { LikeService } from '../src/components/like/like.service';
import { ViewService } from '../src/components/view/view.service';
import { Member } from '../src/libs/dto/member/member';
import { Program } from '../src/libs/dto/program/program';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { Review } from '../src/libs/dto/review/review';
import { MemberStatus } from '../src/libs/enums/member.enum';
import { ProgramStatus, ProgramType, ProgramCategory, ProgramLocation } from '../src/libs/enums/program.enum';
import { ReservationStatus } from '../src/libs/enums/reservation.enum';
import { getAvailabilityWeekday, getSeoulDateTime } from '../src/libs/availability';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';

function barrier() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

// Only this suite's owned replica set is used. No application database or media files are touched.
describe('Admin Program hard-delete integrity', () => {
	let app: INestApplication, mongo: MongoMemoryReplSet, connection: Connection;
	let programs: Model<Program & { __v: number }>, members: Model<Member>;
	let reservations: Model<Reservation>, reviews: Model<Review>;
	let service: ProgramService, booking: ReservationService, reviewing: ReviewService;
	let likes: LikeService, views: ViewService;
	let trainer: Member, user: Member, admin: Member, program: Program;
	const names = ['programs', 'reservations', 'reviews', 'likes', 'views', 'notifications'];
	const oldDownload = process.env.MONGOMS_RUNTIME_DOWNLOAD;
	const blocked = 'Program cannot be permanently deleted because reservation or review history exists.';
	beforeAll(async () => {
		process.env.MONGOMS_RUNTIME_DOWNLOAD = 'false';
		mongo = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1', dbName: 'program_removal_test' },
		});
		const module = await Test.createTestingModule({
			imports: [
				MongooseModule.forRoot(mongo.getUri()),
				ComponentsModule,
				GraphQLModule.forRoot({
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
		programs = connection.model<Program & { __v: number }>('Program');
		members = connection.model<Member>('Member');
		reservations = connection.model<Reservation>('Reservation');
		reviews = connection.model<Review>('Review');
		service = module.get(ProgramService);
		booking = module.get(ReservationService);
		reviewing = module.get(ReviewService);
		likes = module.get(LikeService);
		views = module.get(ViewService);
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
	});
	afterAll(async () => {
		jest.restoreAllMocks();
		await app?.close();
		await mongo?.stop();
		if (oldDownload === undefined) delete process.env.MONGOMS_RUNTIME_DOWNLOAD;
		else process.env.MONGOMS_RUNTIME_DOWNLOAD = oldDownload;
	});
	beforeEach(async () => {
		jest.restoreAllMocks();
		await Promise.all(Object.values(connection.models).map((model) => model.deleteMany({}).exec()));
		[trainer, user, admin] = await members.create(
			['TRAINER', 'USER', 'ADMIN'].map((memberType, i) => ({
				memberType,
				memberNick: 'removal-' + i,
				memberPhone: 'removal-' + i,
				memberPassword: 'fixture-only',
			})),
		);
		program = await service.createProgram(trainer._id, {
			programType: ProgramType.PT_1ON1,
			programCategory: ProgramCategory.MUSCLE_GAIN,
			programLocation: ProgramLocation.SEOUL,
			programName: 'Removal fixture',
			programAddress: 'Seoul studio',
			programPrice: 10000,
			programDuration: 60,
			programCapacity: 1,
			programImages: ['uploads/program/retained.jpg'],
		});
	});
	async function remove(viewer: Member | null = admin, id = String(program._id)) {
		let req = request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true');
		if (viewer) req = req.set('Authorization', 'Bearer ' + (await fixtureAccessToken(viewer, app)));
		const response = await req.send({
			query: 'mutation($id:String!){removeProgramByAdmin(programId:$id){_id}}',
			variables: { id },
		});
		return response.body as {
			data?: { removeProgramByAdmin?: { _id: string } };
			errors?: { message: string; extensions: { code: string } }[];
		};
	}
	async function soft() {
		await service.updateProgramByAdmin({ _id: program._id, programStatus: ProgramStatus.DELETE });
	}
	async function history(status = ReservationStatus.COMPLETED) {
		return reservations.create({
			programId: program._id,
			memberId: user._id,
			trainerId: trainer._id,
			reservationDate: '2000-01-07',
			startTime: '09:00',
			endTime: '10:00',
			reservationStatus: status,
		});
	}
	async function review(reservationId = new Types.ObjectId()) {
		return reviews.create({
			reservationId,
			programId: program._id,
			memberId: user._id,
			trainerId: trainer._id,
			rating: 5,
			content: 'History',
		});
	}
	async function engagement() {
		await connection.collection('likes').insertMany(
			['PROGRAM', 'MEMBER', 'ARTICLE'].map((likeGroup) => ({
				memberId: user._id,
				likeRefId: program._id,
				likeGroup,
			})),
		);
		await connection.collection('views').insertMany(
			['PROGRAM', 'MEMBER', 'ARTICLE'].map((viewGroup) => ({
				memberId: user._id,
				viewRefId: program._id,
				viewGroup,
			})),
		);
		await connection.collection('notifications').insertMany([
			{ programId: program._id, receiverId: user._id },
			{ programId: new Types.ObjectId(), receiverId: user._id },
		]);
	}
	async function snapshot() {
		return JSON.stringify(
			await Promise.all(names.map((name) => connection.collection(name).find({}).sort({ _id: 1 }).toArray())),
		);
	}
	async function absent() {
		expect(await programs.exists({ _id: program._id })).toBeNull();
		for (const name of ['reservations', 'reviews', 'notifications'])
			expect(await connection.collection(name).countDocuments({ programId: program._id })).toBe(0);
		expect(await connection.collection('likes').countDocuments({ likeRefId: program._id, likeGroup: 'PROGRAM' })).toBe(
			0,
		);
		expect(await connection.collection('views').countDocuments({ viewRefId: program._id, viewGroup: 'PROGRAM' })).toBe(
			0,
		);
	}
	it('ADMIN removes only dependency-free DELETE parent/engagement, with no second memberPrograms decrement', async () => {
		await engagement();
		await soft();
		const before = (await members.findById(trainer._id).lean())!.memberPrograms;
		expect((await remove()).errors).toBeUndefined();
		await absent();
		expect(await connection.collection('likes').countDocuments()).toBe(2);
		expect(await connection.collection('views').countDocuments()).toBe(2);
		expect(await connection.collection('notifications').countDocuments()).toBe(1);
		expect((await members.findById(trainer._id).lean())!.memberPrograms).toBe(before);
		expect(before).toBe(0);
		expect((await remove()).errors![0].message).toBe('Soft-deleted program not found');
	});
	it.each([ProgramStatus.ACTIVE, ProgramStatus.PAUSED])(
		'rejects non-DELETE %s without changing state',
		async (status) => {
			if (status === ProgramStatus.PAUSED)
				await service.updateProgramByAdmin({ _id: program._id, programStatus: status });
			await engagement();
			const before = await snapshot();
			expect((await remove()).errors![0].message).toBe('Soft-deleted program not found');
			expect(await snapshot()).toBe(before);
		},
	);
	it.each(Object.values(ReservationStatus))(
		'any %s Reservation, even ended, blocks and rolls back version/state/engagement',
		async (status) => {
			await history(status);
			await engagement();
			await soft();
			const before = await snapshot();
			const result = await remove();
			expect(result.errors![0].message).toBe(blocked);
			expect(result.errors![0].extensions.code).toBe('BAD_REQUEST');
			expect(await snapshot()).toBe(before);
		},
	);
	it('also blocks an unknown persisted legacy Reservation status', async () => {
		await connection.collection('reservations').insertOne({ programId: program._id, reservationStatus: 'LEGACY' });
		await soft();
		const before = await snapshot();
		expect((await remove()).errors![0].message).toBe(blocked);
		expect(await snapshot()).toBe(before);
	});
	it.each(['review-only', 'both'])('%s history independently blocks and preserves every record', async (kind) => {
		const reservation = kind === 'both' ? await history() : null;
		await review(reservation?._id);
		await engagement();
		await soft();
		const before = await snapshot();
		expect((await remove()).errors![0].message).toBe(blocked);
		expect(await snapshot()).toBe(before);
	});
	it.each(['like', 'view', 'notification', 'parent'])('rolls back all work after %s failure', async (kind) => {
		await engagement();
		await soft();
		const before = await snapshot();
		if (kind === 'like') {
			const original = likes.removeProgramLikes.bind(likes) as typeof likes.removeProgramLikes;
			jest.spyOn(likes, 'removeProgramLikes').mockImplementationOnce(async (...args) => {
				await original(...args);
				throw new Error('injected failure');
			});
		}
		if (kind === 'view') {
			const original = views.removeProgramViews.bind(views) as typeof views.removeProgramViews;
			jest.spyOn(views, 'removeProgramViews').mockImplementationOnce(async (...args) => {
				await original(...args);
				throw new Error('injected failure');
			});
		}
		if (kind === 'notification')
			jest
				.spyOn(connection.collection('notifications'), 'deleteMany')
				.mockRejectedValueOnce(new Error('injected failure'));
		if (kind === 'parent')
			jest.spyOn(programs.collection, 'findOneAndDelete').mockRejectedValueOnce(new Error('injected failure'));
		await expect(service.removeProgramByAdmin(program._id)).rejects.toThrow('injected failure');
		expect(await snapshot()).toBe(before);
	});
	it.each(['USER', 'TRAINER', 'guest', 'blocked ADMIN'])('rejects %s without deleting data', async (kind) => {
		await soft();
		const before = await snapshot();
		if (kind === 'blocked ADMIN') await members.updateOne({ _id: admin._id }, { memberStatus: MemberStatus.BLOCK });
		const viewer = kind === 'USER' ? user : kind === 'TRAINER' ? trainer : kind === 'guest' ? null : admin;
		expect((await remove(viewer)).errors?.length).toBeGreaterThan(0);
		expect(await snapshot()).toBe(before);
	});
	it.each(['invalid', 'missing'])('preserves %s identifier behavior', async (kind) => {
		const before = await snapshot();
		const result = await remove(admin, kind === 'invalid' ? '../bad' : String(new Types.ObjectId()));
		expect(result.errors![0].message).toBe(
			kind === 'invalid' ? 'Invalid identifier' : 'Soft-deleted program not found',
		);
		expect(await snapshot()).toBe(before);
	});
	it('repeated views and Like/Unlike remain idempotent/counter-correct', async () => {
		await Promise.all(Array.from({ length: 4 }, () => service.getProgram(user._id, program._id)));
		expect((await programs.findById(program._id))!.programViews).toBe(1);
		expect(await connection.collection('views').countDocuments()).toBe(1);
		expect((await service.likeTargetProgram(user._id, program._id)).programLikes).toBe(1);
		expect((await service.likeTargetProgram(user._id, program._id)).programLikes).toBe(0);
		expect(await connection.collection('likes').countDocuments()).toBe(0);
	});
	it.each(['like', 'view'])(
		'%s wins: soft-delete conflicts, explicit transition then hard-delete cleans the committed engagement',
		async (kind) => {
			const entered = barrier(),
				resume = barrier(),
				softEntered = barrier();
			if (kind === 'like') {
				const original = likes.toggleLike.bind(likes) as typeof likes.toggleLike;
				jest.spyOn(likes, 'toggleLike').mockImplementationOnce(async (...args) => {
					entered.release();
					await resume.promise;
					return original(...args);
				});
			} else {
				const original = views.recordView.bind(views) as typeof views.recordView;
				jest.spyOn(views, 'recordView').mockImplementationOnce(async (...args) => {
					entered.release();
					await resume.promise;
					return original(...args);
				});
			}
			const original = programs.collection.findOneAndUpdate.bind(
				programs.collection,
			) as typeof programs.collection.findOneAndUpdate;
			jest
				.spyOn(programs.collection, 'findOneAndUpdate')
				.mockImplementation(async (...args: Parameters<typeof original>) => {
					if ((args[1].$set as { programStatus?: ProgramStatus } | undefined)?.programStatus === ProgramStatus.DELETE)
						softEntered.release();
					return original(...args);
				});
			const pending =
				kind === 'like' ? service.likeTargetProgram(user._id, program._id) : service.getProgram(user._id, program._id);
			await entered.promise;
			const transition = soft().then(
				() => null,
				(error) => error as Error,
			);
			await softEntered.promise;
			resume.release();
			await pending;
			expect((await transition)?.message).toContain('Program changed');
			await soft();
			await service.removeProgramByAdmin(program._id);
			await absent();
		},
	);
	it.each(['like', 'view'])('delete wins: an earlier %s request cannot insert after hard deletion', async (kind) => {
		const entered = barrier(),
			resume = barrier();
		const original = programs.collection.findOneAndUpdate.bind(
			programs.collection,
		) as typeof programs.collection.findOneAndUpdate;
		let held = false;
		jest
			.spyOn(programs.collection, 'findOneAndUpdate')
			.mockImplementation(async (...args: Parameters<typeof original>) => {
				if (!held && args[0].programStatus === ProgramStatus.ACTIVE && !args[1].$set) {
					held = true;
					entered.release();
					await resume.promise;
				}
				return original(...args);
			});
		const pending = (
			kind === 'like' ? service.likeTargetProgram(user._id, program._id) : service.getProgram(user._id, program._id)
		).then(
			() => null,
			(error) => error as Error,
		);
		await entered.promise;
		try {
			await soft();
			await service.removeProgramByAdmin(program._id);
		} finally {
			resume.release();
		}
		expect((await pending)?.message).toContain('Program not found');
		await absent();
	});
	it.each(['review-first', 'delete-first'])(
		'%s cannot remove completed history during review creation',
		async (order) => {
			const reservation = await history();
			await soft();
			const beforeVersion = (await programs.findById(program._id))!.__v;
			const entered = barrier(),
				resume = barrier(),
				competing = barrier();
			if (order === 'review-first') {
				const original = reviews.collection.insertOne.bind(reviews.collection) as typeof reviews.collection.insertOne;
				jest
					.spyOn(reviews.collection, 'insertOne')
					.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
						entered.release();
						await resume.promise;
						return original(...args);
					});
			} else {
				const original = reservations.collection.findOne.bind(
					reservations.collection,
				) as typeof reservations.collection.findOne;
				jest
					.spyOn(reservations.collection, 'findOne')
					.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
						const value = await original(...args);
						entered.release();
						await resume.promise;
						return value;
					});
			}
			const originalFence = programs.collection.findOneAndUpdate.bind(
				programs.collection,
			) as typeof programs.collection.findOneAndUpdate;
			jest
				.spyOn(programs.collection, 'findOneAndUpdate')
				.mockImplementation((...args: Parameters<typeof originalFence>) => {
					if (order === 'review-first' ? args[0].programStatus === ProgramStatus.DELETE : Boolean(args[0].memberId))
						competing.release();
					return originalFence(...args);
				});
			const create = () =>
				reviewing.createReview(user._id, {
					reservationId: String(reservation._id),
					rating: 5,
					content: 'Helpful session',
				});
			const deleting = () =>
				service.removeProgramByAdmin(program._id).then(
					() => null,
					(error) => error as Error,
				);
			const first = order === 'review-first' ? create() : deleting();
			await entered.promise;
			const second = order === 'review-first' ? deleting() : create();
			await competing.promise;
			resume.release();
			const results = await Promise.all([first, second]);
			expect(results[order === 'review-first' ? 1 : 0]).toBeInstanceOf(Error);
			expect((await programs.findById(program._id))!.__v).toBe(beforeVersion + 1);
			expect(await reservations.countDocuments()).toBe(1);
			expect(await reviews.countDocuments()).toBe(1);
		},
	);
	it.each(['booking-first', 'delete-first'])('%s preserves the booking/DELETE lifecycle boundary', async (order) => {
		const date = getSeoulDateTime(new Date(Date.now() + 2 * 86400000)).reservationDate;
		await connection.model('TrainerSchedule').create({
			memberId: trainer._id,
			dayOfWeek: getAvailabilityWeekday(date),
			isAvailable: true,
			startTime: '09:00',
			endTime: '18:00',
		});
		const entered = barrier(),
			resume = barrier(),
			softEntered = barrier();
		if (order === 'booking-first') {
			const original = reservations.collection.insertOne.bind(
				reservations.collection,
			) as typeof reservations.collection.insertOne;
			jest
				.spyOn(reservations.collection, 'insertOne')
				.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
					entered.release();
					await resume.promise;
					return original(...args);
				});
			const fence = programs.collection.findOneAndUpdate.bind(
				programs.collection,
			) as typeof programs.collection.findOneAndUpdate;
			jest.spyOn(programs.collection, 'findOneAndUpdate').mockImplementation((...args: Parameters<typeof fence>) => {
				if ((args[1].$set as { programStatus?: ProgramStatus } | undefined)?.programStatus === ProgramStatus.DELETE)
					softEntered.release();
				return fence(...args);
			});
		} else {
			const original = programs.collection.findOne.bind(programs.collection) as typeof programs.collection.findOne;
			jest
				.spyOn(programs.collection, 'findOne')
				.mockImplementationOnce(async (...args: Parameters<typeof original>) => {
					const value = await original(...args);
					entered.release();
					await resume.promise;
					return value;
				});
		}
		const pending = booking
			.createReservation(user._id, { programId: String(program._id), reservationDate: date, startTime: '09:00' })
			.then(
				(value) => value,
				(error) => error as Error,
			);
		await entered.promise;
		if (order === 'booking-first') {
			const transition = soft().then(
				() => null,
				(error) => error as Error,
			);
			await softEntered.promise;
			resume.release();
			expect(await pending).not.toBeInstanceOf(Error);
			expect((await transition)?.message).toContain('Program changed');
			await soft();
			await expect(service.removeProgramByAdmin(program._id)).rejects.toThrow(blocked);
			expect(await programs.exists({ _id: program._id })).not.toBeNull();
			expect(await reservations.countDocuments()).toBe(1);
		} else {
			try {
				await soft();
				await service.removeProgramByAdmin(program._id);
			} finally {
				resume.release();
			}
			expect(await pending).toBeInstanceOf(Error);
			await absent();
		}
	});
});
