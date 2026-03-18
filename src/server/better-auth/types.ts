import type { Session } from './config';

/**
 * Better Auth 的 User 类型扩展，包含 phoneNumber 插件添加的字段。
 * 用于替代散布在代码中的 `as { phoneNumber?: string | null }` 断言。
 */
export type UserWithPhone = Session['user'] & {
  phoneNumber?: string | null;
};

/**
 * 从 session user 中安全提取手机号，避免重复的类型断言。
 */
export function getUserPhone(user: Session['user']): string | null {
  return (user as UserWithPhone).phoneNumber ?? null;
}
