import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { Model, Types, isValidObjectId } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { Member } from '../../libs/dto/member/member';
import { MemberStatus, MemberType } from '../../libs/enums/member.enum';
import {
	ACCESS_TOKEN_SECONDS,
	AUTH_SESSION_SECONDS,
	AUTH_AUDIENCE,
	AUTH_ISSUER,
	authConfiguration,
} from '../../libs/auth.config';

interface TokenClaims {
	sub: string;
	sid: string;
	purpose: 'access' | 'refresh';
	exp: number;
	iat: number;
	jti?: string;
}
interface AuthSession {
	_id: Types.ObjectId;
	memberId: Types.ObjectId;
	refreshDigest: string;
	expiresAt: Date;
	revokedAt: Date | null;
	rotation: number;
}

@Injectable()
export class AuthService {
	private readonly config: ReturnType<typeof authConfiguration>;
	constructor(
		private readonly jwtService: JwtService,
		@InjectModel('Member') private readonly memberModel: Model<Member>,
		@InjectModel('AuthSession') private readonly authSessionModel: Model<AuthSession>,
		config: ConfigService,
	) {
		this.config = authConfiguration(config);
	}
	async hashPassword(password: string): Promise<string> {
		return bcrypt.hash(password, await bcrypt.genSalt());
	}
	comparePasswords(password: string, hashed: string): Promise<boolean> {
		return bcrypt.compare(password, hashed);
	}
	private invalidSession(reason = 'INVALID_SESSION'): UnauthorizedException {
		return new UnauthorizedException({ statusCode: 401, message: 'Please sign in with an active account', reason });
	}
	private digest(token: string): string {
		return createHash('sha256').update(token).digest('hex');
	}
	private async claims(token: string, purpose: TokenClaims['purpose']): Promise<TokenClaims> {
		let claims: TokenClaims;
		try {
			claims = await this.jwtService.verifyAsync<TokenClaims>(token, {
				secret: purpose === 'access' ? this.config.accessSecret : this.config.refreshSecret,
				algorithms: ['HS256'],
				issuer: AUTH_ISSUER,
				audience: AUTH_AUDIENCE,
			});
		} catch (error) {
			throw this.invalidSession(
				purpose === 'access' && error instanceof Error && error.name === 'TokenExpiredError'
					? 'ACCESS_TOKEN_EXPIRED'
					: 'INVALID_SESSION',
			);
		}
		if (
			claims.purpose !== purpose ||
			typeof claims.sub !== 'string' ||
			typeof claims.sid !== 'string' ||
			!isValidObjectId(claims.sub) ||
			!isValidObjectId(claims.sid) ||
			!Number.isInteger(claims.exp) ||
			!Number.isInteger(claims.iat) ||
			claims.exp * 1000 <= Date.now() ||
			(purpose === 'refresh' && (typeof claims.jti !== 'string' || !claims.jti))
		)
			throw this.invalidSession();
		return claims;
	}
	private async activeMember(memberId: string | Types.ObjectId): Promise<Member> {
		const member = await this.memberModel.findOne({ _id: memberId, memberStatus: MemberStatus.ACTIVE }).lean().exec();
		if (!member || !Object.values(MemberType).includes(member.memberType)) throw this.invalidSession();
		return member;
	}
	private async credentials(memberId: Types.ObjectId, sessionId: Types.ObjectId, expiresAt: Date) {
		const issuedAt = Math.floor(Date.now() / 1000);
		const remaining = Math.floor(expiresAt.getTime() / 1000) - issuedAt;
		if (remaining <= 0) throw this.invalidSession();
		const identity = { sub: memberId.toHexString(), sid: sessionId.toHexString(), iat: issuedAt };
		const [accessToken, refreshToken] = await Promise.all([
			this.jwtService.signAsync(
				{ ...identity, purpose: 'access' },
				{
					secret: this.config.accessSecret,
					algorithm: 'HS256',
					issuer: AUTH_ISSUER,
					audience: AUTH_AUDIENCE,
					expiresIn: Math.min(ACCESS_TOKEN_SECONDS, remaining),
				},
			),
			this.jwtService.signAsync(
				{ ...identity, purpose: 'refresh', jti: randomUUID() },
				{
					secret: this.config.refreshSecret,
					algorithm: 'HS256',
					issuer: AUTH_ISSUER,
					audience: AUTH_AUDIENCE,
					expiresIn: remaining,
				},
			),
		]);
		return { accessToken, refreshToken, expiresAt };
	}
	async createSession(member: Pick<Member, '_id'>) {
		await this.activeMember(member._id);
		const sessionId = new Types.ObjectId();
		const expiresAt = new Date((Math.floor(Date.now() / 1000) + AUTH_SESSION_SECONDS) * 1000);
		const credentials = await this.credentials(member._id, sessionId, expiresAt);
		await this.authSessionModel.create({
			_id: sessionId,
			memberId: member._id,
			expiresAt,
			refreshDigest: this.digest(credentials.refreshToken),
		});
		return credentials;
	}
	// Internal callers can obtain a session-bound access credential without an HTTP receipt.
	async createToken(member: Member): Promise<string> {
		return (await this.createSession(member)).accessToken;
	}
	async verifyToken(token: string): Promise<Member> {
		const claims = await this.claims(token, 'access');
		const session = await this.authSessionModel
			.findOne({
				_id: claims.sid,
				memberId: claims.sub,
				revokedAt: null,
				expiresAt: { $gt: new Date() },
			})
			.lean()
			.exec();
		if (!session) throw this.invalidSession();
		return await this.activeMember(claims.sub);
	}
	async refreshSession(token: string) {
		const claims = await this.claims(token, 'refresh');
		const session = await this.authSessionModel.findOne({ _id: claims.sid, memberId: claims.sub }).lean().exec();
		if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) throw this.invalidSession();
		const digest = this.digest(token);
		if (session.refreshDigest !== digest) {
			await this.authSessionModel
				.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: new Date() } })
				.exec();
			throw this.invalidSession('REFRESH_REUSE');
		}
		const member = await this.activeMember(claims.sub);
		const credentials = await this.credentials(member._id, session._id, session.expiresAt);
		const rotated = await this.authSessionModel
			.findOneAndUpdate(
				{
					_id: session._id,
					memberId: member._id,
					refreshDigest: digest,
					revokedAt: null,
					expiresAt: { $gt: new Date() },
				},
				{
					$set: { refreshDigest: this.digest(credentials.refreshToken) },
					$inc: { rotation: 1 },
				},
				{ new: true },
			)
			.lean()
			.exec();
		if (!rotated) {
			await this.authSessionModel
				.updateOne({ _id: session._id, revokedAt: null }, { $set: { revokedAt: new Date() } })
				.exec();
			throw this.invalidSession('REFRESH_REUSE');
		}
		return credentials;
	}
	async revokeMemberSessions(memberId: Types.ObjectId): Promise<void> {
		await this.authSessionModel.updateMany({ memberId, revokedAt: null }, { $set: { revokedAt: new Date() } }).exec();
	}
	async logoutSession(refreshToken: string, accessToken = ''): Promise<void> {
		let claims: TokenClaims;
		try {
			claims = await this.claims(refreshToken || accessToken, refreshToken ? 'refresh' : 'access');
		} catch (error) {
			if (error instanceof UnauthorizedException) return;
			throw error;
		}
		await this.authSessionModel
			.updateOne({ _id: claims.sid, memberId: claims.sub }, { $set: { revokedAt: new Date() } })
			.exec();
	}
	assertAuthRequest(req: Request): void {
		const origin = req.headers.origin;
		if (
			req.headers['apollo-require-preflight'] !== 'true' ||
			(origin !== undefined && !this.config.allowedOrigins.includes(origin))
		)
			throw new ForbiddenException('Trusted authentication request required');
	}
	readRefreshCookie(req: Request): string {
		const prefix = this.config.cookieName + '=';
		return (
			req.headers.cookie
				?.split(';')
				.map((part) => part.trim())
				.find((part) => part.startsWith(prefix))
				?.slice(prefix.length) ?? ''
		);
	}
	setRefreshCookie(res: Response, credentials: { refreshToken: string; expiresAt: Date }): void {
		res.cookie(this.config.cookieName, credentials.refreshToken, {
			...this.config.cookieOptions,
			expires: credentials.expiresAt,
			maxAge: Math.max(0, credentials.expiresAt.getTime() - Date.now()),
		});
	}
	clearRefreshCookie(res: Response): void {
		res.clearCookie(this.config.cookieName, this.config.cookieOptions);
	}
}
