import { MODULE_NAME as BATTERY_SWAP_NAME } from '@/modules/battery-swap/constants';

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
    name: '幸运大转盘',
    description: '转盘抽奖活动平台',
    basePath: '/lucky-wheel',
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
        label: '中奖记录',
        href: '/admin/lucky-wheel/records',
        description: '查看中奖记录，更新发货状态',
      },
    ],
  },
  'info-collect': {
    id: 'info-collect',
    name: '信息采集',
    description: '在职信息采集平台',
    basePath: '/info-collect',
    theme: {
      brand: 'text-blue-600',
      active: 'text-blue-600',
      btn: 'bg-blue-500 hover:bg-blue-600',
      link: 'text-blue-600 hover:text-blue-700',
      cardHover: 'group-hover:text-blue-600',
    },
    navLinks: [
      { label: '信息采集', href: '/info-collect' },
      { label: '进度查询', href: '/info-collect/query' },
    ],
    adminNavItems: [
      {
        label: '采集记录',
        href: '/admin/info-collect',
        description: '查看采集记录，审核与发货管理',
      },
      {
        label: '采集配置',
        href: '/admin/info-collect/config',
        description: '配置 banner 和采集字段',
      },
    ],
  },
  'battery-swap': {
    id: 'battery-swap',
    name: BATTERY_SWAP_NAME,
    description: `${BATTERY_SWAP_NAME}展示与购买平台`,
    basePath: '/battery-swap',
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
    name: 'SoulScope',
    description: 'AI 人格测试平台',
    basePath: '/soulscope',
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

export function getModule(id: string): ModuleDefinition {
  const mod = modules[id];
  if (!mod) {
    throw new Error(
      `Unknown module: ${id}. Available: ${Object.keys(modules).join(', ')}`,
    );
  }
  return mod;
}

export function getAllModules(): ModuleDefinition[] {
  return Object.values(modules);
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
  for (const mod of Object.values(modules)) {
    if (
      pathname.startsWith(mod.basePath) ||
      pathname.startsWith(`/admin/${mod.id}`)
    )
      return mod;
  }
  if (fallbackId && modules[fallbackId]) {
    return modules[fallbackId];
  }
  const first = Object.values(modules)[0];
  if (!first) throw new Error('No modules registered');
  return first;
}
