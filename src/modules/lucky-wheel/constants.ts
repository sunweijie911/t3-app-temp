// lucky-wheel module constants
import { z } from 'zod';

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
