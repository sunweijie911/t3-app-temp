import { feishuTokenManager } from './feishu-token';

const NAME_TTL_MS = 60 * 60 * 1000;

interface CachedName {
  name: string;
  expiresAt: number;
}

const cache = new Map<string, CachedName>();

/**
 * 通过 open_id 查飞书通讯录拿用户名。
 * 失败时返回 null（调用方应回退到 open_id 显示）。
 * 1 小时本地缓存。
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
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = (await res.json()) as {
      code: number;
      data?: { user?: { name?: string } };
    };
    if (data.code !== 0) return null;
    const name = data.data?.user?.name?.trim();
    if (!name) return null;
    cache.set(openId, { name, expiresAt: Date.now() + NAME_TTL_MS });
    return name;
  } catch (err) {
    console.warn('[FeishuUser] 查询用户名失败:', err);
    return null;
  }
}
