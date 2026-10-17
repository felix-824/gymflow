import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Connection, Types } from 'mongoose';
import { Member } from '../src/libs/dto/member/member';
import { AUTH_AUDIENCE, AUTH_ISSUER } from '../src/libs/auth.config';

// Disposable test processes only; never read application database settings or application signing secrets.
export const authTestSecrets = {
	SECRET_TOKEN: randomBytes(48).toString('base64'),
	SECRET_REFRESH_TOKEN: randomBytes(48).toString('base64'),
	AUTH_ALLOWED_ORIGINS: 'http://localhost:3000',
};
Object.assign(process.env, authTestSecrets);
export const authTestConfig = () => new ConfigService(authTestSecrets);

// Can model a previously issued credential even after its owner is blocked/deleted.
export async function fixtureAccessToken(
	member: Pick<Member, '_id'>,
	app: INestApplication | undefined,
): Promise<string> {
	if (!app) throw new Error('Disposable application not initialized');
	const connection = app.get<Connection>(getConnectionToken());
	const session = await connection
		.model<{ memberId: Types.ObjectId; refreshDigest: string; expiresAt: Date }>('AuthSession')
		.create({
			memberId: member._id,
			refreshDigest: randomBytes(32).toString('hex'),
			expiresAt: new Date(Date.now() + 30 * 86400000),
		});
	return app.get(JwtService).sign(
		{ sub: String(member._id), sid: String(session._id), purpose: 'access' },
		{
			secret: authTestSecrets.SECRET_TOKEN,
			algorithm: 'HS256',
			issuer: AUTH_ISSUER,
			audience: AUTH_AUDIENCE,
			expiresIn: 900,
		},
	);
}
