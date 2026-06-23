import type { BetterAuthPlugin } from 'better-auth';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, phoneNumber } from 'better-auth/plugins';

import { env } from '@/env';
import { parseAuthMethod } from '@/lib/auth-methods';
import { db } from '@/server/db';
import { account, session, user, verification } from '@/server/db/auth-schema';
import { sendEmailOtp } from '@/server/services/email';
import { sendSmsOtp } from '@/server/services/sms';

const useSecureCookies = env.BETTER_AUTH_URL?.startsWith('https://') ?? false;

const method = parseAuthMethod(env.NEXT_PUBLIC_AUTH_METHOD);

const plugins: BetterAuthPlugin[] = [];

if (method === 'email-otp') {
  plugins.push(
    emailOTP({
      async sendVerificationOTP({ email, otp }) {
        await sendEmailOtp(email, otp);
      },
      otpLength: 6,
      expiresIn: 600, // 10 分钟，留足邮件投递延迟余量
    }),
  );
}

if (method === 'phone-otp') {
  plugins.push(
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone, code }) => {
        await sendSmsOtp(phone, code);
      },
      otpLength: 6,
      expiresIn: 600, // 10 分钟，留足短信投递延迟余量
      signUpOnVerification: {
        getTempEmail: (phone) => `${phone}@phone.local`,
        getTempName: (phone) => phone,
      },
    }),
  );
}

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : [],
  // emailAndPassword 始终启用：后台管理员通过 auth.api.signUpEmail() 内部调用创建账号，
  // disableSignUp 禁用公开注册端点，确保外部无法自行注册。
  emailAndPassword: { enabled: true, disableSignUp: true },
  session: {
    expiresIn: 60 * 60, // 1 小时过期
    updateAge: 5 * 60, // 活跃用户每 5 分钟自动续期
  },
  advanced: {
    useSecureCookies,
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  plugins,
});

export type Session = typeof auth.$Infer.Session;
