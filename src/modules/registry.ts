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
        label: '活动管理',
        href: '/admin/lucky-wheel/activities',
        description: '创建、编辑和管理转盘活动',
      },
      {
        label: '中奖记录',
        href: '/admin/lucky-wheel/records',
        description: '查看中奖记录，更新发货状态',
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
