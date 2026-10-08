import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BatchController } from '../src/batch.controller';
import { BatchService } from '../src/batch.service';

// No DatabaseModule or ScheduleModule: smoke tests cannot start production jobs.
describe('GymFlow batch greeting (isolated)', () => {
	let app: INestApplication;
	beforeAll(async () => {
		const module = await Test.createTestingModule({
			controllers: [BatchController],
			providers: [{ provide: BatchService, useValue: { getHello: () => 'Welcome to GymFlow BATCH Server!' } }],
		}).compile();
		app = module.createNestApplication();
		await app.init();
	});
	afterAll(async () => {
		await app.close();
	});
	it('GET /', () => request(app.getHttpServer()).get('/').expect(200).expect('Welcome to GymFlow BATCH Server!'));
});
