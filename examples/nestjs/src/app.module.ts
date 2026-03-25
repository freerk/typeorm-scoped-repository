import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArticleModule } from './article/article.module';
import { ArticleEntity } from './article/article.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [ArticleEntity],
      synchronize: true,
    }),
    ArticleModule,
  ],
})
export class AppModule {}
