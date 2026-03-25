# typeorm-scoped-repository

TypeORM `ScopedRepository` with **fortress pattern** for NestJS — automatic multi-scope isolation on every query. No raw SQL, no forgotten WHERE clauses, no cross-tenant data leaks.

## Features

- **Automatic scope injection** — every `find`, `findOne`, `save`, `update`, `delete` gets the scope fields added as WHERE conditions
- **Fortress pattern** — `.where()` is silently converted to `.andWhere()` on query builders, so scope filters cannot be accidentally cleared
- **Composite scopes** — scope on any combination of fields (`organisationId`, `userId + agentId`, `accountId + ownerSpace`, etc.)
- **Layered scoping** — add scope fields progressively with `withScope()`
- **Transaction support** — `withTransaction(manager)` maintains scope inside transactions
- TypeScript-first, zero magic

## Install

```bash
npm install typeorm-scoped-repository
```

## Usage

### Single scope (organisation isolation)

```typescript
import { ScopedRepository } from 'typeorm-scoped-repository';

@Injectable()
export class WhisperService {
  constructor(
    @InjectRepository(WhisperEntity)
    private readonly _repo: Repository<WhisperEntity>,
  ) {}

  private repo(organisationId: string) {
    return new ScopedRepository(this._repo, { organisationId });
  }

  async findAll(organisationId: string) {
    return this.repo(organisationId).find();
    // Executes: SELECT * FROM whispers WHERE organisation_id = $1
  }

  async create(organisationId: string, data: Partial<WhisperEntity>) {
    return this.repo(organisationId).save(data as WhisperEntity);
    // Always stamps organisationId — cannot forget it
  }
}
```

### Composite scope (viking-ts pattern: user + agent)

```typescript
const agentSpace = md5(`${userId}:${agentId}`).slice(0, 12);

const repo = new ScopedRepository(contextVectorRepo, {
  accountId: 'default',
  ownerSpace: agentSpace,
});

// All queries: WHERE account_id = 'default' AND owner_space = 'a3f9c2b1e8d4'
const records = await repo.find();
```

### Layered scoping

```typescript
// Base scope — account level
const accountRepo = new ScopedRepository(repo, { accountId: 'acme' });

// Add agent scope on top
const agentRepo = accountRepo.withScope({ ownerSpace: '10f5d88f294c' });

// agentRepo: WHERE account_id = 'acme' AND owner_space = '10f5d88f294c'
// accountRepo unchanged: WHERE account_id = 'acme'
```

### Fortress pattern (query builder)

```typescript
const qb = repo.createQueryBuilder('entity');
// Scope already applied: WHERE entity.organisation_id = 'org-123'

qb.where('entity.name = :name', { name: 'test' });
// Safe! .where() is converted to .andWhere() — scope NOT cleared
// Final: WHERE entity.organisation_id = 'org-123' AND entity.name = 'test'
```

### Transactions

```typescript
await dataSource.transaction(async (manager) => {
  const txRepo = myRepo.withTransaction(manager);
  // Same scope, within the transaction
  await txRepo.save(entity);
});
```

## API

### `new ScopedRepository<T>(repo, scope)`

| Parameter | Type | Description |
|---|---|---|
| `repo` | `Repository<T>` | TypeORM repository |
| `scope` | `Scope` | `Record<string, string>` of field names to values |

### Methods

| Method | Description |
|---|---|
| `find(options?)` | Find all matching records (scope always applied) |
| `findOne(options)` | Find one record (scope always applied) |
| `save(entity)` | Save with scope fields stamped |
| `create(data)` | Create entity instance with scope fields |
| `update(id, partial)` | Update by id within scope |
| `delete(id)` | Delete by id within scope |
| `count(options?)` | Count within scope |
| `createQueryBuilder(alias)` | Fortress-wrapped query builder |
| `withScope(additionalScope)` | Returns new repo with extended scope |
| `withTransaction(manager, entityClass?)` | Returns new repo using transaction manager |
| `getScope()` | Returns a readonly copy of the current scope |

## Motivation

This package was extracted from [whisperline-api](https://github.com/Whisperline/whisperline-api), a production NestJS application with strict organisation-level data isolation. The pattern proved robust enough to generalise for any multi-scope use case.

## License

MIT
