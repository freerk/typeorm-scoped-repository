import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  console.log('Listening on http://localhost:3000');
  console.log('');
  console.log('Try it:');
  console.log(
    '  curl -H "x-organisation-id: org-1" http://localhost:3000/articles',
  );
  console.log(
    '  curl -X POST -H "x-organisation-id: org-1" -H "Content-Type: application/json" \\',
  );
  console.log(
    '    -d \'{"title":"Hello","body":"World"}\' http://localhost:3000/articles',
  );
}

bootstrap();
