import { MongooseModule } from '@nestjs/mongoose';
import MemberSchema from '../../schemas/Member.model';
import AuthSessionSchema from '../../schemas/AuthSession.model';
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ACCESS_TOKEN_SECONDS, AUTH_AUDIENCE, AUTH_ISSUER, authConfiguration } from '../../libs/auth.config';

@Module({
	imports: [
		HttpModule,
		ConfigModule,
		MongooseModule.forFeature([
			{ name: 'Member', schema: MemberSchema },
			{ name: 'AuthSession', schema: AuthSessionSchema },
		]),
		JwtModule.registerAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: (config: ConfigService) => ({
				secret: authConfiguration(config).accessSecret,
				signOptions: {
					expiresIn: ACCESS_TOKEN_SECONDS,
					algorithm: 'HS256',
					issuer: AUTH_ISSUER,
					audience: AUTH_AUDIENCE,
				},
			}),
		}),
	],
	providers: [AuthService],
	exports: [AuthService],
})
export class AuthModule {}
