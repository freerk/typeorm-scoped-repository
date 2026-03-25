import { ScopedRepository, Scope } from './scoped-repository';
import { Repository } from 'typeorm';

// Minimal mock entity
interface TestEntity {
  id: string;
  organisationId?: string;
  ownerSpace?: string;
  name: string;
}

function makeRepo(
  overrides: Partial<Repository<TestEntity>> = {},
): Repository<TestEntity> {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    create: jest.fn().mockImplementation((e) => e),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    increment: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue({
      __scopeApplied: false,
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      expressionMap: { wheres: [] },
      constructor: { name: 'SelectQueryBuilder' },
    }),
    ...overrides,
  } as unknown as Repository<TestEntity>;
}

describe('ScopedRepository — single scope', () => {
  const scope: Scope = { organisationId: 'org-123' };

  it('injects scope into find()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.find();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organisationId: 'org-123' } }),
    );
  });

  it('injects scope into findOne()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.findOne({ where: { name: 'test' } as any });
    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { name: 'test', organisationId: 'org-123' },
      }),
    );
  });

  it('injects scope into save()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.save({ id: '1', name: 'test' } as TestEntity);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: 'org-123' }),
      undefined,
    );
  });

  it('injects scope into create()', () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    scoped.create({ name: 'test' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organisationId: 'org-123' }),
    );
  });

  it('injects scope into update()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.update('1', { name: 'updated' } as Partial<TestEntity>);
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', organisationId: 'org-123' }),
      expect.anything(),
    );
  });

  it('injects scope into delete()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.delete('1');
    expect(repo.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', organisationId: 'org-123' }),
    );
  });

  it('injects scope into increment()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.increment({ status: 'active' } as any, 'viewCount', 1);
    expect(repo.increment).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', organisationId: 'org-123' }),
      'viewCount',
      1,
    );
  });

  it('exposes scope via getScope()', () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    expect(scoped.getScope()).toEqual({ organisationId: 'org-123' });
  });

  it('prevents mutation of scope via getScope()', () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    const s = scoped.getScope();
    (s as Record<string, string>)['organisationId'] = 'hacked';
    expect(scoped.getScope()).toEqual({ organisationId: 'org-123' });
  });
});

describe('ScopedRepository — composite scope (viking-ts pattern)', () => {
  const scope: Scope = {
    accountId: 'default',
    ownerSpace: '10f5d88f294c',
  };

  it('injects all scope fields into find()', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.find();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'default', ownerSpace: '10f5d88f294c' },
      }),
    );
  });

  it('merges caller where with all scope fields', async () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, scope);
    await scoped.find({ where: { name: 'test' } as any });
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: 'test',
          accountId: 'default',
          ownerSpace: '10f5d88f294c',
        },
      }),
    );
  });
});

describe('ScopedRepository — withScope() layered scoping', () => {
  it('extends scope without mutating original', async () => {
    const repo = makeRepo();
    const base = new ScopedRepository(repo, { accountId: 'acme' });
    const extended = base.withScope({ ownerSpace: 'abc123' });

    await extended.find();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acme', ownerSpace: 'abc123' },
      }),
    );

    // Original unchanged
    await base.find();
    const calls = (repo.find as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).toMatchObject({
      where: { accountId: 'acme' },
    });
    expect(calls[calls.length - 1][0].where).not.toHaveProperty('ownerSpace');
  });
});

describe('ScopedRepository — createQueryBuilder fortress', () => {
  it('applies scope to query builder via andWhere', () => {
    const mockQb = {
      __scopeApplied: false,
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      expressionMap: { wheres: [] },
      constructor: { name: 'SelectQueryBuilder' },
    };
    const repo = makeRepo({
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    });
    const scoped = new ScopedRepository(repo, { organisationId: 'org-123' });
    scoped.createQueryBuilder('entity');
    expect(mockQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('organisationId'),
      expect.objectContaining({ __scope_organisationId: 'org-123' }),
    );
  });
});

describe('ScopedRepository — withTransaction()', () => {
  it('throws when no entity target available and none provided', () => {
    const repo = makeRepo();
    const scoped = new ScopedRepository(repo, { organisationId: 'org-123' });
    const mockManager = { getRepository: jest.fn() } as any;
    expect(() => scoped.withTransaction(mockManager)).toThrow('entity target');
  });

  it('creates transactional repo with same scope', () => {
    const mockTransactionalRepo = makeRepo();
    const mockManager = {
      getRepository: jest.fn().mockReturnValue(mockTransactionalRepo),
    } as any;

    class FakeEntity {}
    const repo = makeRepo({ target: FakeEntity } as any);
    const scoped = new ScopedRepository(repo, { organisationId: 'org-123' });
    const txScoped = scoped.withTransaction(mockManager);

    expect(txScoped.getScope()).toEqual({ organisationId: 'org-123' });
  });
});
