'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { env } from '@/env';
import { authClient } from '@/lib/auth-client';
import { resolveAuthError } from '@/lib/auth-error';

export type DingtalkLoginStatus =
  | 'idle'
  | 'pending'
  | 'done'
  /** 不在钉钉客户端内（浏览器直接打开）——回退到手机验证码登录 */
  | 'not-in-dingtalk'
  /** URL 与 env 均无 corpId——同样回退到手机验证码登录 */
  | 'missing-corp-id'
  | 'failed';

interface UseDingtalkAutoLoginOptions {
  /** 为 false 时保持 idle 且不发起任何请求（非 dingtalk 模式 / 已登录 / session 加载中） */
  enabled: boolean;
}

/**
 * 钉钉免登自动登录。
 *
 * 在钉钉客户端内调用 dd.runtime.permission.requestAuthCode 拿到 authCode，
 * 再交给服务端 `/dingtalk/sign-in` 换取标准 session cookie。
 *
 * 非钉钉环境（not-in-dingtalk / missing-corp-id）与免登失败（failed）都不阻塞页面，
 * 由调用方回退到手机验证码登录表单。
 */
export function useDingtalkAutoLogin({ enabled }: UseDingtalkAutoLoginOptions) {
  const [status, setStatus] = useState<DingtalkLoginStatus>('idle');
  const [error, setError] = useState('');
  // 手动重试计数：仅它变化才允许重跑
  const [attempt, setAttempt] = useState(0);
  // authCode 单次有效，跑两次第二次必失败。记住「已跑过的 attempt」，
  // StrictMode 双调用与依赖变化引起的重复触发都会被这里挡掉。
  const startedRef = useRef(-1);

  useEffect(() => {
    if (!enabled) return;
    if (startedRef.current === attempt) return;
    startedRef.current = attempt;

    setStatus('pending');
    setError('');

    void (async () => {
      try {
        const dd = await import('dingtalk-jsapi');

        if (dd.env.platform === 'notInDingTalk') {
          setStatus('not-in-dingtalk');
          return;
        }

        // 钉钉内打开子页面时 URL 上的 corpId 可能丢失，回退读环境变量
        const corpId =
          new URLSearchParams(window.location.search).get('corpId') ||
          env.NEXT_PUBLIC_DINGTALK_CORP_ID ||
          '';
        if (!corpId) {
          setStatus('missing-corp-id');
          return;
        }

        const info = await dd.runtime.permission.requestAuthCode({ corpId });

        const result = await authClient.dingtalk.signIn({
          authCode: info.code,
        });

        if (result.error) {
          // 默认文案不带「请重试」：调用方会拼成「…，请使用手机验证码登录」
          setError(resolveAuthError(result.error, '钉钉免登失败'));
          setStatus('failed');
          return;
        }

        setStatus('done');
      } catch (err) {
        console.error('[钉钉免登] 失败:', err);
        setError('钉钉免登失败');
        setStatus('failed');
      }
    })();
    // 不做 cleanup 取消：authCode 只能用一次，StrictMode 卸载重挂时若丢弃首次结果，
    // 二次触发被 startedRef 挡掉就会永远停在 pending。
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setStatus('idle');
    setError('');
    setAttempt((n) => n + 1);
  }, []);

  return { status, error, retry };
}
