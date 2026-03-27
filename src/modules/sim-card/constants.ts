export const MODULE_NAME = '电话卡办理';

// systemConfig keys
export const BANNER_CONFIG_KEY = 'sim-card.banner_url';
export const VISIBLE_FIELDS_CONFIG_KEY = 'sim-card.visible_fields';

// 用户信息可配置字段
export const USER_INFO_FIELDS = [
  { key: 'name', label: '姓名' },
  { key: 'phone', label: '手机号' },
  { key: 'department', label: '部门' },
  { key: 'position', label: '职位' },
  { key: 'jobNumber', label: '工号' },
] as const;

export type UserInfoFieldKey = (typeof USER_INFO_FIELDS)[number]['key'];

// 默认展示字段
export const DEFAULT_VISIBLE_FIELDS: UserInfoFieldKey[] = ['name', 'phone'];
