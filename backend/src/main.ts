import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const corsOrigins = config.get<string>('CORS_ORIGIN', '');
  const allowedOrigins = corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());

  app.enableCors({
    origin: (origin, callback) => {
      // Native mobile clients usually send no Origin header; browsers do.
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerEnabled =
    config.get<string>('SWAGGER_ENABLED', 'false') === 'true' &&
    config.get<string>('NODE_ENV', 'development') !== 'production';

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AI Tutor EDU API')
      .setDescription('Documentacion de la API del backend')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`Server running on port ${port}`);
  if (swaggerEnabled) {
    logger.log('Swagger docs available at /api/docs');
  }
}

bootstrap();
