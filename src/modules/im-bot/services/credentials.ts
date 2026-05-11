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

/**
 * 凭证缓存 TTL：10 分钟。
 * - 凭证轮换时多实例部署里其它实例无法收到 reloadBotConfig 广播，靠 TTL 兜底
 * - DB 单次 select 开销可忽略，但 webhook 高频调用时仍值得缓存
 */
const CREDENTIALS_TTL_MS = 10 * 60 * 1000;

let feishuCache: FeishuCredentials | null = null;
let feishuCacheExpiresAt = 0;
let feishuPromise: Promise<FeishuCredentials> | null = null;

/**
 * 读取飞书凭证：优先 DB（botPlatforms.credentials），缺失字段回退到 env。
 * 配置变更时通过 resetCredentialsCache() 立即失效；同时有 10 分钟 TTL 兜底。
 */
export async function getFeishuCredentials(): Promise<FeishuCredentials> {
  if (feishuCache && Date.now() < feishuCacheExpiresAt) return feishuCache;
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
    feishuCacheExpiresAt = Date.now() + CREDENTIALS_TTL_MS;
    return merged;
  })().finally(() => {
    feishuPromise = null;
  });

  return feishuPromise;
}

export function resetCredentialsCache() {
  feishuCache = null;
  feishuCacheExpiresAt = 0;
}
