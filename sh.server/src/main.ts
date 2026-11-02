process.env.TZ = process.env.TZ ?? 'Asia/Ho_Chi_Minh';

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { RequestValidationPipe } from './common/request-validation.pipe';

async function bootstrap() {
  const uploadPath = join(process.cwd(), 'upload');

  if (!existsSync(uploadPath)) {
    mkdirSync(uploadPath, { recursive: true });
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new RequestValidationPipe());
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? '0');
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5)
    throw new Error('TRUST_PROXY_HOPS phải là số nguyên từ 0 đến 5');
  app.set('trust proxy', proxyHops);

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
