// cspell:ignore cooldown corpsecret corpid
import { getWecomCredentials } from '../services/credentials';
import type { TokenManager } from './types';

/** 刷新失败后的冷却时间：避免高并发请求接连失败时形成请求惊群 */
const REFRESH_FAILURE_COOLDOWN_MS = 5_000;
const REFRESH_TIMEOUT_MS = 10_000;
/** 提前过期的安全边界，避免边界时刻拿到即将失效的 token */
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * 企微 access_token 管理。与 FeishuTokenManager 同构（并发去重 + 失败冷却），
 * 差异只在换取接口：企微用 GET /cgi-bin/gettoken?corpid=&corpsecret=。
 */
export class WecomTokenManager implements TokenManager {
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
      const { corpId, botSecret } = await getWecomCredentials();
      if (!corpId || !botSecret) {
        throw new Error('企微凭证缺失：未配置 corpId/botSecret');
      }
      const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
      url.searchParams.set('corpid', corpId);
      url.searchParams.set('corpsecret', botSecret);

      const res = await fetch(url, {
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(
          `企微 Token HTTP 错误: ${res.status} ${res.statusText}`,
        );
      }
      const data = (await res.json()) as {
        errcode?: number;
        errmsg?: string;
        access_token?: string;
        expires_in?: number;
      };
      if (data.errcode && data.errcode !== 0) {
        throw new Error(
          `企微 Token 获取失败: errcode=${data.errcode} errmsg=${data.errmsg ?? ''}`,
        );
      }
      if (!data.access_token) {
        throw new Error('企微 Token 响应中没有 access_token');
      }
      this.token = data.access_token;
      // expires_in 缺省按官方默认 7200 秒算
      this.expiresAt = Date.now() + (data.expires_in ?? 7200) * 1000;
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

/** 全局单例，避免多个模块各自创建实例导致 Token 并发刷新 */
export const wecomTokenManager = new WecomTokenManager();
