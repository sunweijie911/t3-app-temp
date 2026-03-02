import 'server-only';
import { eq } from 'drizzle-orm';
import { cache } from 'react';
import { env } from '@/env';
import { db } from '@/server/db';
import { systemConfig } from '@/server/db/schema';

export async function getConfigValue(key: string): Promise<string | null> {
  try {
    const row = await db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, key))
      .limit(1);
    if (row.length > 0 && row[0]?.value != null) {
      const v = row[0]?.value;
      return typeof v === 'string' ? v : String(v);
    }
    return null;
  } catch (error) {
    // DB unavailable (e.g. CI build without database) – fall back to null
    // so callers use their env/default values.
    console.error('[config] getConfigValue failed for key:', key, error);
    return null;
  }
}

export async function getConfigString(
  key: string,
  fallback: string,
): Promise<string> {
  const value = await getConfigValue(key);
  return value ?? fallback;
}

/** Read the default module id from DB, falling back to the env var.
 *  Wrapped with React `cache()` to deduplicate within a single RSC render pass. */
export const getDefaultModuleId = cache(async (): Promise<string> => {
  const value = await getConfigValue('app.default_module');
  return value ?? env.NEXT_PUBLIC_DEFAULT_MODULE ?? 'lucky-wheel';
});
