import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ThrottleExceptionFilter } from './common/filters/throttle-exception.filter';
import helmet from 'helmet';
import { join } from 'path';
import * as fs from 'fs';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ── Security Headers (Helmet) ─────────────────────────────
  // Thêm 15+ HTTP security headers tự động:
  // - X-Content-Type-Options: nosniff
  // - X-Frame-Options: SAMEORIGIN
  // - Strict-Transport-Security (HSTS)
  // - Ẩn X-Powered-By header
  app.use(helmet());

  // Đảm bảo thư mục uploads tồn tại
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  // Serve static files từ /uploads
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  // ── Exception Filters ─────────────────────────────────────
  // ThrottleExceptionFilter phải đứng TRƯỚC AllExceptionsFilter
  // để bắt 429 Too Many Requests trước khi AllExceptionsFilter xử lý
  app.useGlobalFilters(new AllExceptionsFilter(), new ThrottleExceptionFilter());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global response interceptor — mọi response bọc { success: true, data }
  app.useGlobalInterceptors(new TransformInterceptor());

  // ── CORS ─────────────────────────────────────────────────
  // Production: chỉ cho phép domain chính thức
  // Development: thêm localhost
  const isProd = process.env.NODE_ENV === 'production';
  const productionOrigins = [
    'https://badmintonhub-fe.vercel.app',
    'https://www.badmintonhub.tech',
    'https://badmintonhub.tech',
  ];
  const devOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    ...productionOrigins,
  ];

  app.enableCors({
    origin: isProd ? productionOrigins : devOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 BadmintonHub API running on http://localhost:${port}/api`);
  console.log(`🛡️  Security: Helmet enabled, Rate limiting active, CORS ${isProd ? 'production' : 'development'} mode`);
}
bootstrap();

