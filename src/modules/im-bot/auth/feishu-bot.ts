import { feishuTokenManager } from './feishu-token';

/** 机器人自身信息基本不变，缓存久一点；失败时短期负缓存避免每条消息都打接口 */
const BOT_ID_TTL_MS = 60 * 60 * 1000;
const BOT_ID_NEG_TTL_MS = 60 * 1000;
/** 飞书 webhook 3s 内不回 200 会重试，这里超时必须小于该阈值 */
const REQUEST_TIMEOUT_MS = 3_000;

let cached: { openId: string | null; expiresAt: number } | null = null;

/**
 * 查机器人自己的 open_id。
 *
 * 用途只有一个：群聊里判断「被 @ 的是不是我」。
 * `im.message.receive_v1` 的 mentions 里是**所有**被 @ 的人，标准权限下
 * 平台只推送 @机器人 的消息所以看不出问题；一旦开通"接收群里所有消息"，
 * 只判断 mentions 非空就会让机器人去应答「@张三 帮我看下」这类消息。
 *
 * 失败返回 null —— 调用方退回"只要有 @ 就处理"的旧行为。这里选择 fail-open：
 * 拿不到自身 ID 就把所有群消息丢掉，等于机器人整体失联，比偶尔多答一句更糟。
 */
export async function getFeishuBotOpenId(): Promise<string | null> {
  if (cached && Date.now() < cached.expiresAt) return cached.openId;

  const remember = (openId: string | null) => {
    cached = {
      openId,
      expiresAt: Date.now() + (openId ? BOT_ID_TTL_MS : BOT_ID_NEG_TTL_MS),
    };
    return openId;
  };

  try {
    const token = await feishuTokenManager.getToken();
    const res = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await res.json()) as {
      code: number;
      bot?: { open_id?: string };
    };
    if (data.code !== 0) return remember(null);
    return remember(data.bot?.open_id?.trim() || null);
  } catch (err) {
    console.warn('[FeishuBot] 查询机器人自身 open_id 失败:', err);
    return remember(null);
  }
}

/** 凭证变更时清空缓存 —— 换了 app 就是换了机器人 */
export function resetFeishuBotOpenIdCache() {
  cached = null;
}
