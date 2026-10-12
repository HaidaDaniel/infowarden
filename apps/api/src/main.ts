import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppExceptionFilter } from './common/app-exception.filter';
import { createApiKeyAuthMiddleware } from './auth/api-key-auth.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const bodyLimit = `${configService.get<number>('API_MAX_BODY_BYTES') || 1024 * 1024}b`;
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });
  app.enableShutdownHooks();
  app.enableCors({
    origin: parseCorsOrigins(configService.get<string>('CORS_ORIGIN')),
    credentials: true,
  });
  app.useGlobalFilters(new AppExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('InfoWarden API')
    .setDescription('InfoWarden context, retrieval, and durable-memory API')
    .setVersion('0.1')
    .addTag('knowledge-bases', 'Knowledge Base management')
    .addTag('sources', 'Source management')
    .addTag('jobs', 'Indexing jobs')
    .addTag('health', 'Health checks')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const docsAuth = createApiKeyAuthMiddleware({
    enabled: configService.get<boolean>('API_KEY_AUTH_ENABLED') === true,
    apiKey: configService.get<string>('ADMIN_API_KEY'),
  });
  app.use('/api/docs', docsAuth);
  app.use('/api/docs-json', docsAuth);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
void bootstrap();

function parseCorsOrigins(value?: string): boolean | string[] {
  if (!value || value.trim() === '' || value.trim() === '*') {
    return true;
  }
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
