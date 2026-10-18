import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './libs/interceptor/Logging.interceptor';
import { graphqlUploadExpress } from 'graphql-upload';
import * as express from 'express';
import { ConfigService } from '@nestjs/config';
import { authConfiguration } from './libs/auth.config';
import { IMAGE_UPLOAD_MAX_BYTES, PROGRAM_MAX_IMAGES } from './libs/config';
import { uploadedImageHeaders } from './libs/upload';
import { uploadRoot, UploadStorageError } from './libs/upload-storage';
import { OperationsService } from './operations.service';
import type { Server } from 'node:http';

async function bootstrap() {
	const storageRoot = uploadRoot();
	const app = await NestFactory.create(AppModule);
	try {
		// Mongo connection/readiness providers have resolved; storage must pass before startup hooks/backfill.
		await app.get(OperationsService).prepareStorage(storageRoot);

		// kelayotgan request ma'lumotlarini DTO qoidalari bo‘yicha tekshiradi.
		app.useGlobalPipes(new ValidationPipe());

		// Request va response loglarini yozib boradi.
		app.useGlobalInterceptors(new LoggingInterceptor());

		// Frontend boshqa domain yoki portdan backendga murojaat qilishiga ruxsat beradi.
		app.enableCors({ origin: authConfiguration(app.get(ConfigService)).allowedOrigins, credentials: true });

		// GraphQL orqali fayl upload qilishni sozlaydi.
		app.use(graphqlUploadExpress({ maxFileSize: IMAGE_UPLOAD_MAX_BYTES, maxFiles: PROGRAM_MAX_IMAGES }));
		// uploads papkasidagi rasmlar/fayllarni browser orqali ochishga imkon beradi.
		app.use('/uploads', uploadedImageHeaders, express.static(storageRoot));
		(app.getHttpServer() as Server).requestTimeout = 30000;
		// Backend serverni PORT_API yoki 3000 portda ishga tushiradi.

		await app.listen(process.env.PORT_API ?? 3000);
	} catch (error) {
		await app.close();
		throw error;
	}
}
void bootstrap().catch((error: unknown) => {
	console.error(
		error instanceof UploadStorageError
			? error.message
			: 'API startup failed; check configuration and dependency readiness',
	);
	process.exitCode = 1;
});
