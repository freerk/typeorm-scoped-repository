import { DynamicModule, Inject, Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import { ScopedRepository, Scope } from './scoped-repository';

/**
 * Factory function that creates a ScopedRepository for a given scope.
 * Injected via `@InjectScopedFactory(Entity)` in NestJS services.
 *
 * The factory is a singleton; the ScopedRepository it returns is per-call.
 * This avoids request-scoped providers while keeping scope dynamic.
 *
 * @example
 * constructor(
 *   @InjectScopedFactory(ArticleEntity)
 *   private readonly articleRepo: ScopedRepositoryFactory<ArticleEntity>,
 * ) {}
 *
 * async findAll(scope: Scope) {
 *   return this.articleRepo(scope).find();
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ScopedRepositoryFactory<T extends Record<string, any>> = (
  scope: Scope,
) => ScopedRepository<T>;

/**
 * Entity target type accepted by forFeature().
 * Matches TypeORM's EntityTarget — a class constructor or EntitySchema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EntityClass = new (...args: any[]) => any;

/**
 * Build a unique DI token for a scoped factory provider.
 *
 * @example
 * getScopedFactoryToken(ArticleEntity) // 'ScopedRepositoryFactory<ArticleEntity>'
 */
export function getScopedFactoryToken(entity: EntityClass): string {
  return `ScopedRepositoryFactory<${entity.name}>`;
}

/**
 * Parameter decorator that injects a `ScopedRepositoryFactory<T>` for the given entity.
 *
 * @example
 * constructor(
 *   @InjectScopedFactory(ArticleEntity)
 *   private readonly articleRepo: ScopedRepositoryFactory<ArticleEntity>,
 * ) {}
 */
export function InjectScopedFactory(entity: EntityClass): ParameterDecorator {
  return Inject(getScopedFactoryToken(entity));
}

/**
 * NestJS module that registers `ScopedRepositoryFactory` providers for each entity.
 *
 * Mirrors `TypeOrmModule.forFeature()` — call it in your feature module's imports
 * and inject with `@InjectScopedFactory(Entity)` in your services.
 *
 * @example
 * @Module({
 *   imports: [
 *     ScopedRepositoryModule.forFeature([ArticleEntity, CategoryEntity]),
 *   ],
 *   providers: [ArticleService],
 * })
 * export class ArticleModule {}
 */
@Module({})
export class ScopedRepositoryModule {
  static forFeature(entities: EntityClass[]): DynamicModule {
    const providers = entities.map((entity) => ({
      provide: getScopedFactoryToken(entity),
      useFactory: (
        repo: Repository<ObjectLiteral>,
      ): ScopedRepositoryFactory<ObjectLiteral> => {
        return (scope: Scope) => new ScopedRepository(repo, scope);
      },
      inject: [getRepositoryToken(entity)],
    }));

    return {
      module: ScopedRepositoryModule,
      imports: [TypeOrmModule.forFeature(entities)],
      providers,
      exports: providers.map((p) => p.provide),
    };
  }
}
