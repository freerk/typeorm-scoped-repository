# NestJS Example

Minimal NestJS app demonstrating `typeorm-scoped-repository` with the NestJS integration module.

Shows: `ScopedRepositoryModule.forFeature()`, `@InjectScopedFactory()`, and scope-per-request via a header.

## Run

```bash
npm install
npm start
```

## Try it

```bash
# Create articles in two different organisations
curl -X POST -H "x-organisation-id: org-1" -H "Content-Type: application/json" \
  -d '{"title":"Org 1 Article","body":"Hello from org-1"}' \
  http://localhost:3000/articles

curl -X POST -H "x-organisation-id: org-2" -H "Content-Type: application/json" \
  -d '{"title":"Org 2 Article","body":"Hello from org-2"}' \
  http://localhost:3000/articles

# List articles — each org only sees its own
curl -H "x-organisation-id: org-1" http://localhost:3000/articles
# → [{"id":"...","organisationId":"org-1","title":"Org 1 Article",...}]

curl -H "x-organisation-id: org-2" http://localhost:3000/articles
# → [{"id":"...","organisationId":"org-2","title":"Org 2 Article",...}]
```

## Key files

| File | What it demonstrates |
|------|---------------------|
| `src/article/article.module.ts` | `ScopedRepositoryModule.forFeature([ArticleEntity])` |
| `src/article/article.service.ts` | `@InjectScopedFactory(ArticleEntity)` + factory usage |
| `src/article/article.controller.ts` | Scope from `x-organisation-id` header |
