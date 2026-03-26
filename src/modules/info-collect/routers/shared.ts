import { eq } from 'drizzle-orm';

import type { db } from '@/server/db';
import { infoCollectConfig } from '@/server/db/schema';

/** 配置加载器 — 返回 bannerUrl */
export async function fetchInfoCollectConfig(database: typeof db) {
  const [row] = await database
    .select()
    .from(infoCollectConfig)
    .where(eq(infoCollectConfig.id, 'default'));
  return row ?? { id: 'default' as const, bannerUrl: null };
}
