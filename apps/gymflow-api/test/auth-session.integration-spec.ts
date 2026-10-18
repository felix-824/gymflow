import { authTestConfig, authTestSecrets, fixtureAccessToken } from './auth-session.fixture';
import 'reflect-metadata';
import { INestApplication, Logger, Module, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { DatabaseModule } from '../src/database/database.module';
import { JwtService } from '@nestjs/jwt';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { firstValueFrom, of } from 'rxjs';
import request from 'supertest';

import { AuthModule } from '../src/components/auth/auth.module';
import { AuthService } from '../src/components/auth/auth.service';
import { MemberService } from '../src/components/member/member.service';
import { Member } from '../src/libs/dto/member/member';
import { MemberStatus, MemberType } from '../src/libs/enums/member.enum';
import {
	ACCESS_TOKEN_SECONDS,
	AUTH_SESSION_SECONDS,
	AUTH_AUDIENCE,
	AUTH_ISSUER,
	authConfiguration,
} from '../src/libs/auth.config';
import { LoggingInterceptor } from '../src/libs/interceptor/Logging.interceptor';
import { OperationsService } from '../src/operations.service';

import { dependency } from './helpers';

interface AuthResult {
	data?: {
		login?: { accessToken: string };
		signup?: { accessToken: string };
		getMyMember?: { memberType: MemberType; memberPhone: string };
		refreshSession?: { accessToken: string };
		logoutSession?: boolean;
	};
	errors?: { code?: string; extensions?: { code?: string } }[];
}
interface IssuedClaims {
	sub: string;
	sid: string;
	purpose: string;
	exp: number;
	iat: number;
}

describe('Production auth sessions against disposable MongoDB', () => {
	let mongo: MongoMemoryServer;
	let app: INestApplication;
	let db: Connection;
	let auth: AuthService;
	let service: MemberService;
	let user: Member;
	let trainer: Member;
	let admin: Member;
	let uploadStorage: string;
	const password = randomBytes(9).toString('base64url');
	beforeAll(async () => {
		uploadStorage = await mkdtemp(join(tmpdir(), 'gymflow-auth-storage-'));
		mongo = await MongoMemoryServer.create({
			instance: { ip: '127.0.0.1', dbName: 'auth_sessions_disposable' },
			binary: { version: '8.2.6', downloadDir: resolve('.tmp/mongodb-binaries') },
		});
		@Module({ imports: [MongooseModule.forRoot(mongo.getUri())], exports: [MongooseModule] })
		class DisposableDatabaseModule {}
		// Exercise the actual HTTP/GraphQL wiring without loading application environment files or connecting to its database.
		const configure = ConfigModule.forRoot.bind(ConfigModule) as typeof ConfigModule.forRoot;
		const configuration = jest
			.spyOn(ConfigModule, 'forRoot')
			.mockImplementation((options) => configure({ ...options, ignoreEnvFile: true }));
		let rootModule: typeof import('../src/app.module').AppModule;
		try {
			rootModule = jest.requireActual<typeof import('../src/app.module')>('../src/app.module').AppModule;
		} finally {
			configuration.mockRestore();
		}
		const module = await Test.createTestingModule({ imports: [rootModule] })
			.overrideModule(DatabaseModule)
			.useModule(DisposableDatabaseModule)
			.compile();
		app = module.createNestApplication({ logger: false });
		app.useGlobalPipes(new ValidationPipe());
		await app.get(OperationsService).prepareStorage(uploadStorage);
		await app.init();
		db = module.get<Connection>(getConnectionToken());
		await Promise.all(Object.values(db.models).map((model) => model.init()));
		auth = module.get(AuthService);
		service = module.get(MemberService);
	});
	afterAll(async () => {
		await app?.close();
		await mongo?.stop();
		if (uploadStorage && dirname(uploadStorage) === tmpdir()) await rm(uploadStorage, { recursive: true, force: true });
	});
	beforeEach(async () => {
		await Promise.all(Object.values(db.models).map((model) => model.deleteMany({}).exec()));
		const memberPassword = await auth.hashPassword(password);
		[user, trainer, admin] = await db.model<Member>('Member').create(
			[MemberType.USER, MemberType.TRAINER, MemberType.ADMIN].map((memberType, index) => ({
				memberType,
				memberNick: 'session-' + index,
				memberPhone: 'private-' + index,
				memberPassword,
			})),
		);
	});
	afterEach(() => jest.restoreAllMocks());
	const gql = async (query: string, cookie = '', access = '') => {
		const operation = request(app.getHttpServer())
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true')
			.set('Origin', 'http://localhost:3000');
		if (cookie) operation.set('Cookie', cookie);
		if (access) operation.set('Authorization', 'Bearer ' + access);
		const response = await operation.send({ query });
		return {
			body: dependency<AuthResult>(response.body),
			headers: dependency<Record<string, string | string[]>>(response.headers),
		};
	};
	function sign(purpose: string, sid: string, secret: string, expiresIn?: number) {
		return new JwtService().sign(
			{ sub: String(user._id), sid, purpose, jti: randomUUID() },
			{
				secret,
				algorithm: 'HS256',
				issuer: AUTH_ISSUER,
				audience: AUTH_AUDIENCE,
				...(expiresIn === undefined ? {} : { expiresIn }),
			},
		);
	}
	it('registers unauthenticated operational routes through the actual AppModule', async () => {
		await request(app.getHttpServer()).get('/health').expect(200, { status: 'ok' });
		await request(app.getHttpServer()).get('/ready').expect(200, { status: 'ready' });
	});
	it('registers JWT configuration asynchronously after values become available', () => {
		const imports = Reflect.getMetadata('imports', AuthModule) as {
			module?: { name: string };
			providers?: { provide: string; useFactory?: (config: unknown) => { secret: string } }[];
		}[];
		const provider = imports
			.find((item) => item.module?.name === 'JwtModule')
			?.providers?.find((item) => item.provide === 'JWT_MODULE_OPTIONS');
		expect(typeof provider?.useFactory).toBe('function');
		const configured = provider!.useFactory!(authTestConfig());
		expect(configured.secret === authTestSecrets.SECRET_TOKEN).toBe(true);
	});
	it.each(['SECRET_TOKEN', 'SECRET_REFRESH_TOKEN'])('rejects missing/short %s without exposing values', (key) => {
		for (const value of [undefined, '', 'undefined', 'short']) {
			const settings = { ...authTestSecrets, [key]: value };
			expect(() =>
				authConfiguration(dependency({ get: (name: string) => settings[name as keyof typeof settings] })),
			).toThrow(key);
		}
	});
	it('rejects reused signing secrets and insecure/unconfigured production origins', () => {
		const base = { ...authTestSecrets, NODE_ENV: 'production' };
		for (const settings of [
			{ ...base, SECRET_REFRESH_TOKEN: base.SECRET_TOKEN },
			{ ...base, AUTH_ALLOWED_ORIGINS: '' },
			{ ...base, AUTH_ALLOWED_ORIGINS: 'http://example.com' },
			{ ...base, AUTH_ALLOWED_ORIGINS: '*' },
		])
			expect(() =>
				authConfiguration(dependency({ get: (key: string) => settings[key as keyof typeof settings] })),
			).toThrow();
	});
	it('uses HttpOnly host-only secure production cookie configuration', () => {
		const settings = { ...authTestSecrets, NODE_ENV: 'production', AUTH_ALLOWED_ORIGINS: 'https://gymflow.example' };
		const config = authConfiguration(dependency({ get: (key: string) => settings[key as keyof typeof settings] }));
		expect(config.cookieName).toBe('__Host-gymflow_refresh');
		expect(config.cookieOptions).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
	});
	it.each(['login', 'signup'] as const)(
		'establishes %s cookie and returns only access credentials in JSON',
		async (operation) => {
			const input =
				operation === 'login'
					? 'memberNick:"' + user.memberNick + '",memberPassword:"' + password + '"'
					: 'memberNick:"new-owner",memberPassword:"' + password + '",memberPhone:"new-phone"';
			const response = await gql('mutation{' + operation + '(input:{' + input + '}){_id memberPhone accessToken}}');
			expect(response.body.errors).toBeUndefined();
			const receipt = response.body.data![operation]!;
			const claims = new JwtService().decode<IssuedClaims>(receipt.accessToken);
			expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_SECONDS);
			expect(claims.purpose).toBe('access');
			const cookie = String(response.headers['set-cookie']);
			expect(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')).toBe(true);
			expect(JSON.stringify(response.body).includes('refreshToken')).toBe(false);
			expect(await db.model('AuthSession').countDocuments({})).toBe(1);
		},
	);
	it('rejects untrusted cookie-auth origins before creating an account/session', async () => {
		const result = await request(app.getHttpServer())
			.post('/graphql')
			.set('Apollo-Require-Preflight', 'true')
			.set('Origin', 'https://untrusted.example')
			.send({
				query: 'mutation{login(input:{memberNick:"' + user.memberNick + '",memberPassword:"' + password + '"}){_id}}',
			});
		expect(Boolean(dependency<AuthResult>(result.body).errors)).toBe(true);
		expect(await db.model('AuthSession').countDocuments({})).toBe(0);
	});
	it('issues exactly 15-minute access and preserves the original 30-day refresh deadline', async () => {
		const credentials = await auth.createSession(user);
		const access = new JwtService().decode<IssuedClaims>(credentials.accessToken);
		const refresh = new JwtService().decode<IssuedClaims>(credentials.refreshToken);
		expect(access.exp - access.iat).toBe(900);
		expect(refresh.exp - refresh.iat).toBe(AUTH_SESSION_SECONDS);
		expect(refresh.exp * 1000).toBe(credentials.expiresAt.getTime());
		expect(Object.keys(access).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'purpose', 'sid', 'sub']);
		const stored = await db.model('AuthSession').findById(access.sid).lean();
		expect(stored!.refreshDigest === credentials.refreshToken).toBe(false);
		expect((await auth.verifyToken(credentials.accessToken))._id.equals(user._id)).toBe(true);
	});
	it.each(['expired', 'malformed', 'wrong-purpose', 'missing-expiry', 'legacy', 'wrong-key'])(
		'rejects %s access',
		async (kind) => {
			const credentials = await auth.createSession(user);
			const claims = new JwtService().decode<IssuedClaims>(credentials.accessToken);
			const token =
				kind === 'malformed'
					? 'invalid'
					: kind === 'legacy'
						? new JwtService().sign({ sub: String(user._id) }, { secret: authTestSecrets.SECRET_TOKEN, expiresIn: 900 })
						: sign(
								kind === 'wrong-purpose' ? 'refresh' : 'access',
								claims.sid,
								kind === 'wrong-key' ? authTestSecrets.SECRET_REFRESH_TOKEN : authTestSecrets.SECRET_TOKEN,
								kind === 'expired' ? -1 : kind === 'missing-expiry' ? undefined : 900,
							);
			await expect(auth.verifyToken(token)).rejects.toThrow('active account');
		},
	);
	it.each([MemberType.USER, MemberType.TRAINER, MemberType.ADMIN])(
		'restores current %s through getMyMember',
		async (role) => {
			const member = [user, trainer, admin].find((account) => account.memberType === role)!;
			const token = await fixtureAccessToken(member, app);
			const response = await gql('{getMyMember{_id memberType memberPhone}}', '', token);
			expect(response.body.errors).toBeUndefined();
			expect(response.body.data!.getMyMember!.memberType).toBe(role);
			expect(response.body.data!.getMyMember!.memberPhone).toBe(member.memberPhone);
		},
	);
	it('uses current role and rejects blocked/deleted owners', async () => {
		const credentials = await auth.createSession(trainer);
		await service.updateMemberByAdmin({ _id: trainer._id, memberType: MemberType.USER });
		expect((await auth.verifyToken(credentials.accessToken)).memberType).toBe(MemberType.USER);
		await service.updateMemberByAdmin({ _id: trainer._id, memberStatus: MemberStatus.BLOCK });
		await expect(auth.verifyToken(credentials.accessToken)).rejects.toThrow();
		await service.updateMemberByAdmin({ _id: trainer._id, memberStatus: MemberStatus.ACTIVE });
		await expect(auth.verifyToken(credentials.accessToken)).rejects.toThrow();
	});
	it('rotates refresh atomically without sliding absolute expiry', async () => {
		const first = await auth.createSession(user);
		const next = await auth.refreshSession(first.refreshToken);
		expect(next.refreshToken !== first.refreshToken).toBe(true);
		expect(next.expiresAt.getTime()).toBe(first.expiresAt.getTime());
		expect((await auth.verifyToken(next.accessToken))._id.equals(user._id)).toBe(true);
		const stored = await db.model('AuthSession').findOne({ memberId: user._id }).lean();
		expect(stored!.rotation).toBe(1);
	});
	it('revokes the family on confirmed older-refresh reuse', async () => {
		const first = await auth.createSession(user);
		const next = await auth.refreshSession(first.refreshToken);
		await expect(auth.refreshSession(first.refreshToken)).rejects.toThrow();
		await expect(auth.refreshSession(next.refreshToken)).rejects.toThrow();
		await expect(auth.verifyToken(next.accessToken)).rejects.toThrow();
	});
	it('fails closed under concurrent use of a single refresh credential', async () => {
		const first = await auth.createSession(user);
		const results = await Promise.allSettled([
			auth.refreshSession(first.refreshToken),
			auth.refreshSession(first.refreshToken),
		]);
		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
		expect(Boolean((await db.model('AuthSession').findOne({ memberId: user._id }).lean())!.revokedAt)).toBe(true);
	});
	it.each(['expired', 'invalid', 'revoked', 'absolute-expiry'])('rejects %s refresh', async (kind) => {
		const first = await auth.createSession(user);
		const claims = new JwtService().decode<IssuedClaims>(first.refreshToken);
		if (kind === 'revoked') await auth.logoutSession(first.refreshToken);
		if (kind === 'absolute-expiry')
			await db
				.model('AuthSession')
				.updateOne({ _id: claims.sid }, { $set: { expiresAt: new Date(0) } }, { overwriteImmutable: true });
		const token =
			kind === 'invalid'
				? 'invalid'
				: kind === 'expired'
					? sign('refresh', claims.sid, authTestSecrets.SECRET_REFRESH_TOKEN, -1)
					: first.refreshToken;
		await expect(auth.refreshSession(token)).rejects.toThrow();
	});
	it('returns rotated refresh only via cookie and clears rejected refresh cookies', async () => {
		const first = await auth.createSession(user);
		const valid = await gql('mutation{refreshSession{accessToken}}', 'gymflow_refresh=' + first.refreshToken);
		expect(valid.body.errors).toBeUndefined();
		expect(Boolean(valid.headers['set-cookie'])).toBe(true);
		expect(Object.keys(valid.body.data!.refreshSession!)).toEqual(['accessToken']);
		const invalid = await gql('mutation{refreshSession{accessToken}}', 'gymflow_refresh=invalid');
		expect(Boolean(invalid.body.errors)).toBe(true);
		expect(invalid.body.errors![0].extensions!.code).toBe('UNAUTHENTICATED');
		expect(String(invalid.headers['set-cookie']).includes('Expires=Thu, 01 Jan 1970')).toBe(true);
	});
	it('treats absent refresh as unauthenticated guest through production context and formatter', async () => {
		const result = await gql('mutation{refreshSession{accessToken}}');
		expect(result.body.errors![0].code).toBe('UNAUTHENTICATED');
		expect(result.body.errors![0].extensions!.code).toBe('UNAUTHENTICATED');
		expect(String(result.headers['set-cookie']).includes('Expires=Thu, 01 Jan 1970')).toBe(true);
	});
	it('logout revokes access/refresh and clears the cookie', async () => {
		const first = await auth.createSession(user);
		const result = await gql('mutation{logoutSession}', 'gymflow_refresh=' + first.refreshToken);
		expect(result.body.data!.logoutSession).toBe(true);
		expect(String(result.headers['set-cookie']).includes('Expires=Thu, 01 Jan 1970')).toBe(true);
		await expect(auth.verifyToken(first.accessToken)).rejects.toThrow();
		await expect(auth.refreshSession(first.refreshToken)).rejects.toThrow();
	});
	it('ordinary profile saves issue no fresh access token; password changes revoke all sessions', async () => {
		const first = await auth.createSession(user);
		const second = await auth.createSession(user);
		const saved = await service.updateMember(user._id, { memberFullName: 'Updated owner' });
		expect(saved.accessToken).toBeUndefined();
		expect((await auth.verifyToken(first.accessToken)).memberFullName).toBe('Updated owner');
		await service.updateMember(user._id, { memberPassword: randomBytes(9).toString('base64url') });
		await expect(auth.verifyToken(first.accessToken)).rejects.toThrow();
		await expect(auth.refreshSession(second.refreshToken)).rejects.toThrow();
	});
	it('database verification failure remains a server error instead of an auth rejection', async () => {
		const first = await auth.createSession(user);
		jest.spyOn(db.model('AuthSession'), 'findOne').mockImplementationOnce(() => {
			throw new Error('Database unavailable');
		});
		await expect(auth.verifyToken(first.accessToken)).rejects.toThrow('Database unavailable');
	});
	it('logs schema operation/duration only, never raw auth variables or receipts', async () => {
		const sensitive = randomBytes(32).toString('hex');
		const logger = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
		jest.spyOn(GqlExecutionContext, 'create').mockReturnValue(
			dependency({
				getInfo: () => ({ fieldName: 'login' }),
				getContext: () => ({ req: { body: { variables: { memberPassword: sensitive } } } }),
			}),
		);
		await firstValueFrom(
			new LoggingInterceptor().intercept(
				dependency({ getType: () => 'graphql' }),
				dependency({
					handle: () => of({ accessToken: sensitive }),
				}),
			),
		);
		expect(JSON.stringify(logger.mock.calls).includes(sensitive)).toBe(false);
		expect(logger.mock.calls[0][0]).toMatchObject({ operation: 'login' });
	});
});
