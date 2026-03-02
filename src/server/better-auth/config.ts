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
  emailAndPassword: { enabled: false },
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
      expiresIn: 300, // 5 minutes
      // 首次验证时自动创建用户（better-auth 内部需要 email 字段，用手机号生成占位值）
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone}@phone.local`,
        getTempName: (phone) => phone,
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
