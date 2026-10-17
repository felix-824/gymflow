import { ConfigService } from '@nestjs/config';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const AUTH_SESSION_SECONDS = 30 * 24 * 60 * 60;
export const AUTH_ISSUER = 'gymflow';
export const AUTH_AUDIENCE = 'gymflow-api';

export function authConfiguration(config: Pick<ConfigService, 'get'>) {
	const accessSecret = config.get<string>('SECRET_TOKEN');
	const refreshSecret = config.get<string>('SECRET_REFRESH_TOKEN');
	for (const [name, value] of [
		['SECRET_TOKEN', accessSecret],
		['SECRET_REFRESH_TOKEN', refreshSecret],
	]) {
		if (typeof value !== 'string' || Buffer.byteLength(value) < 32 || value === 'undefined')
			throw new Error(name + ' must contain at least 32 bytes of independent secret material');
	}
	if (accessSecret === refreshSecret) throw new Error('Access and refresh secrets must be different');
	const production = config.get<string>('NODE_ENV') === 'production';
	const configuredOrigins = config.get<string>('AUTH_ALLOWED_ORIGINS');
	if (production && !configuredOrigins) throw new Error('AUTH_ALLOWED_ORIGINS is required in production');
	const allowedOrigins = (configuredOrigins ?? 'http://localhost:3000').split(',').map((origin) => origin.trim());
	for (const origin of allowedOrigins) {
		let parsed: URL;
		try {
			parsed = new URL(origin);
		} catch {
			throw new Error('AUTH_ALLOWED_ORIGINS must contain explicit origins');
		}
		if (
			parsed.origin !== origin ||
			!['http:', 'https:'].includes(parsed.protocol) ||
			(production && parsed.protocol !== 'https:')
		)
			throw new Error('AUTH_ALLOWED_ORIGINS must contain explicit HTTPS origins in production');
	}
	return {
		accessSecret: accessSecret!,
		refreshSecret: refreshSecret!,
		allowedOrigins,
		cookieName: production ? '__Host-gymflow_refresh' : 'gymflow_refresh',
		cookieOptions: { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/' },
	};
}
