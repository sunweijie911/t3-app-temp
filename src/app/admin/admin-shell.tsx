'use client';

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
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <ModuleSwitcher currentModuleId={mod.id} />
      </div>
      {children}
    </>
  );
}
