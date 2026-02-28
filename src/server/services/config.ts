import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { systemConfig } from '@/server/db/schema';

export async function getConfigValue(key: string): Promise<string | null> {
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
}

export async function getConfigString(
  key: string,
  fallback: string,
): Promise<string> {
  const value = await getConfigValue(key);
  return value ?? fallback;
}
