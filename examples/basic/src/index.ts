import { DataSource } from 'typeorm';
import { ScopedRepository } from 'typeorm-scoped-repository';
import { ArticleEntity } from './article.entity';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [ArticleEntity],
    synchronize: true,
  });

  await dataSource.initialize();
  console.log('Database initialized (in-memory SQLite)\n');

  const baseRepo = dataSource.getRepository(ArticleEntity);

  // ── 1. Scoped repositories: each org only sees its own data ──────────

  const org1Repo = new ScopedRepository(baseRepo, { organisationId: 'org-1' });
  const org2Repo = new ScopedRepository(baseRepo, { organisationId: 'org-2' });

  await org1Repo.save(org1Repo.create({ title: 'Org 1 — First', body: 'Hello from org-1' }));
  await org1Repo.save(org1Repo.create({ title: 'Org 1 — Second', body: 'Another org-1 article' }));
  await org2Repo.save(org2Repo.create({ title: 'Org 2 — First', body: 'Hello from org-2' }));

  const org1Articles = await org1Repo.find();
  const org2Articles = await org2Repo.find();

  console.log('=== Scope isolation ===');
  console.log(`org-1 sees ${org1Articles.length} article(s):`, org1Articles.map((a) => a.title));
  console.log(`org-2 sees ${org2Articles.length} article(s):`, org2Articles.map((a) => a.title));
  console.log();

  // ── 2. Fortress pattern: .where() cannot clear the scope ─────────────

  console.log('=== Fortress pattern (query builder) ===');
  const qb = org1Repo.createQueryBuilder('article');

  // This .where() is silently converted to .andWhere(), so the scope filter stays
  qb.where('article.title LIKE :pattern', { pattern: '%First%' });

  const fortressResult = await qb.getMany();
  console.log(
    'org1 query builder with .where("title LIKE First"):',
    fortressResult.map((a) => `${a.title} [${a.organisationId}]`),
  );
  console.log('(scope cannot be bypassed — org-2 articles are never returned)');
  console.log();

  // ── 3. Transactions ─────────────────────────────────────────────────

  console.log('=== Transaction support ===');
  await dataSource.transaction(async (manager) => {
    const txRepo = org1Repo.withTransaction(manager, ArticleEntity);
    await txRepo.save(txRepo.create({ title: 'Org 1 — Transaction', body: 'Created in tx' }));
    console.log('Saved article inside transaction');
  });

  const afterTx = await org1Repo.find();
  console.log(`org-1 now has ${afterTx.length} article(s) (including the one from tx)`);
  console.log();

  // ── 4. Count and findOne ─────────────────────────────────────────────

  console.log('=== count() and findOne() ===');
  const org1Count = await org1Repo.count();
  const org2Count = await org2Repo.count();
  console.log(`org-1 count: ${org1Count}, org-2 count: ${org2Count}`);

  const firstOrg2 = await org2Repo.findOne({ where: {} });
  console.log(`org-2 findOne:`, firstOrg2?.title ?? '(none)');
  console.log();

  // ── 5. withScope: layered scoping ───────────────────────────────────

  console.log('=== withScope (layered scoping) ===');
  const narrowRepo = org1Repo.withScope({ title: 'Org 1 — First' });
  const narrowResult = await narrowRepo.find();
  console.log(
    'org1 + title scope:',
    narrowResult.map((a) => a.title),
  );
  console.log();

  await dataSource.destroy();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
