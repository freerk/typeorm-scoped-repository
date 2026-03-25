import {
  DataSource,
  Repository,
  Entity,
  PrimaryGeneratedColumn,
  Column,
} from 'typeorm';
import { ScopedRepository, Scope } from './scoped-repository';

@Entity('test_items')
class TestItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organisation_id' })
  organisationId!: string;

  @Column({ name: 'account_id', nullable: true })
  accountId!: string;

  @Column({ name: 'owner_space', nullable: true })
  ownerSpace!: string;

  @Column({ name: 'batch_id', nullable: true })
  batchId!: string;

  @Column({ name: 'created_at', nullable: true })
  createdAt!: Date;

  @Column({ nullable: true })
  status!: string;

  @Column({ nullable: true })
  text!: string;

  @Column({ nullable: true })
  active!: boolean;

  @Column({ nullable: true })
  priority!: string;
}

/**
 * SQL Integration Tests
 *
 * Uses a real SQLite DataSource to verify actual SQL generation.
 * Critical for catching issues like duplicate scope conditions that
 * mock-based tests would miss.
 */
describe('SQL Integration — single scope', () => {
  let dataSource: DataSource;
  let repository: Repository<TestItemEntity>;
  let scoped: ScopedRepository<TestItemEntity>;

  const SCOPE: Scope = { organisationId: 'org-123' };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [TestItemEntity],
      synchronize: true,
      logging: false,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(TestItemEntity);
    scoped = new ScopedRepository(repository, SCOPE);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('SELECT queries', () => {
    it('generates correct SQL with scope filter', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .andWhere('item.batchId IS NULL');

      const sql = qb.getSql();
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);
      expect(sql).toMatch(/"?batch_id"?\s+IS\s+NULL/);

      const params = qb.getParameters();
      expect(params.__scope_organisationId).toBe('org-123');
    });

    it('generates correct SQL with date filter', () => {
      const endDate = new Date('2024-01-01');
      const qb = scoped
        .createQueryBuilder('item')
        .andWhere('item.batchId IS NULL')
        .andWhere('item.createdAt <= :endDate', { endDate });

      const sql = qb.getSql();
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);
      expect(sql).toMatch(/"?batch_id"?\s+IS\s+NULL/);
      expect(sql).toMatch(/"?item"?\."?created_at"?\s*<=\s*\?/);
    });
  });

  describe('UPDATE queries — THE CRITICAL TEST', () => {
    it('generates UPDATE SQL without duplicate scope conditions', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .update(TestItemEntity)
        .set({ batchId: 'batch-1' })
        .andWhere('batchId IS NULL');

      const sql = qb.getSql();

      // CRITICAL: exactly ONE scope condition, not two
      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      expect(sql).toMatch(/"?batch_id"?\s+IS\s+NULL/);
      expect(sql).toMatch(/^UPDATE/);
      expect(sql).toContain('SET');
      expect(sql).toContain('WHERE');
    });

    it('handles .where() on UPDATE correctly (the original bug pattern)', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .update(TestItemEntity)
        .set({ batchId: 'batch-2' })
        .where('batchId IS NULL');

      const sql = qb.getSql();

      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      // Should not have both aliased and unaliased scope conditions
      expect(sql).not.toMatch(
        /"?item"?\."?organisation_id"?.*"?organisation_id"?/,
      );

      expect(sql).toMatch(/"?batch_id"?\s+IS\s+NULL/);
    });

    it('handles UPDATE with date conditions', () => {
      const endDate = new Date('2024-01-01');
      const qb = scoped
        .createQueryBuilder('item')
        .update(TestItemEntity)
        .set({ batchId: 'batch-3' })
        .andWhere('batchId IS NULL')
        .andWhere('createdAt <= :endDate', { endDate });

      const sql = qb.getSql();

      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      expect(sql).toMatch(/"?batch_id"?\s+IS\s+NULL/);
      expect(sql).toMatch(/"?created_at"?\s*<=\s*\?/);
    });
  });

  describe('DELETE queries', () => {
    it('generates correct DELETE SQL with scope filter', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .delete()
        .where('status = :status', { status: 'obsolete' });

      const sql = qb.getSql();

      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      expect(sql).toMatch(/"?status"?\s*=\s*\?/);
      expect(sql).toMatch(/^DELETE/);
    });
  });

  describe('OR clause SQL — fortress isolation', () => {
    it('isolates OR conditions in brackets', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .where('item.priority = :priority', { priority: 'high' })
        .orWhere('item.active = true');

      const sql = qb.getSql();

      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);
      expect(sql).toContain('(');
      expect(sql).toContain(')');
    });
  });

  describe('cross-scope isolation', () => {
    it('generates identical SQL structure for different scope values', () => {
      const repo1 = new ScopedRepository(repository, {
        organisationId: 'org-1',
      });
      const repo2 = new ScopedRepository(repository, {
        organisationId: 'org-2',
      });

      const q1 = repo1
        .createQueryBuilder('item')
        .andWhere('item.active = true');
      const q2 = repo2
        .createQueryBuilder('item')
        .andWhere('item.active = true');

      expect(q1.getSql()).toBe(q2.getSql());

      expect(q1.getParameters().__scope_organisationId).toBe('org-1');
      expect(q2.getParameters().__scope_organisationId).toBe('org-2');
    });
  });

  describe('query complexity', () => {
    it('does not generate overly complex SQL', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .andWhere('item.batchId IS NULL')
        .andWhere('item.status = :status', { status: 'active' });

      const sql = qb.getSql();

      expect(sql.split('AND')).toHaveLength(3);
      expect(sql.split('WHERE')).toHaveLength(2);
    });
  });
});

describe('SQL Integration — composite scope', () => {
  let dataSource: DataSource;
  let repository: Repository<TestItemEntity>;
  let scoped: ScopedRepository<TestItemEntity>;

  const SCOPE: Scope = {
    accountId: 'default',
    ownerSpace: '10f5d88f294c',
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [TestItemEntity],
      synchronize: true,
      logging: false,
    });
    await dataSource.initialize();
    repository = dataSource.getRepository(TestItemEntity);
    scoped = new ScopedRepository(repository, SCOPE);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('applies both scope fields to SELECT', () => {
    const qb = scoped.createQueryBuilder('item');
    const sql = qb.getSql();

    expect(sql).toMatch(/"?item"?\."?account_id"?\s*=\s*\?/);
    expect(sql).toMatch(/"?item"?\."?owner_space"?\s*=\s*\?/);
  });

  it('applies both scope fields to UPDATE without duplication', () => {
    const qb = scoped
      .createQueryBuilder('item')
      .update(TestItemEntity)
      .set({ status: 'updated' })
      .where('batchId IS NULL');

    const sql = qb.getSql();

    const accountMatches = sql.match(/"?account_id"?\s*=\s*\?/g);
    const ownerMatches = sql.match(/"?owner_space"?\s*=\s*\?/g);

    expect(accountMatches).toHaveLength(1);
    expect(ownerMatches).toHaveLength(1);
    expect(sql).toMatch(/^UPDATE/);
  });

  it('applies both scope fields to DELETE without duplication', () => {
    const qb = scoped
      .createQueryBuilder('item')
      .delete()
      .where('status = :s', { s: 'old' });

    const sql = qb.getSql();

    const accountMatches = sql.match(/"?account_id"?\s*=\s*\?/g);
    const ownerMatches = sql.match(/"?owner_space"?\s*=\s*\?/g);

    expect(accountMatches).toHaveLength(1);
    expect(ownerMatches).toHaveLength(1);
    expect(sql).toMatch(/^DELETE/);
  });
});
