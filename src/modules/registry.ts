import {
  ExperimentOutlined,
  GiftOutlined,
  PhoneOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { env } from '@/env';
import { MODULE_NAME as BATTERY_SWAP_NAME } from '@/modules/battery-swap/constants';
import { MODULE_NAME as LUCKY_WHEEL_NAME } from '@/modules/lucky-wheel/constants';
import { MODULE_NAME as SIM_CARD_NAME } from '@/modules/sim-card/constants';
import { MODULE_NAME as SOULSCOPE_NAME } from '@/modules/soulscope/constants';

export interface AdminNavItem {
  label: string;
  href: string;
  description?: string;
}

export interface NavLink {
  label: string;
  href: string;
  /** Only show when authenticated */
  auth?: boolean;
}

export interface ModuleTheme {
  /** Brand text color, e.g. "text-orange-600" */
  brand: string;
  /** Active nav-link color */
  active: string;
  /** CTA button classes */
  btn: string;
  /** Inline link color, e.g. "text-orange-600 hover:text-orange-700" */
  link: string;
  /** Card hover text color, e.g. "group-hover:text-orange-600" */
  cardHover: string;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  basePath: string;
  /** 后台 Sidebar 菜单图标 */
  icon: ReactNode;
  theme: ModuleTheme;
  navLinks: NavLink[];
  adminNavItems: AdminNavItem[];
}

// NOTE: The first entry is used as the client-safe fallback for
// `getModuleByPathname` (e.g. on "/" or "/admin").  Keep the default
// module first so the header/brand matches the homepage.
const modules: Record<string, ModuleDefinition> = {
  'lucky-wheel': {
    id: 'lucky-wheel',
    name: LUCKY_WHEEL_NAME,
    description: '转盘抽奖活动平台',
    basePath: '/lucky-wheel',
    icon: createElement(GiftOutlined),
    theme: {
      brand: 'text-orange-600',
      active: 'text-orange-600',
      btn: 'bg-orange-500 hover:bg-orange-600',
      link: 'text-orange-600 hover:text-orange-700',
      cardHover: 'group-hover:text-orange-600',
    },
    navLinks: [
      { label: '全部活动', href: '/lucky-wheel' },
      { label: '抽奖记录', href: '/lucky-wheel/records', auth: true },
    ],
    adminNavItems: [
      {
        label: '活动管理',
        href: '/admin/lucky-wheel',
        description: '管理转盘抽奖活动',
      },
      {
        label: '中奖记录',
        href: '/admin/lucky-wheel/records',
        description: '查看中奖记录，更新发货状态',
      },
    ],
  },
  'sim-card': {
    id: 'sim-card',
    name: SIM_CARD_NAME,
    description: `${SIM_CARD_NAME}展示与办理平台`,
    basePath: '/sim-card',
    icon: createElement(PhoneOutlined),
    theme: {
      brand: 'text-blue-600',
      active: 'text-blue-600',
      btn: 'bg-blue-500 hover:bg-blue-600',
      link: 'text-blue-600 hover:text-blue-700',
      cardHover: 'group-hover:text-blue-600',
    },
    navLinks: [{ label: SIM_CARD_NAME, href: '/sim-card' }],
    adminNavItems: [
      {
        label: '套餐管理',
        href: '/admin/sim-card/packages',
        description: '管理电话卡套餐内容与上下架',
      },
      {
        label: '页面配置',
        href: '/admin/sim-card/config',
        description: '配置 Banner 和用户信息展示字段',
      },
      {
        label: '办理数据',
        href: '/admin/sim-card/analytics',
        description: '查看用户点击办理的埋点数据',
      },
    ],
  },
  'battery-swap': {
    id: 'battery-swap',
    name: BATTERY_SWAP_NAME,
    description: `${BATTERY_SWAP_NAME}展示与购买平台`,
    basePath: '/battery-swap',
    icon: createElement(ThunderboltOutlined),
    theme: {
      brand: 'text-green-600',
      active: 'text-green-600',
      btn: 'bg-green-500 hover:bg-green-600',
      link: 'text-green-600 hover:text-green-700',
      cardHover: 'group-hover:text-green-600',
    },
    navLinks: [{ label: BATTERY_SWAP_NAME, href: '/battery-swap' }],
    adminNavItems: [
      {
        label: '套餐管理',
        href: '/admin/battery-swap',
        description: `管理${BATTERY_SWAP_NAME}内容与上下架`,
      },
    ],
  },
  soulscope: {
    id: 'soulscope',
    name: SOULSCOPE_NAME,
    description: 'AI 人格测试平台',
    basePath: '/soulscope',
    icon: createElement(ExperimentOutlined),
    theme: {
      brand: 'text-purple-600',
      active: 'text-purple-600',
      btn: 'bg-purple-600 hover:bg-purple-700',
      link: 'text-purple-600 hover:text-purple-700',
      cardHover: 'group-hover:text-purple-600',
    },
    navLinks: [
      { label: '全部测试', href: '/soulscope/tests' },
      { label: '我的结果', href: '/soulscope/results', auth: true },
    ],
    adminNavItems: [
      {
        label: '测试管理',
        href: '/admin/soulscope/tests',
        description: '管理测试类型和题目',
      },
      {
        label: '系统配置',
        href: '/admin/soulscope/config',
        description: 'LLM设置、提示词配置',
      },
      {
        label: '订单管理',
        href: '/admin/soulscope/orders',
        description: '查看订单和收入',
      },
    ],
  },
};

/** 解析 NEXT_PUBLIC_MODULE_NAMES，返回 moduleId → 自定义名称 的映射 */
function getModuleNameOverrides(): Record<string, string> {
  const raw = env.NEXT_PUBLIC_MODULE_NAMES;
  if (!raw) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [id, name] = pair.split(':').map((s) => s.trim());
    if (id && name) result[id] = name;
  }
  return result;
}

/** 解析 NEXT_PUBLIC_ENABLED_MODULES，返回 null 表示全部启用 */
function getEnabledModuleIds(): string[] | null {
  const raw = env.NEXT_PUBLIC_ENABLED_MODULES;
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : null;
}

/** 应用名称覆盖 */
function applyNameOverride(mod: ModuleDefinition): ModuleDefinition {
  const overrides = getModuleNameOverrides();
  const name = overrides[mod.id];
  return name ? { ...mod, name } : mod;
}

export function getModule(id: string): ModuleDefinition {
  const mod = modules[id];
  if (!mod) {
    throw new Error(
      `Unknown module: ${id}. Available: ${Object.keys(modules).join(', ')}`,
    );
  }
  const enabled = getEnabledModuleIds();
  if (enabled && !enabled.includes(id)) {
    throw new Error(
      `Module "${id}" is not enabled. Enabled: ${enabled.join(', ')}`,
    );
  }
  return applyNameOverride(mod);
}

export function getAllModules(): ModuleDefinition[] {
  const enabled = getEnabledModuleIds();
  const list = enabled
    ? enabled.filter((id) => modules[id]).map((id) => modules[id]!)
    : Object.values(modules);
  return list.map(applyNameOverride);
}

/**
 * Resolve the active module from a pathname.
 * When the pathname doesn't match any module (e.g. "/" or "/admin"),
 * falls back to `fallbackId` if provided, otherwise the first registered module.
 */
export function getModuleByPathname(
  pathname: string,
  fallbackId?: string,
): ModuleDefinition {
  const enabledModules = getAllModules();
  for (const mod of enabledModules) {
    if (
      pathname.startsWith(mod.basePath) ||
      pathname.startsWith(`/admin/${mod.id}`)
    )
      return mod;
  }
  if (fallbackId) {
    const fallback = enabledModules.find((m) => m.id === fallbackId);
    if (fallback) return fallback;
  }
  const first = enabledModules[0];
  if (!first) throw new Error('No modules enabled');
  return first;
}
