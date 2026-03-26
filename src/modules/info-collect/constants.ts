import { z } from 'zod';

/** 模块显示名称，修改此处即可全局生效 */
export const MODULE_NAME = '信息采集';

export const REVIEW_STATUS_ENUM = z.enum([
  'pending',
  'approved',
  'rejected',
  'needs_supplement',
  'completed',
]);

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '待发货',
  rejected: '已拒绝',
  needs_supplement: '需补充',
  completed: '已完成',
};

export const REVIEW_STATUS_COLORS: Record<string, string> = {
  pending: 'processing',
  approved: 'warning',
  rejected: 'error',
  needs_supplement: 'default',
  completed: 'success',
};

export const ID_CARD_RE =
  /^[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]$/;
