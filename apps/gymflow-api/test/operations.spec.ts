import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Server } from 'node:http';
import request from 'supertest';
import { OperationsController } from '../src/operations.controller';
import { OperationsService } from '../src/operations.service';

describe('minimal operational endpoints', () => {
	let app: INestApplication, operations: OperationsService, owned: string;
	const command = jest.fn<Promise<object>, [object, object]>();
	const connection = { readyState: 1, db: { command } };
	beforeEach(async () => {
		owned = await mkdtemp(path.join(tmpdir(), 'gymflow-operations-test-'));
		command.mockReset().mockResolvedValue({ ok: 1 });
		connection.readyState = 1;
		const module = await Test.createTestingModule({
			controllers: [OperationsController],
			providers: [OperationsService, { provide: getConnectionToken(), useValue: connection }],
		}).compile();
		app = module.createNestApplication({ logger: false });
		operations = app.get(OperationsService);
	});
	afterEach(async () => {
		await app?.close();
		if (path.dirname(owned) !== tmpdir()) throw new Error('Invalid owned cleanup path');
		await rm(owned, { recursive: true, force: true });
	});
	async function start() {
		await operations.prepareStorage(path.join(owned, 'uploads'));
		await app.init();
	}
	it('does not advertise readiness before storage and initialization', async () => {
		expect(await operations.isReady()).toBe(false);
		await operations.prepareStorage(path.join(owned, 'uploads'));
		expect(await operations.isReady()).toBe(false);
		expect(command).not.toHaveBeenCalled();
	});
	it('rejects initialization if bootstrap forgot its required storage gate', async () => {
		await expect(app.init()).rejects.toThrow('Upload storage readiness must complete');
		expect(await operations.isReady()).toBe(false);
	});
	it('exposes unauthenticated health and readiness with small exact responses', async () => {
		await start();
		await request(app.getHttpServer() as Server)
			.get('/health')
			.expect(200, { status: 'ok' });
		await request(app.getHttpServer() as Server)
			.get('/ready')
			.expect(200, { status: 'ready' });
		expect(command).toHaveBeenCalledWith({ ping: 1 }, { timeoutMS: 2000 });
	});
	it('keeps health alive while disconnected Mongo makes readiness fail', async () => {
		await start();
		connection.readyState = 0;
		await request(app.getHttpServer() as Server)
			.get('/health')
			.expect(200, { status: 'ok' });
		await request(app.getHttpServer() as Server)
			.get('/ready')
			.expect(503, { status: 'not_ready' });
		expect(command).not.toHaveBeenCalled();
	});
	it('sanitizes ping failures without leaking the driver error', async () => {
		await start();
		command.mockRejectedValue(new Error('mongodb://secret@private/path'));
		await request(app.getHttpServer() as Server)
			.get('/ready')
			.expect(503, { status: 'not_ready' });
	});
	it('leaves readiness false after failed storage verification', async () => {
		await writeFile(path.join(owned, 'invalid'), 'owned file');
		await expect(operations.prepareStorage(path.join(owned, 'invalid'))).rejects.toThrow(
			'Upload storage readiness failed',
		);
		expect(await operations.isReady()).toBe(false);
	});
	it('clears readiness on shutdown', async () => {
		await start();
		operations.beforeApplicationShutdown();
		expect(await operations.isReady()).toBe(false);
	});
});
