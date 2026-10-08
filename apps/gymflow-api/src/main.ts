import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { LoggingInterceptor } from './libs/interceptor/Logging.interceptor';
import {graphqlUploadExpress} from "graphql-upload";
import * as express from 'express';
import { WsAdapter } from '@nestjs/platform-ws';

//GLOBAL 
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // kelayotgan request ma'lumotlarini DTO qoidalari bo‘yicha tekshiradi.
  app.useGlobalPipes(new ValidationPipe());

  // Request va response loglarini yozib boradi.
  app.useGlobalInterceptors(new LoggingInterceptor());

   // Frontend boshqa domain yoki portdan backendga murojaat qilishiga ruxsat beradi.
  app.enableCors({ origin: true, credentials: true});

 // GraphQL orqali fayl upload qilishni sozlaydi.
  app.use(graphqlUploadExpress({ maxFileSize: 15000000, maxFiles: 10 }));
   // uploads papkasidagi rasmlar/fayllarni browser orqali ochishga imkon beradi.
  app.use('/uploads', express.static('./uploads'));
// Backend serverni PORT_API yoki 3000 portda ishga tushiradi.

  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(process.env.PORT_API ?? 3000);
}
bootstrap();
