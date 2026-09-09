// lucky-wheel module constants
import { z } from 'zod';
import { identifierKind } from '@/lib/auth-methods';

/** 模块显示名称，修改此处即可全局生效 */
export const MODULE_NAME = '幸运大转盘';

export const PRIZE_TYPE_LABELS: Record<string, string> = {
  physical: '实物',
  virtual: '虚拟',
  coupon: '优惠券',
  points: '积分',
  thanks: '谢谢参与',
};

export const RECORD_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  shipped: '已发货',
  claimed: '已领取',
};

export const PRIZE_TYPE_ENUM = z.enum([
  'physical',
  'virtual',
  'coupon',
  'points',
  'thanks',
]);

export const RECORD_STATUS_ENUM = z.enum([
  'pending',
  'confirmed',
  'shipped',
  'claimed',
]);

export const PHONE_RE = /^1[3-9]\d{9}$/;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 当前登录方式（NEXT_PUBLIC_AUTH_METHOD）对应的"用户标识"配置。
 * phone-otp / dingtalk → 手机号；email-otp / email-password → 邮箱。
 * 额外次数匹配、抽奖快照、中奖记录视图统一从此取值。
 */
export const IDENTIFIER_CONFIG =
  identifierKind === 'phone'
    ? {
        kind: 'phone' as const,
        label: '手机号',
        regex: PHONE_RE,
        placeholder: '1xxxxxxxxxx',
        inputMode: 'numeric' as 'numeric' | undefined,
        maxLength: 11 as number | undefined,
        userField: 'phoneNumber' as 'phoneNumber' | 'email',
      }
    : {
        kind: 'email' as const,
        label: '邮箱',
        regex: EMAIL_RE,
        placeholder: 'name@example.com',
        inputMode: undefined as 'numeric' | undefined,
        maxLength: undefined as number | undefined,
        userField: 'email' as 'phoneNumber' | 'email',
      };
