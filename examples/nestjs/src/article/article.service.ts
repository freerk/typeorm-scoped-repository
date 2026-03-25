import { Injectable } from '@nestjs/common';
import {
  InjectScopedFactory,
  ScopedRepositoryFactory,
} from 'typeorm-scoped-repository/nestjs';
import { Scope } from 'typeorm-scoped-repository';
import { ArticleEntity } from './article.entity';

@Injectable()
export class ArticleService {
  constructor(
    @InjectScopedFactory(ArticleEntity)
    private readonly articleRepo: ScopedRepositoryFactory<ArticleEntity>,
  ) {}

  async findAll(scope: Scope): Promise<ArticleEntity[]> {
    return this.articleRepo(scope).find();
  }

  async findOne(scope: Scope, id: string): Promise<ArticleEntity | null> {
    return this.articleRepo(scope).findOne({ where: { id } as never });
  }

  async create(
    scope: Scope,
    data: { title: string; body: string },
  ): Promise<ArticleEntity> {
    const repo = this.articleRepo(scope);
    const article = repo.create(data as never);
    return repo.save(article);
  }

  async remove(scope: Scope, id: string): Promise<void> {
    await this.articleRepo(scope).delete(id);
  }
}
