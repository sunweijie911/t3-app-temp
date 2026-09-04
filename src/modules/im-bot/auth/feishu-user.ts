import { feishuTokenManager } from './feishu-token';

const NAME_TTL_MS = 60 * 60 * 1000;
// 失败/未命中的负缓存 60s，避免陌生 openId 每条消息都打一次通讯录接口
const NAME_NEG_TTL_MS = 60 * 1000;
// 飞书 webhook 推送 3s 内若不回 200 会触发重试；这里超时必须小于该阈值
const REQUEST_TIMEOUT_MS = 3_000;
/**
 * 缓存条数上限。
 *
 * 群名缓存（feishu-chat）有 500 的上限、link 反查缓存有 1000 的 LRU，
 * 唯独这份用户名缓存是无限增长的 Map —— 键是 open_id，长驻进程接进
 * 几个大群之后就会慢慢涨上去，而且永远不会回落（负缓存过期了条目也还在）。
 */
const CACHE_MAX = 2_000;

interface CachedName {
  name: string | null;
  expiresAt: number;
}

const cache = new Map<string, CachedName>();

/** 写缓存并维持容量上界（超了就丢最旧的一条，Map 的插入序即 FIFO） */
function remember(openId: string, name: string | null, ttlMs: number): void {
  if (!cache.has(openId) && cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(openId, { name, expiresAt: Date.now() + ttlMs });
}

/**
 * 通过 open_id 查飞书通讯录拿用户名。
 * 失败时返回 null（调用方应回退到 open_id 显示）。
 * 命中缓存 1 小时；失败/未命中负缓存 60 秒。
 */
export async function getFeishuUserName(
  openId: string,
): Promise<string | null> {
  if (!openId) return null;
  const cached = cache.get(openId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.name;
  }
  try {
    const token = await feishuTokenManager.getToken();
    const res = await fetch(
      `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const data = (await res.json()) as {
      code: number;
      data?: { user?: { name?: string } };
    };
    if (data.code !== 0) {
      remember(openId, null, NAME_NEG_TTL_MS);
      return null;
    }
    const name = data.data?.user?.name?.trim();
    if (!name) {
      remember(openId, null, NAME_NEG_TTL_MS);
      return null;
    }
    remember(openId, name, NAME_TTL_MS);
    return name;
  } catch (err) {
    console.warn('[FeishuUser] 查询用户名失败:', err);
    remember(openId, null, NAME_NEG_TTL_MS);
    return null;
  }
}

/** 凭证变更时清空缓存 —— 换了 app，open_id 命名空间也就换了 */
export function resetFeishuUserNameCache() {
  cache.clear();
}
