import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use((req: any, res: any, next: any) => {
    if (req.method === 'GET' && req.path === '/rest/v1') {
      res.json({ status: 'ok', message: 'backend is healthy', service: 'explore-wings-erp-api', basePath: '/rest/v1', health: '/rest/v1/health' });
      return;
    }
    next();
  });

  app.setGlobalPrefix('rest/v1', { exclude: [''] });
  app.enableCors({
    origin: '*',
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);

  console.log(`[explore-wings-erp-api] listening on :${port}`);
  console.log('[explore-wings-erp-api] backend is healthy');
  console.log('[explore-wings-erp-api] base path: /rest/v1');
}

void bootstrap();
