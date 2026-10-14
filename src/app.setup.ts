import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { validationExceptionFactory } from './common/validation/validation-exception.factory';
import { appVersion } from './common/utils/app-version';

/**
 * Everything main.ts does to the app between create() and listen().
 *
 * Shared with the e2e suite (test/utils/test-app.ts) so tests exercise exactly
 * the production pipeline — FinMatrix's e2e re-declared the prefix and pipes
 * by hand and drifted from main.ts.
 */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const isProd = config.get<string>('app.nodeEnv') === 'production';

  // Trust the first proxy hop (Heroku router) so req.ip is the client's
  // address — the throttler keys on it.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: isProd ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Gzip compression
  app.use(compression());

  // CORS — an allow-list. The mobile app sends no Origin and is always
  // allowed; a browser origin not on the list simply gets no CORS headers
  // (FinMatrix threw here, which surfaced as a 500).
  const corsOrigins = config.get<string[]>('app.corsOrigins', []);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      callback(null, corsOrigins.includes('*') || corsOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 86400,
  });

  app.setGlobalPrefix(config.get<string>('app.apiPrefix', 'api/v1'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Swagger — only when enabled. JSON at /api/docs-json.
  if (config.get<boolean>('app.swaggerEnabled')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MetroMatrix API')
      .setDescription(
        'Zero-commission community marketplace: Shopping, Healthcare, Food. ' +
          'Every response is enveloped: { success, data } or { success: false, error: { code, message, details? } }.',
      )
      .setVersion(appVersion())
      .addBearerAuth()
      .addServer(config.get<string>('app.appUrl', 'http://localhost:3000'))
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Graceful shutdown
  app.enableShutdownHooks();
}
