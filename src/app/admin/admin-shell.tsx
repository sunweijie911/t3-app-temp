'use client';

import {
  FileTextOutlined,
  LeftOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Button, Dropdown, Layout, Menu, Modal, theme } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { env } from '@/env';
import { authClient } from '@/lib/auth-client';
import { getAllModules } from '@/modules/registry';
import { ModuleSwitcher } from '@/shared/components/admin/module-switcher';
import { useDefaultModuleId } from '@/shared/components/default-module-provider';

const { Sider, Content, Header } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const { data: session } = authClient.useSession();
  const defaultModuleId = useDefaultModuleId();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  const modules = getAllModules();

  // 构建菜单项
  const menuItems: MenuItem[] = useMemo(() => {
    const moduleItems: MenuItem[] = modules.map((mod) => ({
      key: `module-${mod.id}`,
      icon: mod.icon,
      label: mod.name,
      children: mod.adminNavItems.map((nav) => ({
        key: nav.href,
        label: nav.label,
      })),
    }));

    return [
      ...moduleItems,
      { type: 'divider' as const },
      {
        key: '/admin/audit-logs',
        icon: <FileTextOutlined />,
        label: '操作日志',
      },
    ];
  }, [modules]);

  // 计算当前选中的菜单项和展开的子菜单
  const selectedKeys = useMemo(() => {
    // 精确匹配优先，然后前缀匹配
    const allKeys = modules.flatMap((mod) => [
      `/admin/${mod.id}`,
      ...mod.adminNavItems.map((nav) => nav.href),
    ]);
    allKeys.push('/admin/audit-logs');

    const exact = allKeys.find((k) => k === pathname);
    if (exact) return [exact];

    // 最长前缀匹配
    const matched = allKeys
      .filter((k) => pathname.startsWith(`${k}/`) || pathname.startsWith(k))
      .sort((a, b) => b.length - a.length);
    return matched.length > 0 ? [matched[0]!] : [];
  }, [pathname, modules]);

  // 根据路由计算应展开的菜单组
  const routeOpenKeys = useMemo(() => {
    for (const mod of modules) {
      if (pathname.startsWith(`/admin/${mod.id}`)) {
        return [`module-${mod.id}`];
      }
    }
    return [];
  }, [pathname, modules]);

  const [userOpenKeys, setUserOpenKeys] = useState<string[] | null>(null);

  // 路由变化时重置为自动跟随
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      setUserOpenKeys(null);
    }
  }, [pathname]);

  const effectiveOpenKeys = userOpenKeys ?? routeOpenKeys;

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    router.push(key);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsed={collapsed}
        collapsible
        onCollapse={setCollapsed}
        style={{
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
        }}
        theme="light"
        trigger={null}
        width={220}
      >
        <div
          style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        >
          {/* Logo 区域 */}
          <div
            style={{
              height: 64,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'space-between',
              padding: collapsed ? '0' : '0 16px',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            {!collapsed && (
              <span style={{ fontWeight: 600, fontSize: 16 }}>
                {env.NEXT_PUBLIC_SITE_NAME || '管理后台'}
              </span>
            )}
            <Button
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              type="text"
            />
          </div>

          {/* 菜单区域：可滚动 */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Menu
              items={menuItems}
              mode="inline"
              onClick={handleMenuClick}
              onOpenChange={(keys) => setUserOpenKeys(keys as string[])}
              openKeys={effectiveOpenKeys}
              selectedKeys={selectedKeys}
              style={{ borderRight: 0 }}
            />
          </div>

          {/* 底部：默认首页设置 */}
          {!collapsed && (
            <div
              style={{
                flexShrink: 0,
                padding: '12px',
                borderTop: '1px solid #f0f0f0',
              }}
            >
              <ModuleSwitcher currentModuleId={defaultModuleId} />
            </div>
          )}
        </div>
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? 80 : 220,
          transition: 'margin-left 0.2s',
        }}
      >
        {/* 顶部栏 */}
        <Header
          style={{
            background: colorBgContainer,
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            height: 64,
            lineHeight: '64px',
          }}
        >
          <Link
            href={modules[0]?.basePath ?? '/'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#666',
              fontSize: 14,
            }}
          >
            <LeftOutlined style={{ fontSize: 12 }} />
            返回前台
          </Link>
          {session?.user && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'logout',
                    icon: <LogoutOutlined />,
                    label: '退出登录',
                    onClick: () => {
                      Modal.confirm({
                        title: '确认退出',
                        content: '确定要退出登录吗？',
                        okText: '确定退出',
                        cancelText: '取消',
                        onOk: () =>
                          authClient.signOut().then(() => {
                            router.push('/signin');
                          }),
                      });
                    },
                  },
                ],
              }}
              trigger={['hover']}
            >
              <span style={{ color: '#666', fontSize: 14, cursor: 'pointer' }}>
                {session.user.email ?? session.user.name}
              </span>
            </Dropdown>
          )}
        </Header>

        {/* 内容区 */}
        <Content>{children}</Content>
      </Layout>
    </Layout>
  );
}
