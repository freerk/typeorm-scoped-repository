import { Repository } from 'typeorm';
import { ScopedRepository, Scope } from './scoped-repository';

/**
 * Fortress Pattern Security Tests
 *
 * Verifies that the scope filter cannot be bypassed via:
 * - OR clause injection
 * - WHERE override attempts
 * - Complex condition attacks (EXISTS, IN, HAVING)
 * - UPDATE/DELETE query attacks
 * - Method chaining attacks
 * - Edge cases and special characters
 */

interface TestEntity {
  id: string;
  organisationId?: string;
  batchId?: string;
  name: string;
  status?: string;
  createdAt?: Date;
  priority?: string;
  featured?: boolean;
  text?: string;
  urgent?: boolean;
}

const SCOPE: Scope = { organisationId: 'org-123' };
const MALICIOUS_ORG = 'malicious-org-456';

function makeMockUpdateBuilder(): jest.Mocked<any> {
  return {
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    expressionMap: { wheres: [] },
  };
}

function makeMockQueryBuilder(mockUpdateBuilder: jest.Mocked<any>) {
  return {
    andWhere: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnValue(mockUpdateBuilder),
    delete: jest.fn().mockReturnValue(mockUpdateBuilder),
    set: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    orHaving: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getRawOne: jest.fn().mockResolvedValue(null),
    getRawMany: jest.fn().mockResolvedValue([]),
    expressionMap: { wheres: [] },
    constructor: { name: 'SelectQueryBuilder' },
  };
}

describe('Fortress Pattern — OR clause attack vectors', () => {
  let mockQb: ReturnType<typeof makeMockQueryBuilder>;
  let scoped: ScopedRepository<TestEntity>;

  beforeEach(() => {
    const mockUpdate = makeMockUpdateBuilder();
    mockQb = makeMockQueryBuilder(mockUpdate);
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as unknown as Repository<TestEntity>;
    scoped = new ScopedRepository(repo, SCOPE);
  });

  it('prevents OR clause bypass attempts', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('e.batchId IS NULL')
      .orWhere(`e.organisationId = '${MALICIOUS_ORG}'`)
      .getMany();

    // Scope applied first
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );

    // OR clause wrapped in Brackets (not a bare orWhere)
    expect(mockQb.andWhere).toHaveBeenCalledWith(expect.any(Object));
    expect(mockQb.getMany).toHaveBeenCalled();
  });

  it('handles complex OR conditions safely', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('e.status = :status', { status: 'active' })
      .orWhere('e.priority = :priority', { priority: 'high' })
      .orWhere('e.createdAt > :date', { date: new Date() })
      .getCount();

    // Scope first, then WHERE->andWhere, then 2x OR->Brackets
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );

    // WHERE converted to andWhere
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(2, 'e.status = :status', {
      status: 'active',
    });

    // Each OR wrapped in Brackets
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ '@instanceof': Symbol.for('Brackets') }),
    );
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ '@instanceof': Symbol.for('Brackets') }),
    );
  });
});

describe('Fortress Pattern — WHERE override attack vectors', () => {
  let mockQb: ReturnType<typeof makeMockQueryBuilder>;
  let scoped: ScopedRepository<TestEntity>;

  beforeEach(() => {
    const mockUpdate = makeMockUpdateBuilder();
    mockQb = makeMockQueryBuilder(mockUpdate);
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as unknown as Repository<TestEntity>;
    scoped = new ScopedRepository(repo, SCOPE);
  });

  it('prevents direct WHERE override attempts', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('1=1')
      .where(`organisationId = '${MALICIOUS_ORG}'`)
      .getMany();

    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
    // Both .where() calls converted to .andWhere()
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(2, '1=1', undefined);
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      3,
      `organisationId = '${MALICIOUS_ORG}'`,
      undefined,
    );
    expect(mockQb.andWhere).toHaveBeenCalledTimes(3);
  });

  it('prevents chained WHERE + OR bypass', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('e.text IS NOT NULL')
      .andWhere('1=1')
      .orWhere('e.organisationId IN (SELECT id FROM organisations)')
      .getMany();

    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
    // WHERE -> andWhere
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      2,
      'e.text IS NOT NULL',
      undefined,
    );
    // direct andWhere passes through
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(3, '1=1');
    // OR wrapped in Brackets
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ '@instanceof': Symbol.for('Brackets') }),
    );
    expect(mockQb.andWhere).toHaveBeenCalledTimes(4);
  });
});

describe('Fortress Pattern — complex condition attack vectors', () => {
  let mockQb: ReturnType<typeof makeMockQueryBuilder>;
  let scoped: ScopedRepository<TestEntity>;

  beforeEach(() => {
    const mockUpdate = makeMockUpdateBuilder();
    mockQb = makeMockQueryBuilder(mockUpdate);
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as unknown as Repository<TestEntity>;
    scoped = new ScopedRepository(repo, SCOPE);
  });

  it('handles EXISTS subquery bypass attempts', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('e.batchId IS NULL')
      .where('EXISTS (SELECT 1 FROM batches WHERE batches.id = e.batchId)')
      .getMany();

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
    expect(mockQb.andWhere).toHaveBeenCalledTimes(3);
  });

  it('handles IN clause bypass attempts', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('e.organisationId IN (:...orgIds)', {
        orgIds: ['org-123', MALICIOUS_ORG],
      })
      .getMany();

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
    // IN clause becomes andWhere, not replacing scope
    expect(mockQb.andWhere).toHaveBeenCalledTimes(2);
  });

  it('does not convert HAVING to WHERE', async () => {
    await scoped
      .createQueryBuilder('e')
      .select('e.organisationId')
      .groupBy('e.organisationId')
      .having('COUNT(*) > 0')
      .orHaving(`e.organisationId = '${MALICIOUS_ORG}'`)
      .getMany();

    // Scope applied via andWhere only
    expect(mockQb.andWhere).toHaveBeenCalledTimes(1);
    expect(mockQb.having).toHaveBeenCalled();
    expect(mockQb.orHaving).toHaveBeenCalled();
  });
});

describe('Fortress Pattern — UPDATE/DELETE transition', () => {
  let mockQb: ReturnType<typeof makeMockQueryBuilder>;
  let mockUpdateBuilder: ReturnType<typeof makeMockUpdateBuilder>;
  let scoped: ScopedRepository<TestEntity>;

  beforeEach(() => {
    mockUpdateBuilder = makeMockUpdateBuilder();
    mockQb = makeMockQueryBuilder(mockUpdateBuilder);
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as unknown as Repository<TestEntity>;
    scoped = new ScopedRepository(repo, SCOPE);
  });

  it('applies scope to UPDATE builder after transition', async () => {
    await scoped
      .createQueryBuilder('e')
      .update()
      .set({ batchId: 'malicious-batch' })
      .where('e.batchId IS NULL')
      .orWhere(`e.organisationId = '${MALICIOUS_ORG}'`)
      .execute();

    // Update builder gets scope in UPDATE format (snake_case, no alias)
    expect(mockUpdateBuilder.andWhere).toHaveBeenCalledWith(
      'organisation_id = :__scope_organisationId',
      { __scope_organisationId: 'org-123' },
    );

    // WHERE->andWhere + OR->Brackets on the update builder
    expect(mockUpdateBuilder.andWhere).toHaveBeenCalledTimes(3);
    expect(mockUpdateBuilder.set).toHaveBeenCalledWith({
      batchId: 'malicious-batch',
    });
  });

  it('applies scope to DELETE builder after transition', async () => {
    await scoped
      .createQueryBuilder('e')
      .delete()
      .where('status = :status', { status: 'obsolete' })
      .execute();

    // Delete builder gets scope in DELETE format
    expect(mockUpdateBuilder.andWhere).toHaveBeenCalledWith(
      'organisation_id = :__scope_organisationId',
      { __scope_organisationId: 'org-123' },
    );

    // scope + WHERE->andWhere
    expect(mockUpdateBuilder.andWhere).toHaveBeenCalledTimes(2);
  });

  it('clears accumulated WHEREs from SELECT phase on UPDATE transition', () => {
    // The expressionMap.wheres should be cleared when transitioning
    (mockQb.expressionMap as any).wheres = [
      { type: 'and', condition: 'old condition' },
    ];

    scoped.createQueryBuilder('e').update();

    expect(mockUpdateBuilder.expressionMap.wheres).toEqual([]);
  });
});

describe('Fortress Pattern — composite scope', () => {
  const compositeScope: Scope = {
    accountId: 'default',
    ownerSpace: '10f5d88f294c',
  };

  let mockQb: ReturnType<typeof makeMockQueryBuilder>;
  let mockUpdateBuilder: ReturnType<typeof makeMockUpdateBuilder>;
  let scoped: ScopedRepository<TestEntity>;

  beforeEach(() => {
    mockUpdateBuilder = makeMockUpdateBuilder();
    mockQb = makeMockQueryBuilder(mockUpdateBuilder);
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as unknown as Repository<TestEntity>;
    scoped = new ScopedRepository(repo, compositeScope);
  });

  it('applies all composite scope fields to SELECT', () => {
    scoped.createQueryBuilder('e');

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      'e.accountId = :__scope_accountId AND e.ownerSpace = :__scope_ownerSpace',
      { __scope_accountId: 'default', __scope_ownerSpace: '10f5d88f294c' },
    );
  });

  it('applies all composite scope fields to UPDATE transition', () => {
    scoped.createQueryBuilder('e').update();

    expect(mockUpdateBuilder.andWhere).toHaveBeenCalledWith(
      'account_id = :__scope_accountId AND owner_space = :__scope_ownerSpace',
      { __scope_accountId: 'default', __scope_ownerSpace: '10f5d88f294c' },
    );
  });

  it('fortress overrides still apply with composite scope', async () => {
    await scoped
      .createQueryBuilder('e')
      .where('e.name = :name', { name: 'test' })
      .orWhere('e.status = :s', { s: 'active' })
      .getMany();

    // Scope + WHERE->andWhere + OR->Brackets
    expect(mockQb.andWhere).toHaveBeenCalledTimes(3);

    // OR wrapped in Brackets
    expect(mockQb.andWhere).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ '@instanceof': Symbol.for('Brackets') }),
    );
  });
});

describe('Fortress Pattern — edge cases', () => {
  let mockQb: ReturnType<typeof makeMockQueryBuilder>;
  let scoped: ScopedRepository<TestEntity>;

  beforeEach(() => {
    const mockUpdate = makeMockUpdateBuilder();
    mockQb = makeMockQueryBuilder(mockUpdate);
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    } as unknown as Repository<TestEntity>;
    scoped = new ScopedRepository(repo, SCOPE);
  });

  it('applies scope with no user conditions', async () => {
    await scoped.createQueryBuilder('e').getMany();

    expect(mockQb.andWhere).toHaveBeenCalledTimes(1);
    expect(mockQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
  });

  it('handles null/undefined conditions gracefully', async () => {
    await scoped
      .createQueryBuilder('e')
      .where(null as any)
      .andWhere(undefined as any)
      .getMany();

    expect(mockQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
    expect(mockQb.getMany).toHaveBeenCalled();
  });

  it('handles special characters in parameters safely', async () => {
    const malicious = "'; DROP TABLE entities; --";

    await scoped
      .createQueryBuilder('e')
      .where('e.name = :name', { name: malicious })
      .getMany();

    expect(mockQb.andWhere).toHaveBeenCalledTimes(2);
  });

  it('handles long method chains safely', async () => {
    await scoped
      .createQueryBuilder('e')
      .select('e.id')
      .where('e.text IS NOT NULL')
      .andWhere('e.createdAt IS NOT NULL')
      .orWhere('e.batchId IN (:...ids)', { ids: ['b1', 'b2'] })
      .where('EXISTS (SELECT 1 FROM batches b WHERE b.id = e.batchId)')
      .having('COUNT(e.id) > 0')
      .orderBy('e.createdAt', 'DESC')
      .limit(100)
      .getMany();

    // scope(1) + WHERE->andWhere(2) + direct andWhere(3) + OR->Brackets(4) + WHERE->andWhere(5) = 5
    expect(mockQb.andWhere).toHaveBeenCalledTimes(5);
    expect(mockQb.select).toHaveBeenCalled();
    expect(mockQb.orderBy).toHaveBeenCalled();
    expect(mockQb.limit).toHaveBeenCalled();
  });
});
