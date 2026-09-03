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

export interface WecomCredentials {
  corpId?: string;
  /** 应用 secret，用于换 access_token */
  botSecret?: string;
  /** 回调验签用的 Token */
  botToken?: string;
  /** 回调消息加解密密钥（43 位） */
  encodingAesKey?: string;
}

export interface DingtalkCredentials {
  appKey?: string;
  appSecret?: string;
  /** 机器人 robotCode，用于剥离正文里的 @机器人 前缀 */
  robotCode?: string;
  /** 群机器人加签密钥，用于 HTTP 回调验签 */
  botSecret?: string;
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

let wecomCache: WecomCredentials | null = null;
let wecomCacheExpiresAt = 0;
let wecomPromise: Promise<WecomCredentials> | null = null;

let dingtalkCache: DingtalkCredentials | null = null;
let dingtalkCacheExpiresAt = 0;
let dingtalkPromise: Promise<DingtalkCredentials> | null = null;

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

/**
 * 读取企微凭证。与飞书不同，企微没有 env 兜底 —— 只从后台配置读，
 * 避免又开一批 env 变量却和 UI 两处配置容易不一致。
 */
export async function getWecomCredentials(): Promise<WecomCredentials> {
  if (wecomCache && Date.now() < wecomCacheExpiresAt) return wecomCache;
  if (wecomPromise) return wecomPromise;

  wecomPromise = (async () => {
    const [row] = await db
      .select()
      .from(botPlatforms)
      .where(eq(botPlatforms.platform, 'wecom'))
      .limit(1);

    const c = (row?.credentials as Record<string, string> | null) ?? {};
    const merged: WecomCredentials = {
      corpId: c.corpId || undefined,
      botSecret: c.botSecret || undefined,
      botToken: c.botToken || undefined,
      encodingAesKey: c.encodingAesKey || undefined,
    };
    wecomCache = merged;
    wecomCacheExpiresAt = Date.now() + CREDENTIALS_TTL_MS;
    return merged;
  })().finally(() => {
    wecomPromise = null;
  });

  return wecomPromise;
}

/** 读取钉钉凭证。与企微一致：只从后台配置读，不开 env 兜底 */
export async function getDingtalkCredentials(): Promise<DingtalkCredentials> {
  if (dingtalkCache && Date.now() < dingtalkCacheExpiresAt) {
    return dingtalkCache;
  }
  if (dingtalkPromise) return dingtalkPromise;

  dingtalkPromise = (async () => {
    const [row] = await db
      .select()
      .from(botPlatforms)
      .where(eq(botPlatforms.platform, 'dingtalk'))
      .limit(1);

    const c = (row?.credentials as Record<string, string> | null) ?? {};
    const merged: DingtalkCredentials = {
      appKey: c.appKey || undefined,
      appSecret: c.appSecret || undefined,
      robotCode: c.robotCode || undefined,
      botSecret: c.botSecret || undefined,
    };
    dingtalkCache = merged;
    dingtalkCacheExpiresAt = Date.now() + CREDENTIALS_TTL_MS;
    return merged;
  })().finally(() => {
    dingtalkPromise = null;
  });

  return dingtalkPromise;
}

export function resetCredentialsCache() {
  feishuCache = null;
  feishuCacheExpiresAt = 0;
  wecomCache = null;
  wecomCacheExpiresAt = 0;
  dingtalkCache = null;
  dingtalkCacheExpiresAt = 0;
}
