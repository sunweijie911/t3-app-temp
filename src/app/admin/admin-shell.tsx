'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getModuleByPathname } from '@/modules/registry';
import { ModuleSwitcher } from '@/shared/components/admin/module-switcher';
import { useDefaultModuleId } from '@/shared/components/default-module-provider';
import { Header } from '@/shared/components/layout/header';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const defaultModuleId = useDefaultModuleId();
  const mod = getModuleByPathname(pathname, defaultModuleId);

  return (
    <>
      <Header />
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <ModuleSwitcher currentModuleId={mod.id} />
        <Link
          className={`text-sm transition-colors ${
            pathname.startsWith('/admin/audit-logs')
              ? 'font-medium text-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          href="/admin/audit-logs"
        >
          操作日志
        </Link>
      </div>
      {children}
    </>
  );
}
