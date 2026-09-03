// cspell:ignore cooldown
import { getDingtalkCredentials } from '../services/credentials';
import type { TokenManager } from './types';

const REFRESH_FAILURE_COOLDOWN_MS = 5_000;
const REFRESH_TIMEOUT_MS = 10_000;
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * 钉钉 access_token 管理。与飞书/企微同构（并发去重 + 失败冷却），
 * 差异在换取接口：钉钉新版用 POST /v1.0/oauth2/accessToken，
 * 且返回字段是 accessToken / expireIn（驼峰），不是 access_token / expires_in。
 */
export class DingtalkTokenManager implements TokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<string> | null = null;
  private lastFailAt = 0;
  private lastFailError: Error | null = null;

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) {
      return this.token;
    }
    if (
      this.lastFailError &&
      Date.now() - this.lastFailAt < REFRESH_FAILURE_COOLDOWN_MS
    ) {
      throw this.lastFailError;
    }
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this._refresh().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async _refresh(): Promise<string> {
    try {
      const { appKey, appSecret } = await getDingtalkCredentials();
      if (!appKey || !appSecret) {
        throw new Error('钉钉凭证缺失：未配置 appKey/appSecret');
      }
      const res = await fetch(
        'https://api.dingtalk.com/v1.0/oauth2/accessToken',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appKey, appSecret }),
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        throw new Error(
          `钉钉 Token HTTP 错误: ${res.status} ${res.statusText}`,
        );
      }
      const data = (await res.json()) as {
        accessToken?: string;
        expireIn?: number;
        code?: string;
        message?: string;
      };
      if (!data.accessToken) {
        throw new Error(
          `钉钉 Token 获取失败: code=${data.code ?? ''} message=${data.message ?? ''}`,
        );
      }
      this.token = data.accessToken;
      this.expiresAt = Date.now() + (data.expireIn ?? 7200) * 1000;
      this.lastFailAt = 0;
      this.lastFailError = null;
      return this.token;
    } catch (err) {
      this.lastFailAt = Date.now();
      this.lastFailError = err instanceof Error ? err : new Error(String(err));
      throw this.lastFailError;
    }
  }

  reset() {
    this.token = null;
    this.expiresAt = 0;
    this.lastFailAt = 0;
    this.lastFailError = null;
  }
}

export const dingtalkTokenManager = new DingtalkTokenManager();
