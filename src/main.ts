// Sentry MUST initialize before anything else — keep this first.
import './instrument';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    cors: false,
  });
  const logger = app.get(PinoLogger);
  app.useLogger(logger);

  configureApp(app);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const prefix = config.get<string>('app.apiPrefix', 'api/v1');
  const nodeEnv = config.get<string>('app.nodeEnv', 'development');

  await app.listen(port, '0.0.0.0');
  logger.log(
    `MetroMatrix API [${nodeEnv}] listening on http://localhost:${port}/${prefix}  (Swagger: /api/docs)`,
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start:', err);
  process.exit(1);
});
