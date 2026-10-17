import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import request from 'supertest';
import { graphqlUploadExpress } from 'graphql-upload';
import { ComponentsModule } from '../src/components/components.module';
import { uploadedImageHeaders } from '../src/libs/upload';
import { IMAGE_UPLOAD_MAX_BYTES, PROGRAM_MAX_IMAGES } from '../src/libs/config';
import { Member } from '../src/libs/dto/member/member';
import { Reservation } from '../src/libs/dto/reservation/reservation';
import { GraphQLAuthContext } from '../src/libs/types/auth-context';
interface ImageProgram {
	_id: string;
	programImages: string[];
}
interface ImageResponse {
	data: {
		createProgram: ImageProgram;
		updateProgram: ImageProgram;
		getTrainerPrograms: { list: ImageProgram[] };
		imagesUploader: string[];
	};
	errors?: { message: string }[];
}

describe('Authenticated multipart and Program image round trips (disposable database)', () => {
	let app: INestApplication,
		mongo: MongoMemoryServer,
		connection: Connection,
		trainer: Member,
		user: Member,
		admin: Member;
	let directory: string, png: Buffer;
	const cwd = process.cwd(),
		binaries = path.resolve('.tmp/mongodb-binaries');
	beforeAll(async () => {
		directory = await mkdtemp(path.join(tmpdir(), 'gymflow-upload-integration-'));
		process.chdir(directory);
		mongo = await MongoMemoryServer.create({
			instance: { ip: '127.0.0.1', dbName: 'image_upload_test' },
			binary: { version: '8.2.6', downloadDir: binaries },
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
		app.use(graphqlUploadExpress({ maxFileSize: IMAGE_UPLOAD_MAX_BYTES, maxFiles: PROGRAM_MAX_IMAGES }));
		app.use('/uploads', uploadedImageHeaders, express.static('./uploads'));
		await app.init();
		connection = module.get<Connection>(getConnectionToken());
		await Promise.all(Object.values(connection.models).map((model) => model.init()));
		[trainer, user, admin] = await connection.model<Member>('Member').create(
			['TRAINER', 'USER', 'ADMIN'].map((memberType, index) => ({
				memberType,
				memberNick: 'upload-' + index,
				memberPhone: 'upload-' + index,
				memberPassword: 'fixture-only',
			})),
		);
		png = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
			.png()
			.toBuffer();
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		process.chdir(cwd);
		if (directory && path.dirname(directory) === tmpdir()) await rm(directory, { recursive: true, force: true });
	});
	async function gql(query: string, variables: Record<string, unknown>, member = trainer) {
		const response = await request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true')
			.set('Authorization', 'Bearer ' + (await fixtureAccessToken(member, app)))
			.send({ query, variables });
		return response.body as ImageResponse;
	}
	async function upload(count: number, member: Member | null = trainer, target = 'program', bytes = png) {
		const query = 'mutation($files:[Upload!]!,$target:String!){imagesUploader(files:$files,target:$target)}';
		let req = request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true');
		if (member) req = req.set('Authorization', 'Bearer ' + (await fixtureAccessToken(member, app)));
		req = req
			.field('operations', JSON.stringify({ query, variables: { files: Array(count).fill(null), target } }))
			.field(
				'map',
				JSON.stringify(
					Object.fromEntries(Array.from({ length: count }, (_, index) => [index, ['variables.files.' + index]])),
				),
			);
		for (let index = 0; index < count; index++)
			req = req.attach(String(index), bytes, { filename: 'photo-' + index + '.png', contentType: 'image/png' });
		return (await req) as Omit<request.Response, 'body'> & { body: ImageResponse };
	}
	const create = 'mutation($input:ProgramInput!){createProgram(input:$input){_id programImages}}';
	const update = 'mutation($input:ProgramUpdate!){updateProgram(input:$input){_id programImages}}';
	const read =
		'query($input:TrainerProgramsInquiry!){getTrainerPrograms(input:$input){list{_id programImages} metaCounter{total}}}';
	const input = (programImages: string[]) => ({
		programName: 'Image round trip',
		programType: 'PT_1ON1',
		programCategory: 'MUSCLE_GAIN',
		programLocation: 'SEOUL',
		programAddress: 'Disposable Seoul studio',
		programPrice: 0,
		programDuration: 60,
		programCapacity: 1,
		programImages,
	});
	async function owned(id: string) {
		const body = await gql(read, { input: { page: 1, limit: 100, sort: 'createdAt', direction: 'DESC', search: {} } });
		expect(body.errors).toBeUndefined();
		return body.data.getTrainerPrograms.list.find((item: { _id: string }) => item._id === id);
	}
	it.each([2, 5])('uploads %i real files, creates once and reopens the ordered array', async (count) => {
		const response = await upload(count);
		expect(response.body.errors).toBeUndefined();
		const images = response.body.data.imagesUploader;
		expect(images).toHaveLength(count);
		const saved = await gql(create, { input: input(images) });
		expect(saved.errors).toBeUndefined();
		expect((await owned(saved.data.createProgram._id)).programImages).toEqual(images);
	});
	it('removes only persisted #4, saves/reopens, then appends one image without changing the retained four paths or files', async () => {
		const five = (await upload(5)).body.data.imagesUploader;
		const saved = await gql(create, { input: input(five) }),
			id = saved.data.createProgram._id;
		const original = await Promise.all(five.map((image) => readFile(image)));
		const retained = [five[0], five[1], five[2], five[4]];
		expect((await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: retained } })).errors).toBeUndefined();
		expect((await owned(id)).programImages).toEqual(retained);
		const replacement = (await upload(1)).body.data.imagesUploader[0];
		expect(
			(await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: [...retained, replacement] } })).errors,
		).toBeUndefined();
		expect((await owned(id)).programImages).toEqual([...retained, replacement]);
		for (let index = 0; index < five.length; index++) expect(await readFile(five[index])).toEqual(original[index]);
		expect(
			(await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: [retained[1], retained[2], retained[3], replacement] } }))
				.errors,
		).toBeUndefined();
		expect((await owned(id)).programImages[0]).toBe(five[1]);
	});
	it('rejects zero/six images on create and update, preserving the previous array', async () => {
		const images = (await upload(1)).body.data.imagesUploader;
		const saved = await gql(create, { input: input(images) }),
			id = saved.data.createProgram._id;
		for (const invalid of [[], Array.from({ length: 6 }, () => images[0]), [' ']]) {
			expect((await gql(create, { input: input(invalid) })).errors).toBeDefined();
			expect((await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: invalid } })).errors).toBeDefined();
			expect((await owned(id)).programImages).toEqual(images);
		}
	});
	it('enforces auth, role and target permissions and permits legitimate profile/article/admin uploads', async () => {
		for (const response of [await upload(1, null), await upload(1, user), await upload(1, trainer, '../program')])
			expect(response.body.errors).toBeDefined();
		for (const [member, target] of [
			[user, 'member'],
			[user, 'article'],
			[admin, 'program'],
		] as [Member, string][])
			expect((await upload(1, member, target)).body.errors).toBeUndefined();
	});
	it('rejects transport oversize/count and non-image bytes', async () => {
		for (const response of [
			await upload(6),
			await upload(1, trainer, 'program', Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1)),
			await upload(1, trainer, 'program', Buffer.from('<html>not an image</html>')),
		])
			expect(response.status === 413 || Boolean(response.body.errors)).toBe(true);
	});
	it('serves old legitimate JPEG/PNG paths with nosniff and blocks active-content and temporary paths', async () => {
		await mkdir('uploads/program', { recursive: true });
		await writeFile('uploads/program/legacy.jpeg', await sharp(png).jpeg().toBuffer());
		await writeFile('uploads/program/legacy.png', png);
		await writeFile('uploads/program/payload.html', '<script>alert(1)</script>');
		for (const name of ['legacy.jpeg', 'legacy.png']) {
			const response = await request(app.getHttpServer() as Server)
				.get('/uploads/program/' + name)
				.expect(200);
			expect(response.headers['x-content-type-options']).toBe('nosniff');
			expect(response.headers['content-type']).toContain('image/');
		}
		for (const name of ['program/payload.html', '.tmp/file.png', 'program/../../package.json'])
			await request(app.getHttpServer() as Server)
				.get('/uploads/' + name)
				.expect(404);
	});
	it('image updates cannot bypass ownership or Phase 15C sensitive-field protection', async () => {
		const images = (await upload(2)).body.data.imagesUploader;
		const saved = await gql(create, { input: input(images) }),
			id = saved.data.createProgram._id;
		await connection.model<Reservation>('Reservation').create({
			memberId: user._id,
			trainerId: trainer._id,
			programId: id,
			reservationDate: '2099-01-08',
			startTime: '09:00',
			endTime: '10:00',
			reservationStatus: 'PENDING',
		});
		expect(
			(await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: [images[0]], programDuration: 90 } })).errors,
		).toBeDefined();
		expect((await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: [images[0]] } }, user)).errors).toBeDefined();
		expect((await owned(id)).programImages).toEqual(images);
		expect((await gql(update, { input: { expectedRevision: (await connection.model('Program').findById(id).lean().exec())?.programRevision ?? 0, _id: id, programImages: [images[0]] } })).errors).toBeUndefined();
	});
});
