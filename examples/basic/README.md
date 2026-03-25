# Basic Example

Plain TypeScript + TypeORM + SQLite example, no framework. Demonstrates scoped queries, the fortress pattern, transactions, and layered scoping.

## Run

```bash
npm install
npm run demo
```

## What it shows

| Feature | What happens |
|---------|-------------|
| Scope isolation | Two `ScopedRepository` instances (org-1, org-2) share one table but only see their own rows |
| Fortress pattern | `.where()` on a scoped query builder is converted to `.andWhere()`, preventing scope bypass |
| Transactions | `withTransaction()` creates a scoped repo inside a transaction manager |
| `count()` / `findOne()` | Scope is applied to all read methods |
| `withScope()` | Layered scoping: narrow an existing scope with additional fields |
