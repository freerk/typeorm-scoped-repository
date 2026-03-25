import { Module } from '@nestjs/common';
import { ScopedRepositoryModule } from 'typeorm-scoped-repository/nestjs';
import { ArticleEntity } from './article.entity';
import { ArticleService } from './article.service';
import { ArticleController } from './article.controller';

@Module({
  imports: [ScopedRepositoryModule.forFeature([ArticleEntity])],
  providers: [ArticleService],
  controllers: [ArticleController],
})
export class ArticleModule {}
