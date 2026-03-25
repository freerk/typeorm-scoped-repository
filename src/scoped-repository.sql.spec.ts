import {
  DataSource,
  Repository,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { ScopedRepository, Scope } from './scoped-repository';

@Entity('test_categories')
class TestCategoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organisation_id' })
  organisationId!: string;

  @Column({ nullable: true })
  name!: string;

  @Column({ nullable: true })
  status!: string;

  @OneToMany(() => TestItemEntity, (item) => item.category)
  items!: TestItemEntity[];
}

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

  @Column({ name: 'category_id', nullable: true })
  categoryId!: string;

  @ManyToOne(() => TestCategoryEntity, (cat) => cat.items, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category!: TestCategoryEntity;

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
      entities: [TestItemEntity, TestCategoryEntity],
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
        .andWhere('item.categoryId IS NULL');

      const sql = qb.getSql();
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);
      expect(sql).toMatch(/"?category_id"?\s+IS\s+NULL/);

      const params = qb.getParameters();
      expect(params.__scope_organisationId).toBe('org-123');
    });

    it('generates correct SQL with date filter', () => {
      const endDate = new Date('2024-01-01');
      const qb = scoped
        .createQueryBuilder('item')
        .andWhere('item.categoryId IS NULL')
        .andWhere('item.createdAt <= :endDate', { endDate });

      const sql = qb.getSql();
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);
      expect(sql).toMatch(/"?category_id"?\s+IS\s+NULL/);
      expect(sql).toMatch(/"?item"?\."?created_at"?\s*<=\s*\?/);
    });
  });

  describe('UPDATE queries — THE CRITICAL TEST', () => {
    it('generates UPDATE SQL without duplicate scope conditions', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .update(TestItemEntity)
        .set({ categoryId: 'cat-1' })
        .andWhere('categoryId IS NULL');

      const sql = qb.getSql();

      // CRITICAL: exactly ONE scope condition, not two
      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      expect(sql).toMatch(/"?category_id"?\s+IS\s+NULL/);
      expect(sql).toMatch(/^UPDATE/);
      expect(sql).toContain('SET');
      expect(sql).toContain('WHERE');
    });

    it('handles .where() on UPDATE correctly (the original bug pattern)', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .update(TestItemEntity)
        .set({ categoryId: 'cat-2' })
        .where('categoryId IS NULL');

      const sql = qb.getSql();

      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      // Should not have both aliased and unaliased scope conditions
      expect(sql).not.toMatch(
        /"?item"?\."?organisation_id"?.*"?organisation_id"?/,
      );

      expect(sql).toMatch(/"?category_id"?\s+IS\s+NULL/);
    });

    it('handles UPDATE with date conditions', () => {
      const endDate = new Date('2024-01-01');
      const qb = scoped
        .createQueryBuilder('item')
        .update(TestItemEntity)
        .set({ categoryId: 'cat-3' })
        .andWhere('categoryId IS NULL')
        .andWhere('createdAt <= :endDate', { endDate });

      const sql = qb.getSql();

      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);

      expect(sql).toMatch(/"?category_id"?\s+IS\s+NULL/);
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
        .andWhere('item.categoryId IS NULL')
        .andWhere('item.status = :status', { status: 'active' });

      const sql = qb.getSql();

      expect(sql.split('AND')).toHaveLength(3);
      expect(sql.split('WHERE')).toHaveLength(2);
    });
  });

  describe('JOIN queries', () => {
    it('scope applies only to main entity, not to joined table', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'cat');

      const sql = qb.getSql();

      // Scope on main entity
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);

      // JOIN present
      expect(sql).toMatch(/LEFT JOIN/i);
      expect(sql).toMatch(/"?test_categories"?/);

      // Scope should NOT appear on the joined table
      expect(sql).not.toMatch(/"?cat"?\."?organisation_id"?\s*=\s*\?/);
    });

    it('leftJoin with additional WHERE on joined table works alongside scope', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'cat')
        .andWhere('cat.status = :catStatus', { catStatus: 'open' });

      const sql = qb.getSql();

      // Scope on main entity
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);

      // User condition on joined table
      expect(sql).toMatch(/"?cat"?\."?status"?\s*=\s*\?/);

      // Both conditions in same WHERE clause
      expect(sql.split('WHERE')).toHaveLength(2);

      const params = qb.getParameters();
      expect(params.__scope_organisationId).toBe('org-123');
      expect(params.catStatus).toBe('open');
    });

    it('innerJoin works with scope', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .innerJoinAndSelect('item.category', 'cat');

      const sql = qb.getSql();

      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);
      expect(sql).toMatch(/INNER JOIN/i);
    });

    it('leftJoin with ON condition does not interfere with scope', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .leftJoin(
          'test_categories',
          'cat',
          'cat.id = item.category_id AND cat.status = :s',
          { s: 'active' },
        );

      const sql = qb.getSql();

      // Scope in WHERE
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);

      // Custom ON condition separate from WHERE
      expect(sql).toMatch(/LEFT JOIN/i);
      expect(sql).toMatch(/"?cat"?\."?status"?\s*=\s*\?/);
    });

    it('.where() after JOIN is still converted to .andWhere() (fortress)', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'cat')
        .where('cat.name = :catName', { catName: 'Q1' })
        .andWhere('item.status = :status', { status: 'active' });

      const sql = qb.getSql();

      // Scope still present
      expect(sql).toMatch(/"?item"?\."?organisation_id"?\s*=\s*\?/);

      // Both user conditions present (WHERE was converted to AND, not replacing scope)
      expect(sql).toMatch(/"?cat"?\."?name"?\s*=\s*\?/);
      expect(sql).toMatch(/"?item"?\."?status"?\s*=\s*\?/);

      // Single WHERE clause with all conditions ANDed
      expect(sql.split('WHERE')).toHaveLength(2);
    });

    it('subquery join does not leak scope', () => {
      const qb = scoped
        .createQueryBuilder('item')
        .leftJoinAndSelect('item.category', 'cat')
        .andWhere('item.categoryId IS NOT NULL')
        .addSelect('cat.name');

      const sql = qb.getSql();

      // Exactly one scope condition in the entire query
      const scopeMatches = sql.match(/"?organisation_id"?\s*=\s*\?/g);
      expect(scopeMatches).toHaveLength(1);
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
      entities: [TestItemEntity, TestCategoryEntity],
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
      .where('categoryId IS NULL');

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
