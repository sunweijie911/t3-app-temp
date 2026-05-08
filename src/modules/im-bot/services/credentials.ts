import { eq } from 'drizzle-orm';
import { env } from '@/env';
import { db } from '@/server/db';
import { botPlatforms } from '../schema';

export interface FeishuCredentials {
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
}

let feishuCache: FeishuCredentials | null = null;
let feishuPromise: Promise<FeishuCredentials> | null = null;

/**
 * 读取飞书凭证：优先 DB（botPlatforms.credentials），缺失字段回退到 env。
 * 配置变更时通过 resetCredentialsCache() 失效。
 */
export async function getFeishuCredentials(): Promise<FeishuCredentials> {
  if (feishuCache) return feishuCache;
  if (feishuPromise) return feishuPromise;

  feishuPromise = (async () => {
    const [row] = await db
      .select()
      .from(botPlatforms)
      .where(eq(botPlatforms.platform, 'feishu'))
      .limit(1);

    const dbCreds = (row?.credentials as Record<string, string> | null) ?? {};

    const merged: FeishuCredentials = {
      appId: dbCreds.appId || env.IM_BOT_FEISHU_APP_ID || undefined,
      appSecret: dbCreds.appSecret || env.IM_BOT_FEISHU_APP_SECRET || undefined,
      encryptKey:
        dbCreds.encryptKey || env.IM_BOT_FEISHU_ENCRYPT_KEY || undefined,
      verificationToken:
        dbCreds.verificationToken ||
        env.IM_BOT_FEISHU_VERIFICATION_TOKEN ||
        undefined,
    };

    feishuCache = merged;
    return merged;
  })().finally(() => {
    feishuPromise = null;
  });

  return feishuPromise;
}

export function resetCredentialsCache() {
  feishuCache = null;
}
