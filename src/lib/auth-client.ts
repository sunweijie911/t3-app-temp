import type { BetterAuthClientPlugin } from 'better-auth';
import { emailOTPClient, phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import type { dingtalkAuth } from '@/server/better-auth/plugins/dingtalk';

/**
 * 钉钉免登客户端插件（仅是 HTTP 调用包装器 + session 原子刷新信号）。
 *
 * $InferServerPlugin 只做类型推导，`import type` 在编译时被完全擦除，
 * 不会把服务端插件（及其 @/env、LINK 网关依赖）打进客户端 bundle。
 *
 * 服务端 endpoint 路径为 `/dingtalk/sign-in`，better-auth 按路径推导出的调用方式即
 * `authClient.dingtalk.signIn({ authCode })`。
 */
const dingtalkClient = () =>
  ({
    id: 'dingtalk',
    $InferServerPlugin: {} as ReturnType<typeof dingtalkAuth>,
    atomListeners: [
      {
        matcher: (path: string) => path === '/dingtalk/sign-in',
        signal: '$sessionSignal',
      },
    ],
  }) satisfies BetterAuthClientPlugin;

// 客户端始终注册所有插件（仅是 HTTP 调用包装器）。
// 真正控制哪些登录方式可用的是服务端 config.ts 中的条件插件加载。
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), phoneNumberClient(), dingtalkClient()],
});

export type Session = typeof authClient.$Infer.Session;
