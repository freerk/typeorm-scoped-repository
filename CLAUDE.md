# CLAUDE.md

## Project context

Extracted from a production NestJS multi-tenant API where it ran as a single-scope (`organisationId: string`) class. This package generalizes to `Scope = Record<string, string>` for composite scoping.

## Commands

```bash
npm test            # Jest (57 tests across 4 suites)
npm run build       # tsc -p tsconfig.build.json
npm run lint        # ESLint 9 (flat config, type-checked)
npm run format      # Prettier write
npm run format:check
```

## Source layout

```
src/
  index.ts                           # Core exports only
  scoped-repository.ts               # Core: ScopedRepository + fortress functions
  nestjs.ts                          # NestJS: module, decorator, factory type
  *.spec.ts                          # Tests (4 files)
docs/
  nestjs.md                          # NestJS usage guide for humans
```

Two published entrypoints:
- `typeorm-scoped-repository` — core, zero framework deps
- `typeorm-scoped-repository/nestjs` — optional, requires `@nestjs/common` + `@nestjs/typeorm` as peer deps

## Build setup

- `tsconfig.json` — includes specs (for IDE + ESLint)
- `tsconfig.build.json` — excludes specs (for `tsc` publish output)
- ESLint warnings in `applyFortressOverrides` and `createScopedQueryBuilder` are expected: `any` casts needed for TypeORM query builder internal API manipulation

## Architecture decisions to preserve

1. **Fortress is non-negotiable security.** `.where()` becomes `.andWhere()`. `.orWhere()` wraps in `Brackets`. Never weaken this.
2. **SELECT-to-UPDATE/DELETE transition.** When a SelectQueryBuilder transitions via `.update()` or `.delete()`, accumulated WHEREs must be cleared and scope re-applied in UPDATE/DELETE format (no alias, snake_case columns). Without this, scope conditions duplicate. The SQL integration tests prove this.
3. **Factory over request-scope (NestJS).** `ScopedRepositoryFactory<T>` is a singleton function. The `ScopedRepository` it returns is per-call. Never use NestJS request-scoped providers for this: it cascades through the entire DI chain.
4. **camelCase-to-snake_case in `buildScopeCondition`** assumes TypeORM's default naming strategy. Scope keys are camelCase (`organisationId`), column names are snake_case (`organisation_id`).
5. **Scope parameters use `__scope_` prefix** (e.g. `:__scope_organisationId`) to avoid collisions with user-provided query parameters.

## Traps to watch for

- **Double scope application.** The `__scopeApplied` flag on query builders prevents it. If you refactor the fortress functions, keep this guard.
- **TypeORM version differences.** Entity target detection in the constructor tries `.target`, `.metadata.target`, `.metadata.targetName` in order. Test mocks often lack these, so `withTransaction()` requires an explicit entity class fallback.
- **Empty scope.** `new ScopedRepository(repo, {})` is technically valid but adds no isolation. Consider whether a runtime guard is worth adding.

