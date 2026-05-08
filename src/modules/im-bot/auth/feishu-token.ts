import { getFeishuCredentials } from '../services/credentials';
import type { TokenManager } from './types';

export class FeishuTokenManager implements TokenManager {
  private token: string | null = null;
  private expiresAt = 0;

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 5 * 60 * 1000) {
      return this.token;
    }
    const { appId, appSecret } = await getFeishuCredentials();
    if (!appId || !appSecret) {
      throw new Error('飞书凭证缺失：未配置 appId/appSecret');
    }
    const res = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );
    const data = (await res.json()) as {
      code: number;
      tenant_access_token: string;
      expire: number;
    };
    if (data.code !== 0) {
      throw new Error(`飞书 Token 获取失败: code=${data.code}`);
    }
    this.token = data.tenant_access_token;
    this.expiresAt = Date.now() + data.expire * 1000;
    return this.token;
  }

  /** 凭证变更时清空已缓存 token，下次重新获取 */
  reset() {
    this.token = null;
    this.expiresAt = 0;
  }
}

/** 全局单例，避免多个模块各自创建实例导致 Token 并发刷新 */
export const feishuTokenManager = new FeishuTokenManager();
