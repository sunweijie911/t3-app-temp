import { eq } from 'drizzle-orm';

import { DEFAULT_ENABLED_FIELDS } from '@/modules/info-collect/constants';
import type { InfoCollectConfigFields } from '@/modules/info-collect/schema';
import type { db } from '@/server/db';
import { infoCollectConfig } from '@/server/db/schema';

/** Shared config loader — single source of truth for default fallback */
export async function fetchInfoCollectConfig(database: typeof db) {
  const [row] = await database
    .select()
    .from(infoCollectConfig)
    .where(eq(infoCollectConfig.id, 'default'));
  return (
    row ?? {
      id: 'default' as const,
      bannerUrl: null,
      enabledFields: DEFAULT_ENABLED_FIELDS as InfoCollectConfigFields,
    }
  );
}
