// cspell:ignore cooldown
import { getFeishuCredentials } from '../services/credentials';
import type { TokenManager } from './types';

/** 刷新失败后的冷却时间：避免高并发请求接连失败时形成请求惊群 */
const REFRESH_FAILURE_COOLDOWN_MS = 5_000;
/** 单次刷新 HTTP 超时 */
const REFRESH_TIMEOUT_MS = 10_000;

export class FeishuTokenManager implements TokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<string> | null = null;
  /** 上次刷新失败的时间戳；在冷却窗口内直接复用上次错误，不发起新请求 */
  private lastFailAt = 0;
  private lastFailError: Error | null = null;

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 5 * 60 * 1000) {
      return this.token;
    }
    // 失败冷却：上次刷新失败且未过冷却时间 → 直接抛上次错误
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
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        throw new Error(
          `飞书 Token HTTP 错误: ${res.status} ${res.statusText}`,
        );
      }
      const data = (await res.json()) as {
        code: number;
        msg?: string;
        tenant_access_token: string;
        expire: number;
      };
      if (data.code !== 0) {
        throw new Error(
          `飞书 Token 获取失败: code=${data.code} msg=${data.msg ?? ''}`,
        );
      }
      this.token = data.tenant_access_token;
      this.expiresAt = Date.now() + data.expire * 1000;
      this.lastFailAt = 0;
      this.lastFailError = null;
      return this.token;
    } catch (err) {
      // 记录失败用于后续 cooldown，并把错误包装成 Error 保证 typed
      this.lastFailAt = Date.now();
      this.lastFailError = err instanceof Error ? err : new Error(String(err));
      throw this.lastFailError;
    }
  }

  /** 凭证变更时清空已缓存 token，下次重新获取 */
  reset() {
    this.token = null;
    this.expiresAt = 0;
    this.lastFailAt = 0;
    this.lastFailError = null;
  }
}

/** 全局单例，避免多个模块各自创建实例导致 Token 并发刷新 */
export const feishuTokenManager = new FeishuTokenManager();
