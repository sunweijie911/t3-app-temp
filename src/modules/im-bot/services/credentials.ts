import { eq } from 'drizzle-orm';
import { env } from '@/env';
import { db } from '@/server/db';
import type { BotPlatform } from '../constants';
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
  /**
   * 机器人的 chatbotUserId（开发者后台机器人详情里，形如 `$:LWCP_v1:$xxx`）。
   * 配置后每条回调都会比对，用来抵消「钉钉签名不覆盖请求体」这一点。
   * 留空则跳过该校验，保持旧行为。
   */
  chatbotUserId?: string;
}

/**
 * 凭证缓存 TTL：10 分钟。
 * - 凭证轮换时多实例部署里其它实例无法收到 reloadBotConfig 广播，靠 TTL 兜底
 * - DB 单次 select 开销可忽略，但 webhook 高频调用时仍值得缓存
 */
const CREDENTIALS_TTL_MS = 10 * 60 * 1000;

/**
 * 一个平台在 bot_platform 表里的状态。
 *
 * 从「三份各自缓存 credentials 的 getter」收成一份行级缓存，是因为
 * `isActive` 也要在热路径上读：三份缓存意味着要么再加第四份缓存，
 * 要么每条 webhook 多一次 select。行本来就是一起读回来的。
 */
interface PlatformRow {
  credentials: Record<string, string>;
  /**
   * 后台的启停开关。以前这一列**只有 admin 在写、运行时无人读** ——
   * 把飞书关掉并保存，webhook 照样验签、照样调 LLM、照样写多维表，
   * 管理员以为停了其实没停。现在两个入口都会先查它。
   */
  isActive: boolean;
  /**
   * 这一行不携带任何配置：表里没有行，或者有行但 credentials 是空对象。
   *
   * 两者要同等对待。`upsertPlatform` 的 isActive 默认是 false，后台那个
   * Switch 的初始 state 也是 false —— 一次「打开页面就点保存」就会留下
   * 一行 `credentials={} isActive=false`。纯 env 配置飞书的部署恰好长这样，
   * 而这一行里的 `false` 不是管理员的决定，是默认值漏出来的。
   * 只看 isActive 会让这类部署在升级瞬间静默失联。
   *
   * 反过来也说得通：没有存任何凭证的平台，decode 阶段本来就会因为
   * 「凭证未配置」拒掉，所以"停用"它没有意义。
   */
  missing: boolean;
}

const cache = new Map<BotPlatform, { row: PlatformRow; expiresAt: number }>();
const inflight = new Map<BotPlatform, Promise<PlatformRow>>();
/**
 * 缓存代际。
 *
 * `resetCredentialsCache()` 清 map 是不够的：查询是在 map 之外的 promise
 * 里跑的，清空之后那个**在途**请求回来时照样会 `cache.set` —— 写回的是
 * 保存**之前**的行，还带一个新的 10 分钟 TTL。管理员在后台停用平台并保存，
 * 恰好撞上一条 webhook 正在读凭证，就会看到「点了停用但十分钟内毫无反应」，
 * 而且没有任何地方能看出为什么。带上代际号，过期的写回直接丢掉。
 */
let generation = 0;

async function getPlatformRow(platform: BotPlatform): Promise<PlatformRow> {
  const hit = cache.get(platform);
  if (hit && Date.now() < hit.expiresAt) return hit.row;
  const pending = inflight.get(platform);
  if (pending) return pending;

  const startedAt = generation;
  const task = (async () => {
    const [row] = await db
      .select({
        credentials: botPlatforms.credentials,
        isActive: botPlatforms.isActive,
      })
      .from(botPlatforms)
      .where(eq(botPlatforms.platform, platform))
      .limit(1);

    const credentials =
      (row?.credentials as Record<string, string> | null) ?? {};
    const resolved: PlatformRow = {
      credentials,
      isActive: row?.isActive ?? false,
      missing: !row || Object.keys(credentials).length === 0,
    };
    // 这次查询发起之后如果有人 reset 过缓存，说明配置已经变了，
    // 本次结果是旧的：照常返回给当前调用方，但**不写回缓存**
    if (startedAt === generation) {
      cache.set(platform, {
        row: resolved,
        expiresAt: Date.now() + CREDENTIALS_TTL_MS,
      });
    }
    return resolved;
  })().finally(() => {
    inflight.delete(platform);
  });

  inflight.set(platform, task);
  return task;
}

/**
 * 该平台是否处于启用状态。
 *
 * 表里没有这一行时返回 true：飞书可以纯用 env 配置（见下方 env 兜底），
 * 那种部署从来没往 bot_platform 写过行，按停用处理会让它在升级瞬间失联。
 * 存量部署的行则由迁移 0030 按「填过凭证 = 在用」补成 true。
 */
export async function isPlatformEnabled(
  platform: BotPlatform,
): Promise<boolean> {
  const row = await getPlatformRow(platform);
  return row.missing || row.isActive;
}

/**
 * 读取飞书凭证：优先 DB（botPlatforms.credentials），缺失字段回退到 env。
 * 配置变更时通过 resetCredentialsCache() 立即失效；同时有 10 分钟 TTL 兜底。
 */
export async function getFeishuCredentials(): Promise<FeishuCredentials> {
  const { credentials: c } = await getPlatformRow('feishu');
  return {
    appId: c.appId || env.IM_BOT_FEISHU_APP_ID || undefined,
    appSecret: c.appSecret || env.IM_BOT_FEISHU_APP_SECRET || undefined,
    encryptKey: c.encryptKey || env.IM_BOT_FEISHU_ENCRYPT_KEY || undefined,
    verificationToken:
      c.verificationToken || env.IM_BOT_FEISHU_VERIFICATION_TOKEN || undefined,
  };
}

/**
 * 读取企微凭证。与飞书不同，企微没有 env 兜底 —— 只从后台配置读，
 * 避免又开一批 env 变量却和 UI 两处配置容易不一致。
 */
export async function getWecomCredentials(): Promise<WecomCredentials> {
  const { credentials: c } = await getPlatformRow('wecom');
  return {
    corpId: c.corpId || undefined,
    botSecret: c.botSecret || undefined,
    botToken: c.botToken || undefined,
    encodingAesKey: c.encodingAesKey || undefined,
  };
}

/** 读取钉钉凭证。与企微一致：只从后台配置读，不开 env 兜底 */
export async function getDingtalkCredentials(): Promise<DingtalkCredentials> {
  const { credentials: c } = await getPlatformRow('dingtalk');
  return {
    appKey: c.appKey || undefined,
    appSecret: c.appSecret || undefined,
    robotCode: c.robotCode || undefined,
    botSecret: c.botSecret || undefined,
    chatbotUserId: c.chatbotUserId || undefined,
  };
}

export function resetCredentialsCache() {
  generation++;
  cache.clear();
  // 在途请求也要作废：它们的写回被代际号挡住了，但留着句柄会让
  // 紧随其后的调用复用这个**读的是旧配置**的 promise
  inflight.clear();
}
