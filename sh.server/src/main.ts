process.env.TZ = process.env.TZ ?? 'Asia/Ho_Chi_Minh';

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const uploadPath = join(process.cwd(), 'upload');

  if (!existsSync(uploadPath)) {
    mkdirSync(uploadPath, { recursive: true });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useStaticAssets(uploadPath, {
    prefix: '/upload/',
  });

  const clientUrl = process.env.CLIENT_APP_URL?.replace(/\/$/, '');

  app.enableCors({
    origin: clientUrl ? [clientUrl] : true,
    credentials: false,
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap();
