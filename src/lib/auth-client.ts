import { emailOTPClient, phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// 客户端始终注册所有插件（仅是 HTTP 调用包装器）。
// 真正控制哪些登录方式可用的是服务端 config.ts 中的条件插件加载。
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), phoneNumberClient()],
});

export type Session = typeof authClient.$Infer.Session;
