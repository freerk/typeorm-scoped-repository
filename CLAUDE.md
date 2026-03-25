# typeorm-scoped-repository

## What this is

Standalone npm package extracting the `ScopedRepository` pattern from [whisperline-api](~/Workspace/Whisperline/software/whisperline-api/src/common/persistence/scoped-repository.ts). Wraps a TypeORM `Repository<T>` and injects scope fields (organisation, user, agent, tenant) as WHERE conditions on every query. The **fortress pattern** prevents accidental scope bypass by converting `.where()` to `.andWhere()` on query builders.

## Reference implementation

The battle-tested original lives at:
- Source: `~/Workspace/Whisperline/software/whisperline-api/src/common/persistence/scoped-repository.ts`
- Tests: same directory, 4 files (`*.spec.ts`, `*.fortress.spec.ts`, `*.sql.spec.ts`, `*.query.spec.ts`)
- Usage examples: `batch.service.ts`, `clustering.service.ts`, `whisper.repository.ts`

Key difference: the reference uses `organisationId: string` (single scope). This package generalizes to `Scope = Record<string, string>` (composite scope).

## Source layout

```
src/
  index.ts                  # Public exports: ScopedRepository, Scope
  scoped-repository.ts      # Core implementation + fortress pattern
  scoped-repository.spec.ts # Tests
```

Single-file library. Keep it that way unless complexity demands splitting.

## Stack

- TypeScript (strict mode, all strict flags enabled)
- TypeORM >=0.3.0 as peer dependency
- Jest + ts-jest for testing
- ESLint 9 (flat config) + Prettier

## Commands

```bash
npm test          # Run all tests
npm run build     # Compile to dist/
npm run lint      # ESLint
npm run format    # Prettier write
npm run format:check  # Prettier check (CI)
```

## Architecture decisions

- **Scope is `Record<string, string>`**: supports single-field (`{ organisationId }`) and composite (`{ accountId, ownerSpace }`) scoping
- **Fortress pattern**: `.where()` becomes `.andWhere()`, `.orWhere()` wraps in `Brackets`. This is non-negotiable security
- **SELECT-to-UPDATE/DELETE transition**: when a SelectQueryBuilder transitions via `.update()` or `.delete()`, the wrapper must clear accumulated WHEREs, re-apply scope in the correct format (no alias), and re-apply fortress overrides. Port this from the reference implementation
- **No NestJS dependency**: framework-agnostic core. NestJS helpers (decorators, module) can be added later as optional exports
- **`withScope()`**: layered scoping not in the original, returns new instance with merged scope
- **`withTransaction()`**: preserves scope across EntityManager transactions

## Known gaps (vs reference)

- The reference's `orWhere` override uses `qb.orWhere()` inside Brackets (original method on inner QB), while this package uses `inner.andWhere()`. Both isolate the condition, but match the reference for consistency

## Type safety notes

- `T extends Record<string, any>` on ScopedRepository is a TypeORM constraint (`ObjectLiteral`). Cannot avoid the `any` here
- Fortress functions require `any` casts for TypeORM internal API manipulation. Minimize but accept where unavoidable. Use `eslint-disable` with specific rules only on those lines
- camelCase-to-snake_case conversion in `buildScopeCondition` assumes TypeORM's default naming strategy. Document this assumption
