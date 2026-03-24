import {
  FindManyOptions,
  FindOneOptions,
  Repository,
  FindOptionsWhere,
  SaveOptions,
  DeepPartial,
  SelectQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
  ObjectLiteral,
  Brackets,
  EntityManager,
  EntityTarget,
  ObjectType,
} from 'typeorm';

/**
 * A record of scope field names to their values.
 * All fields will be injected as WHERE conditions on every query.
 *
 * @example
 * // Single-scope (organisation isolation)
 * const scope: Scope = { organisationId: 'org-123' };
 *
 * // Composite scope (user + agent isolation, e.g. for viking-ts)
 * const scope: Scope = { accountId: 'default', ownerSpace: '10f5d88f294c' };
 *
 * // Triple scope (full multi-tenant)
 * const scope: Scope = { accountId: 'acme', userId: 'alice', ownerSpace: 'a3f9c2b1e8d4' };
 */
export type Scope = Record<string, string>;

// TypeORM internal interfaces for safe type access
interface QueryBuilderInternal {
  orWhere?: (where: unknown, parameters?: unknown) => unknown;
  andWhere: (where: unknown, parameters?: unknown) => unknown;
  __scopeApplied?: boolean;
  expressionMap?: { wheres: unknown[] };
}

interface RepositoryInternal {
  target?: unknown;
  metadata?: { target?: unknown; targetName?: string };
}

type QueryBuilderWithWhere<T extends ObjectLiteral = ObjectLiteral> =
  | SelectQueryBuilder<T>
  | UpdateQueryBuilder<T>
  | DeleteQueryBuilder<T>;

/**
 * Apply fortress method overrides to a query builder that already has scope applied.
 * Converts .where() to .andWhere() so that caller code cannot accidentally clear
 * the scope filter by calling .where() with their own conditions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFortressOverrides(qb: any): any {
  if (typeof qb.where === 'function' && typeof qb.andWhere === 'function') {
    const originalOrWhere = qb.orWhere?.bind(qb);

    // Make .where() behave like .andWhere() — scope filter cannot be cleared
    qb.where = function (where: unknown, parameters?: ObjectLiteral) {
      return this.andWhere(where, parameters);
    };

    if (originalOrWhere) {
      // Wrap OR conditions in brackets so they cannot bypass the scope filter
      qb.orWhere = function (where: unknown, parameters?: ObjectLiteral) {
        return this.andWhere(
          new Brackets((inner: any) => {
            inner.andWhere(where, parameters);
          }),
        );
      };
    }
  }
  return qb;
}

/**
 * Build a WHERE condition string and parameter object for a given scope and alias.
 * For SELECT queries the alias is prefixed (e.g. `entity.organisationId`).
 * For UPDATE/DELETE queries no alias prefix is used (plain column name).
 */
function buildScopeCondition(
  scope: Scope,
  alias: string,
  useAlias: boolean,
): { condition: string; params: ObjectLiteral } {
  const params: ObjectLiteral = {};
  const parts: string[] = [];

  for (const [key, value] of Object.entries(scope)) {
    // Convert camelCase key to snake_case column name for raw query builders
    const col = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const paramKey = `__scope_${key}`;
    params[paramKey] = value;
    const fieldRef = useAlias ? `${alias}.${key}` : col;
    parts.push(`${fieldRef} = :${paramKey}`);
  }

  return { condition: parts.join(' AND '), params };
}

/**
 * Wrap a query builder with scope isolation using the fortress pattern.
 *
 * Guarantees:
 * 1. Scope fields are always injected via .andWhere() — cannot be removed
 * 2. Subsequent .where() calls are converted to .andWhere() to prevent bypass
 * 3. OR conditions are wrapped in Brackets to prevent scope filter bypass
 */
function createScopedQueryBuilder<T extends ObjectLiteral>(
  qb: QueryBuilderWithWhere<T>,
  alias: string,
  scope: Scope,
): QueryBuilderWithWhere<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qbAny = qb as any;
  if (qbAny.__scopeApplied) return qb;
  qbAny.__scopeApplied = true;

  const isUpdateOrDelete =
    qb.constructor.name === 'UpdateQueryBuilder' ||
    qb.constructor.name === 'DeleteQueryBuilder';

  const { condition, params } = buildScopeCondition(scope, alias, !isUpdateOrDelete);
  qb.andWhere(condition, params);

  return applyFortressOverrides(qb);
}

/**
 * ScopedRepository — TypeORM repository wrapper that automatically injects
 * scope conditions on every query.
 *
 * **Fortress pattern**: Once a ScopedRepository is created, it is impossible
 * for calling code to accidentally query outside the scope — `.where()` is
 * silently converted to `.andWhere()`, and OR conditions are wrapped in
 * brackets to prevent filter bypass.
 *
 * @example
 * // Organisation-scoped (single scope)
 * const repo = new ScopedRepository(whisperRepo, { organisationId: 'org-123' });
 * const whispers = await repo.find(); // WHERE organisation_id = 'org-123'
 *
 * @example
 * // Agent-scoped (composite scope, e.g. viking-ts)
 * const repo = new ScopedRepository(contextVectorRepo, {
 *   accountId: 'default',
 *   ownerSpace: '10f5d88f294c',  // md5(`${userId}:${agentId}`).slice(0,12)
 * });
 *
 * @example
 * // Full multi-tenant composite scope
 * const repo = new ScopedRepository(contextVectorRepo, {
 *   accountId: 'acme-corp',
 *   userId: 'alice',
 *   ownerSpace: 'a3f9c2b1e8d4',
 * });
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ScopedRepository<T extends Record<string, any>> {
  private readonly entityTarget: unknown;

  constructor(
    private readonly repo: Repository<T>,
    private readonly scope: Scope,
  ) {
    this.entityTarget =
      (repo as RepositoryInternal).target ??
      (repo as RepositoryInternal).metadata?.target ??
      (repo as RepositoryInternal).metadata?.targetName ??
      null;
  }

  /** Current scope — useful for logging and debugging. */
  getScope(): Readonly<Scope> {
    return { ...this.scope };
  }

  async find(options: FindManyOptions<T> = {}): Promise<T[]> {
    return this.repo.find({
      ...options,
      where: this.mergeWhere(options.where),
    });
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repo.findOne({
      ...options,
      where: this.mergeWhere(options.where),
    });
  }

  async save(entity: T, options?: SaveOptions): Promise<T>;
  async save(entities: T[], options?: SaveOptions): Promise<T[]>;
  async save(entity: T | T[], options?: SaveOptions): Promise<T | T[]> {
    if (Array.isArray(entity)) {
      return this.repo.save(
        entity.map((e) => this.applyScopeTo(e)),
        options,
      );
    }
    return this.repo.save(this.applyScopeTo(entity), options);
  }

  create(data: DeepPartial<T>): T;
  create(data: DeepPartial<T>[]): T[];
  create(data: DeepPartial<T> | DeepPartial<T>[]): T | T[] {
    if (Array.isArray(data)) {
      return this.repo.create(
        data.map((item) => ({ ...item, ...this.scope }) as DeepPartial<T>),
      );
    }
    return this.repo.create({ ...data, ...this.scope } as DeepPartial<T>);
  }

  async update(id: string, partial: Partial<T>): Promise<void> {
    await this.repo.update(
      this.mergeWhere({ id } as unknown as FindOptionsWhere<T>),
      partial as unknown as Parameters<Repository<T>['update']>[1],
    );
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete(this.mergeWhere({ id } as unknown as FindOptionsWhere<T>));
  }

  async count(options: FindManyOptions<T> = {}): Promise<number> {
    return this.repo.count({
      ...options,
      where: this.mergeWhere(options.where),
    });
  }

  /**
   * Create a query builder with scope pre-applied using the fortress pattern.
   * Subsequent `.where()` calls are automatically converted to `.andWhere()`
   * so the scope filter cannot be accidentally cleared.
   */
  createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    const qb = this.repo.createQueryBuilder(alias);
    return createScopedQueryBuilder(qb, alias, this.scope) as SelectQueryBuilder<T>;
  }

  /**
   * Create a new ScopedRepository using a transaction manager.
   * Maintains all scope fields within the transaction.
   *
   * @example
   * await dataSource.transaction(async (manager) => {
   *   const txRepo = myRepo.withTransaction(manager);
   *   await txRepo.save(entity);
   * });
   */
  withTransaction(
    manager: EntityManager,
    entityClass?: EntityTarget<T>,
  ): ScopedRepository<T> {
    const target = entityClass ?? this.entityTarget;
    if (!target) {
      throw new Error(
        'Cannot determine entity target for transaction. ' +
        'Pass the entity class as the second argument: withTransaction(manager, MyEntity)',
      );
    }
    return new ScopedRepository(
      manager.getRepository(target as EntityTarget<T>),
      this.scope,
    );
  }

  /**
   * Extend the current scope with additional fields, returning a new ScopedRepository.
   * Useful for layered scoping (e.g. add agentId on top of accountId).
   *
   * @example
   * const accountRepo = new ScopedRepository(repo, { accountId: 'acme' });
   * const agentRepo = accountRepo.withScope({ ownerSpace: '10f5d88f294c' });
   * // agentRepo queries WHERE account_id = 'acme' AND owner_space = '10f5d88f294c'
   */
  withScope(additionalScope: Scope): ScopedRepository<T> {
    return new ScopedRepository(this.repo, { ...this.scope, ...additionalScope });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private mergeWhere(
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[],
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const scopeAsWhere = this.scope as unknown as FindOptionsWhere<T>;
    if (!where) return scopeAsWhere;
    if (Array.isArray(where)) {
      return where.map((w) => ({ ...w, ...scopeAsWhere }));
    }
    return { ...where, ...scopeAsWhere };
  }

  private applyScopeTo(entity: T): T {
    return { ...entity, ...this.scope };
  }
}
