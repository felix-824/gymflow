import { fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { getConnectionToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, createConnection, mongo, Types } from 'mongoose';
import { Server } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { graphqlUploadExpress } from 'graphql-upload';
import { ComponentsModule } from '../src/components/components.module';
import { MemberService } from '../src/components/member/member.service';
import { ProgramService } from '../src/components/program/program.service';
import { DatabaseModule } from '../src/database/database.module';
import { graphqlOptions } from '../src/libs/graphql.config';
import { uploadedImageHeaders } from '../src/libs/upload';
import { uploadRoot } from '../src/libs/upload-storage';
import { IMAGE_UPLOAD_MAX_BYTES, PROGRAM_MAX_IMAGES } from '../src/libs/config';
import { Member } from '../src/libs/dto/member/member';
import { OperationsController } from '../src/operations.controller';
import { OperationsService } from '../src/operations.service';
import { AppResolver } from '../src/app.resolver';

interface GqlResponse {
	data?: Record<string, unknown>;
	errors?: { message: string; code: string; extensions: { code: string; reason?: string } }[];
}
const keys = ['NODE_ENV', 'MONGO_PROD', 'MONGO_DEV', 'UPLOAD_ROOT', 'AUTH_ALLOWED_ORIGINS'] as const;
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

// Real production database gate, existing ComponentsModule, formatter, upload boundary and operational endpoints.
// All data/storage is disposable and owned; never import AppModule or load application .env.
describe('production API storage, exposure and lifecycle (owned replica set)', () => {
	let app: INestApplication, mongoServer: MongoMemoryReplSet, connection: Connection, raw: Connection;
	let owned: string, root: string, png: Buffer, trainer: Member;
	beforeAll(async () => {
		owned = await mkdtemp(path.join(tmpdir(), 'gymflow-production-hardening-'));
		root = path.join(owned, 'mounted-volume');
		mongoServer = await MongoMemoryReplSet.create({
			binary: { version: '8.2.6', downloadDir: path.resolve('.tmp/mongodb-binaries') },
			replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
		});
		process.env.NODE_ENV = 'production';
		process.env.MONGO_PROD = mongoServer.getUri('gymflow_hardening_owned');
		process.env.MONGO_DEV = 'mongodb://127.0.0.1:1/never_selected';
		process.env.UPLOAD_ROOT = root;
		process.env.AUTH_ALLOWED_ORIGINS = 'https://fixture.example';
		raw = await createConnection(process.env.MONGO_PROD, { autoIndex: false, autoCreate: false }).asPromise();
		const legacy = { _id: new Types.ObjectId(), __v: 12, updatedAt: new Date('2025-01-01'), name: 'owned legacy' };
		await raw.db!.collection('programs').insertOne(legacy);
		const backfill = jest.spyOn(ProgramService.prototype, 'onModuleInit');
		const module = await Test.createTestingModule({
			imports: [
				DatabaseModule,
				ComponentsModule,
				GraphQLModule.forRootAsync({ driver: ApolloDriver, useFactory: () => graphqlOptions() }),
			],
			controllers: [OperationsController],
			providers: [OperationsService],
		}).compile();
		app = module.createNestApplication({ logger: false });
		connection = module.get<Connection>(getConnectionToken());
		expect(connection.readyState).toBe(1);
		expect(backfill).not.toHaveBeenCalled();
		const operations = app.get(OperationsService);
		expect(await operations.isReady()).toBe(false);
		expect(await raw.db!.collection('programs').findOne({ _id: legacy._id })).toEqual(legacy);
		await operations.prepareStorage(uploadRoot());
		expect(backfill).not.toHaveBeenCalled();
		expect(await operations.isReady()).toBe(false);
		app.useGlobalPipes(new ValidationPipe());
		app.use(graphqlUploadExpress({ maxFileSize: IMAGE_UPLOAD_MAX_BYTES, maxFiles: PROGRAM_MAX_IMAGES }));
		app.use('/uploads', uploadedImageHeaders, express.static(uploadRoot()));
		await app.init();
		expect(backfill).toHaveBeenCalledTimes(1);
		expect(await raw.db!.collection('programs').findOne({ _id: legacy._id })).toEqual({
			...legacy,
			programRevision: 0,
		});
		await raw.close();
		backfill.mockRestore();
		trainer = await connection.model<Member>('Member').create({
			memberNick: 'ownedtrainer',
			memberPhone: 'owned-phone',
			memberPassword: 'not-a-valid-password-hash',
			memberType: 'TRAINER',
		});
		png = await sharp({ create: { width: 2, height: 1, channels: 3, background: 'red' } })
			.png()
			.toBuffer();
	});
	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => {
		await raw?.close();
		await app?.close();
		await mongoServer?.stop();
		for (const key of keys) {
			if (previous[key] === undefined) delete process.env[key];
			else process.env[key] = previous[key];
		}
		if (owned && path.dirname(owned) === tmpdir()) await rm(owned, { recursive: true, force: true });
	});
	async function gql(query: string, variables: Record<string, unknown> = {}) {
		return (
			await request(app.getHttpServer() as Server)
				.post('/graphql')
				.set('Origin', 'https://fixture.example')
				.set('Apollo-Require-Preflight', 'true')
				.send({ query, variables })
		).body as GqlResponse;
	}
	it('advertises readiness only after Mongo/storage gates and preserved backfill have completed', async () => {
		await request(app.getHttpServer() as Server)
			.get('/health')
			.expect(200, { status: 'ok' });
		await request(app.getHttpServer() as Server)
			.get('/ready')
			.expect(200, { status: 'ready' });
		expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
		expect((await readdir(root)).some((name) => name.startsWith('.readiness-'))).toBe(false);
	});
	it('disables production Playground and introspection but permits ordinary Apollo __typename', async () => {
		const html = await request(app.getHttpServer() as Server)
			.get('/graphql')
			.set('Accept', 'text/html');
		expect(html.text).not.toMatch(/GraphQL Playground|graphql-playground|Apollo Sandbox/);
		const introspection = await gql('{ __schema { queryType { name } } }');
		expect(introspection.errors?.[0]).toEqual({
			code: 'GRAPHQL_VALIDATION_FAILED',
			message: 'Invalid GraphQL operation',
			extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
		});
		expect(await gql('{ __typename }')).toEqual({ data: { __typename: 'Query' } });
	});
	it('keeps actual auth and legacy credential failure messages useful', async () => {
		const auth = await gql('{ getMyMember { _id } }');
		expect(auth.errors?.[0]).toEqual({
			code: 'UNAUTHENTICATED',
			message: 'Authentication required',
			extensions: { code: 'UNAUTHENTICATED' },
		});
		const login = await gql('mutation($input:LoginInput!){ login(input:$input){ _id } }', {
			input: { memberNick: 'ownedtrainer', memberPassword: 'wrongpass' },
		});
		expect(login.errors?.[0]?.message).toBe('Wrong password, try again!');
		expect(JSON.stringify(login)).not.toMatch(/stacktrace|originalError|private-password/);
	});
	it('keeps real DTO validation useful without forwarding raw exception objects', async () => {
		const invalid = await gql('mutation($input:LoginInput!){ login(input:$input){ _id } }', {
			input: { memberNick: '', memberPassword: '' },
		});
		expect(invalid.errors?.[0]?.code).toBe('BAD_REQUEST');
		expect(invalid.errors?.[0]?.message).toMatch(/memberNick|memberPassword/);
		expect(typeof invalid.errors?.[0]?.message).toBe('string');
		expect(Object.keys(invalid.errors![0].extensions)).toEqual(['code']);
	});
	it('masks a real driver error through the existing resolver and Nest Apollo driver', async () => {
		jest.spyOn(MemberService.prototype, 'getPublicMember').mockRejectedValueOnce(
			new mongo.MongoServerError({
				code: 11000,
				message: 'mongodb://private-user:private-password@host/private-db C:/private/uploads token=secret',
			}),
		);
		const response = await gql('query($id:String!){getMember(memberId:$id){_id}}', {
			id: new Types.ObjectId().toHexString(),
		});
		expect(response.errors?.[0]).toEqual({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Internal server error',
			extensions: { code: 'INTERNAL_SERVER_ERROR' },
		});
	});
	it('writes and serves actual multipart images from the override with unchanged URLs', async () => {
		const response = await request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true')
			.set('Authorization', 'Bearer ' + (await fixtureAccessToken(trainer, app)))
			.field(
				'operations',
				JSON.stringify({
					query: 'mutation($files:[Upload!]!){imagesUploader(files:$files,target:"program")}',
					variables: { files: [null] },
				}),
			)
			.field('map', JSON.stringify({ 0: ['variables.files.0'] }))
			.attach('0', png, { filename: 'owned.png', contentType: 'image/png' });
		const body = response.body as { data: { imagesUploader: string[] }; errors?: unknown };
		expect(body.errors).toBeUndefined();
		const [url] = body.data.imagesUploader;
		expect(url).toMatch(/^uploads\/program\/[a-f0-9-]+\.png$/);
		const bytes = await readFile(path.join(root, 'program', path.basename(url)));
		const served = await request(app.getHttpServer() as Server)
			.get('/' + url)
			.expect(200);
		expect(served.body).toEqual(bytes);
		expect(served.headers['x-content-type-options']).toBe('nosniff');
		expect(await readdir(path.join(root, '.tmp'))).toEqual([]);
		for (const route of ['/uploads/.tmp/probe.png', '/uploads/program/../.tmp/probe.png'])
			await request(app.getHttpServer() as Server)
				.get(route)
				.expect(404);
	});
	it('rejects concrete upload storage failure without advertising readiness or initializing another backfill', async () => {
		const invalid = path.join(owned, 'invalid');
		await mkdir(invalid);
		await writeFile(path.join(invalid, 'article'), 'owned retained file');
		const operations = new OperationsService(connection);
		await expect(operations.prepareStorage(invalid)).rejects.toThrow('Upload storage readiness failed');
		expect(await operations.isReady()).toBe(false);
		expect(await readFile(path.join(invalid, 'article'), 'utf8')).toBe('owned retained file');
	});
	it('preserves the existing program revision conflict reason through the actual Apollo driver', async () => {
		jest.spyOn(ProgramService.prototype, 'updateProgram').mockRejectedValueOnce(
			new ConflictException({
				message: 'Program changed; reload before retrying',
				reason: 'PROGRAM_REVISION_CONFLICT',
			}),
		);
		const response = await request(app.getHttpServer() as Server)
			.post('/graphql')
			.set('Authorization', 'Bearer ' + (await fixtureAccessToken(trainer, app)))
			.send({
				query: 'mutation($input:ProgramUpdate!){updateProgram(input:$input){_id}}',
				variables: {
					input: { _id: new Types.ObjectId().toHexString(), expectedRevision: 0, programName: 'Owned rename' },
				},
			});
		const body = response.body as GqlResponse;
		expect(body.errors?.[0]).toEqual({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Program changed; reload before retrying',
			extensions: { code: 'INTERNAL_SERVER_ERROR', reason: 'PROGRAM_REVISION_CONFLICT' },
		});
	});
	it('keeps actual development Playground, introspection and ordinary operations available', async () => {
		const module = await Test.createTestingModule({
			imports: [GraphQLModule.forRoot(graphqlOptions(false))],
			providers: [AppResolver],
		}).compile();
		const development = module.createNestApplication({ logger: false });
		try {
			await development.init();
			const html = await request(development.getHttpServer() as Server)
				.get('/graphql')
				.set('Accept', 'text/html')
				.expect(200);
			expect(html.text).toContain('GraphQL Playground');
			const schema = await request(development.getHttpServer() as Server)
				.post('/graphql')
				.send({ query: '{ __schema { queryType { name } } sayHello }' });
			const body = schema.body as GqlResponse;
			expect(body.errors).toBeUndefined();
			expect(body.data?.sayHello).toBe('GraphQl API Server');
		} finally {
			await development.close();
		}
	});
	it('returns readiness 503 after actual Mongo disconnection while health remains 200', async () => {
		await connection.close();
		await request(app.getHttpServer() as Server)
			.get('/ready')
			.expect(503, { status: 'not_ready' });
		await request(app.getHttpServer() as Server)
			.get('/health')
			.expect(200, { status: 'ok' });
	});
});
