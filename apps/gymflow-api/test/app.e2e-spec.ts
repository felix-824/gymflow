import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';

// Controller smoke test deliberately excludes DatabaseModule and external services.
describe('GymFlow API greeting (isolated)', () => {
	let app: INestApplication;
	beforeAll(async () => {
		const module = await Test.createTestingModule({ controllers: [AppController], providers: [AppService] }).compile();
		app = module.createNestApplication();
		await app.init();
	});
	afterAll(async () => {
		await app.close();
	});
	it('GET /', () => request(app.getHttpServer()).get('/').expect(200).expect('Welcome to GymFlow API Server!'));
});
