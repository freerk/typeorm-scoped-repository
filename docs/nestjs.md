# NestJS Integration

Optional NestJS helpers that eliminate the boilerplate of creating scoped repository factory methods in every service.

## Install

```bash
npm install typeorm-scoped-repository
# NestJS peer deps (you likely already have these)
npm install @nestjs/common @nestjs/typeorm typeorm
```

## Quick start

### 1. Register entities in your feature module

```typescript
import { Module } from '@nestjs/common';
import { ScopedRepositoryModule } from 'typeorm-scoped-repository/nestjs';
import { ArticleEntity } from './entities/article.entity';
import { CategoryEntity } from './entities/category.entity';
import { ArticleService } from './article.service';

@Module({
  imports: [
    ScopedRepositoryModule.forFeature([ArticleEntity, CategoryEntity]),
  ],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}
```

`ScopedRepositoryModule.forFeature()` does two things:
- Calls `TypeOrmModule.forFeature()` internally (you don't need both)
- Registers a `ScopedRepositoryFactory<T>` provider for each entity

### 2. Inject factories in your service

```typescript
import { Injectable } from '@nestjs/common';
import {
  InjectScopedFactory,
  ScopedRepositoryFactory,
} from 'typeorm-scoped-repository/nestjs';
import { Scope } from 'typeorm-scoped-repository';
import { ArticleEntity } from './entities/article.entity';
import { CategoryEntity } from './entities/category.entity';

@Injectable()
export class ArticleService {
  constructor(
    @InjectScopedFactory(ArticleEntity)
    private readonly articleRepo: ScopedRepositoryFactory<ArticleEntity>,
    @InjectScopedFactory(CategoryEntity)
    private readonly categoryRepo: ScopedRepositoryFactory<CategoryEntity>,
  ) {}

  async findAll(scope: Scope) {
    return this.articleRepo(scope).find();
  }

  async findByCategory(scope: Scope, categoryId: string) {
    return this.articleRepo(scope).find({
      where: { categoryId } as any,
    });
  }

  async countPublished(scope: Scope) {
    return this.articleRepo(scope)
      .createQueryBuilder('article')
      .andWhere('article.status = :status', { status: 'published' })
      .getCount();
  }
}
```

### 3. Pass scope from your controller

The scope comes from your request context (JWT, headers, middleware). How you extract it is up to you.

```typescript
import { Controller, Get } from '@nestjs/common';
import { Scope } from 'typeorm-scoped-repository';
import { ArticleService } from './article.service';

// Example: custom decorator that extracts organisationId from JWT
import { OrganisationId } from '../auth/decorators/organisation-id.decorator';

@Controller('articles')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @Get()
  findAll(@OrganisationId() organisationId: string) {
    const scope: Scope = { organisationId };
    return this.articleService.findAll(scope);
  }
}
```

## Composite scopes

The factory accepts any `Scope` shape, so composite scopes work naturally:

```typescript
@Injectable()
export class DocumentService {
  constructor(
    @InjectScopedFactory(DocumentEntity)
    private readonly documentRepo: ScopedRepositoryFactory<DocumentEntity>,
  ) {}

  async findForWorkspace(accountId: string, workspaceId: string) {
    return this.documentRepo({ accountId, workspaceId }).find();
    // WHERE account_id = $1 AND workspace_id = $2
  }
}
```

## Transactions

Use `withTransaction()` on the scoped repository, same as without NestJS:

```typescript
@Injectable()
export class ArticleService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectScopedFactory(ArticleEntity)
    private readonly articleRepo: ScopedRepositoryFactory<ArticleEntity>,
    @InjectScopedFactory(CategoryEntity)
    private readonly categoryRepo: ScopedRepositoryFactory<CategoryEntity>,
  ) {}

  async archiveCategory(scope: Scope, categoryId: string) {
    return this.dataSource.transaction(async (manager) => {
      const txArticles = this.articleRepo(scope).withTransaction(manager);
      const txCategories = this.categoryRepo(scope).withTransaction(manager);

      await txCategories.update(categoryId, { status: 'archived' } as any);
      // Both repos share the same scope within the transaction
    });
  }
}
```

## Testing

Mock the factory in unit tests:

```typescript
import { Test } from '@nestjs/testing';
import { getScopedFactoryToken } from 'typeorm-scoped-repository/nestjs';
import { ArticleService } from './article.service';
import { ArticleEntity } from './entities/article.entity';

describe('ArticleService', () => {
  let service: ArticleService;
  const mockFind = jest.fn().mockResolvedValue([]);

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ArticleService,
        {
          provide: getScopedFactoryToken(ArticleEntity),
          useValue: () => ({
            find: mockFind,
            findOne: jest.fn(),
            save: jest.fn(),
            // ... other methods
          }),
        },
      ],
    }).compile();

    service = module.get(ArticleService);
  });

  it('calls find with scope', async () => {
    await service.findAll({ organisationId: 'org-123' });
    expect(mockFind).toHaveBeenCalled();
  });
});
```

## API reference

### `ScopedRepositoryModule.forFeature(entities)`

Registers scoped factory providers. Import in your feature module.

| Parameter | Type | Description |
|---|---|---|
| `entities` | `EntityClass[]` | Array of TypeORM entity classes |

### `@InjectScopedFactory(entity)`

Parameter decorator. Injects a `ScopedRepositoryFactory<T>` for the given entity.

### `ScopedRepositoryFactory<T>`

```typescript
type ScopedRepositoryFactory<T> = (scope: Scope) => ScopedRepository<T>;
```

A function that creates a `ScopedRepository<T>` for a given scope. The factory itself is a singleton; the `ScopedRepository` it returns is created per call.

### `getScopedFactoryToken(entity)`

Returns the DI token string for a given entity. Useful for manual provider registration or test mocking.

```typescript
getScopedFactoryToken(ArticleEntity) // 'ScopedRepositoryFactory<ArticleEntity>'
```

## Migration from manual pattern

If you're currently using the manual factory pattern:

```diff
- import { InjectRepository } from '@nestjs/typeorm';
- import { Repository } from 'typeorm';
- import { ScopedRepository } from 'typeorm-scoped-repository';
+ import { InjectScopedFactory, ScopedRepositoryFactory } from 'typeorm-scoped-repository/nestjs';

  @Injectable()
  export class ArticleService {
    constructor(
-     @InjectRepository(ArticleEntity)
-     private readonly _articleRepo: Repository<ArticleEntity>,
+     @InjectScopedFactory(ArticleEntity)
+     private readonly articleRepo: ScopedRepositoryFactory<ArticleEntity>,
    ) {}

-   private articleRepo(orgId: string) {
-     return new ScopedRepository(this._articleRepo, { organisationId: orgId });
-   }

    async findAll(orgId: string) {
-     return this.articleRepo(orgId).find();
+     return this.articleRepo({ organisationId: orgId }).find();
    }
  }
```

And in your module:

```diff
- import { TypeOrmModule } from '@nestjs/typeorm';
+ import { ScopedRepositoryModule } from 'typeorm-scoped-repository/nestjs';

  @Module({
    imports: [
-     TypeOrmModule.forFeature([ArticleEntity]),
+     ScopedRepositoryModule.forFeature([ArticleEntity]),
    ],
  })
```
