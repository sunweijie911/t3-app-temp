import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { phoneNumber } from 'better-auth/plugins';

import { env } from '@/env';
import { db } from '@/server/db';
import { account, session, user, verification } from '@/server/db/auth-schema';
import { sendSmsOtp } from '@/server/services/sms';

const useSecureCookies = env.BETTER_AUTH_URL?.startsWith('https://') ?? false;

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : [],
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60, // 1 小时过期
    updateAge: 5 * 60, // 活跃用户每 5 分钟自动续期
  },
  // 禁用公开注册 HTTP 端点，仅允许管理员通过 auth.api.signUpEmail() 内部调用创建用户
  disabledPaths: ['/sign-up/email'],
  advanced: {
    useSecureCookies,
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        await sendSmsOtp(phone, code);
      },
      otpLength: 6,
      expiresIn: 300,
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone}@phone.local`,
        getTempName: (phone) => phone,
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
