import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log('[migrate] DATABASE_URL not set, skipping migrations');
  process.exit(0);
}

const sql = postgres(DATABASE_URL, { max: 1 });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      created_at BIGINT
    )
  `;

  const migrationsDir = './drizzle';
  const journalPath = join(migrationsDir, 'meta', '_journal.json');

  if (!existsSync(journalPath)) {
    console.log('[migrate] No migration journal found, skipping');
    process.exit(0);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf-8'));
  const entries = journal.entries || [];
  let applied = 0;

  for (const entry of entries) {
    const hash = entry.tag;
    const existing =
      await sql`SELECT 1 FROM "__drizzle_migrations" WHERE hash = ${hash}`;

    if (existing.length === 0) {
      const sqlFile = join(migrationsDir, `${entry.tag}.sql`);
      const content = readFileSync(sqlFile, 'utf-8');
      const statements = content
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      // 单个迁移文件的所有语句 + hash 写入包进同一事务，
      // 保证原子性：中途任意一条失败则整体回滚，容器重启可安全重放，
      // 避免出现 DDL 半应用但 hash 未记录、重跑必报 already exists 卡死的情况。
      await sql.begin(async (tx) => {
        for (const stmt of statements) {
          await tx.unsafe(stmt);
        }
        await tx`INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (${hash}, ${Date.now()})`;
      });
      console.log(`[migrate] Applied: ${entry.tag}`);
      applied++;
    }
  }

  console.log(
    applied > 0
      ? `[migrate] Done, ${applied} migration(s) applied`
      : '[migrate] Database is up to date',
  );
} catch (error) {
  console.error('[migrate] Migration failed:', error);
  process.exit(1);
} finally {
  await sql.end();
}
