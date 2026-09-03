import { feishuTokenManager } from './feishu-token';

const NAME_TTL_MS = 60 * 60 * 1000;
/** 失败/未命中的负缓存，避免每条消息都打一次接口 */
const NAME_NEG_TTL_MS = 60 * 1000;
/** 飞书 webhook 3s 内不回 200 会重试，这里超时必须小于该阈值 */
const REQUEST_TIMEOUT_MS = 3_000;
const CACHE_MAX = 500;

interface CachedName {
  name: string | null;
  expiresAt: number;
}

const cache = new Map<string, CachedName>();

/**
 * 通过 chat_id 查群名。
 *
 * `im.message.receive_v1` 事件体里**不含群名**，所以 UnifiedMessage.chatName
 * 以前永远是 undefined —— 场景 prompt 里的 `${chatName}` 静默变成空串，
 * 审计日志的 chatName 列也永远为 null。这里补上带缓存的查询。
 *
 * 失败返回 null（调用方回退到不带群名）。
 */
export async function getFeishuChatName(
  chatId: string,
): Promise<string | null> {
  if (!chatId) return null;
  const cached = cache.get(chatId);
  if (cached && Date.now() < cached.expiresAt) return cached.name;

  const remember = (name: string | null) => {
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(chatId, {
      name,
      expiresAt: Date.now() + (name ? NAME_TTL_MS : NAME_NEG_TTL_MS),
    });
    return name;
  };

  try {
    const token = await feishuTokenManager.getToken();
    const res = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    const data = (await res.json()) as {
      code: number;
      data?: { name?: string };
    };
    if (data.code !== 0) return remember(null);
    return remember(data.data?.name?.trim() || null);
  } catch (err) {
    console.warn('[FeishuChat] 查询群名失败:', err);
    return remember(null);
  }
}

/** 凭证变更时清空缓存 */
export function resetFeishuChatNameCache() {
  cache.clear();
}
