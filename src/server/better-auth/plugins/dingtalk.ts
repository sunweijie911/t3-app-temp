import type { BetterAuthPlugin, User } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

import { getDingtalkUserInfo, maskPhone } from '@/server/services/dingtalk';

/** 与 lucky-wheel 保持一致的中国大陆手机号规则（此处独立定义，避免服务端依赖业务模块） */
const PHONE_RE = /^1[3-9]\d{9}$/;

/** 与 phone-otp 模式完全同构的临时邮箱格式，保证两种模式下用户行结构一致 */
const tempEmail = (phone: string) => `${phone}@phone.local`;

/**
 * 归一化钉钉返回的 mobile：
 * - 去掉空格与连字符
 * - 去掉 +86 / 86 国际码前缀（仅当去掉后恰好剩 11 位时才去，避免误伤）
 *
 * @returns 合法的 11 位手机号，或 null（格式不合法）
 */
function normalizeMobile(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let phone = raw.replace(/[\s-]/g, '');
  if (phone.startsWith('+86') && phone.length === 14) {
    phone = phone.slice(3);
  } else if (phone.startsWith('86') && phone.length === 13) {
    phone = phone.slice(2);
  }
  return PHONE_RE.test(phone) ? phone : null;
}

/** user 行 + phoneNumber 插件声明的两个字段 */
type UserRow = User & {
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
};

/**
 * 钉钉免登插件。
 *
 * 流程：前端 dd.runtime.permission.requestAuthCode 拿到 authCode →
 * 服务端经 LINK 网关换取用户手机号 → 按 phoneNumber 找/建 user → 签发标准 session cookie。
 *
 * 用户行与 phone-otp 模式完全同构（同样的 `${phone}@phone.local` 临时邮箱、
 * phoneNumberVerified: true），因此下游的额外次数匹配、ADMIN_PHONES 判定等逻辑无需改动。
 *
 * 安全：只信 authCode，不接受客户端上传的 name / mobile。
 */
export const dingtalkAuth = () =>
  ({
    id: 'dingtalk',
    // 不在此声明 phoneNumber / phoneNumberVerified 字段：dingtalk 模式下 config.ts 会
    // 一并加载 phoneNumber 插件（作为非钉钉环境的手机验证码回退通道），字段由它声明，
    // 重复声明会冲突。
    endpoints: {
      signInDingtalk: createAuthEndpoint(
        '/dingtalk/sign-in',
        {
          method: 'POST',
          body: z.object({ authCode: z.string().min(1) }),
        },
        async (ctx) => {
          const { authCode } = ctx.body;

          // 1. 用 authCode 换取钉钉用户信息（失败原因不外泄给前端）
          let info: Awaited<ReturnType<typeof getDingtalkUserInfo>>;
          try {
            info = await getDingtalkUserInfo(authCode);
          } catch (err) {
            console.error('[钉钉免登] 获取用户信息失败:', err);
            throw new APIError('UNAUTHORIZED', {
              message: '钉钉免登失败',
            });
          }

          // 2. 手机号归一化 + 校验
          const phone = normalizeMobile(info.mobile);
          if (!phone) {
            console.warn(`[钉钉免登] 手机号格式不合法, userid=${info.userid}`);
            throw new APIError('BAD_REQUEST', {
              message: '钉钉账号未绑定有效手机号',
            });
          }

          const dingtalkName = info.name?.trim() ?? '';

          // 3. 按 phoneNumber 找用户，没有则建
          let user = (await ctx.context.adapter.findOne<UserRow>({
            model: 'user',
            where: [{ field: 'phoneNumber', value: phone }],
          })) as UserRow | null;

          if (user) {
            // 钉钉侧姓名变更时同步；历史数据 phoneNumberVerified 为假时补真
            const patch: Record<string, unknown> = {};
            if (dingtalkName && dingtalkName !== user.name) {
              patch.name = dingtalkName;
            }
            if (!user.phoneNumberVerified) {
              patch.phoneNumberVerified = true;
            }
            if (Object.keys(patch).length > 0) {
              const updated = await ctx.context.internalAdapter.updateUser(
                user.id,
                patch,
              );
              if (updated) user = updated as unknown as UserRow;
            }
          } else {
            const created = await ctx.context.internalAdapter.createUser({
              email: tempEmail(phone),
              name: dingtalkName || phone,
              phoneNumber: phone,
              phoneNumberVerified: true,
            });
            if (!created) {
              throw new APIError('INTERNAL_SERVER_ERROR', {
                message: '创建用户失败',
              });
            }
            user = created as unknown as UserRow;
          }

          // 4. 记一行 account，便于按钉钉 userid 溯源（仅首次创建）
          try {
            const accounts = await ctx.context.internalAdapter.findAccounts(
              user.id,
            );
            const linked = accounts.some(
              (a) => a.providerId === 'dingtalk' && a.accountId === info.userid,
            );
            if (!linked) {
              await ctx.context.internalAdapter.createAccount({
                userId: user.id,
                providerId: 'dingtalk',
                accountId: info.userid,
              });
            }
          } catch (err) {
            // account 记录仅用于溯源，失败不阻断登录
            console.warn('[钉钉免登] 记录 dingtalk account 失败:', err);
          }

          // 5. 签发标准 session cookie
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: '创建会话失败',
            });
          }

          await setSessionCookie(ctx, { session, user });

          console.log(`[钉钉免登] 登录成功: ${maskPhone(phone)}`);

          return ctx.json({
            status: true,
            token: session.token,
            user,
          });
        },
      ),
    },
    // 不声明插件级 rateLimit：config.ts 的 customRules['/dingtalk/sign-in'] 优先级更高，
    // 此处再写一份只会是死代码，限流阈值统一在 config.ts 维护。
  }) satisfies BetterAuthPlugin;
