'use client';

import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { authMethod } from '@/lib/auth-methods';
import { getModuleByPathname } from '@/modules/registry';
import { useDefaultModuleId } from '@/shared/components/default-module-provider';
import { api } from '@/trpc/react';

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const { data: isAdmin } = api.sys.checkRole.useQuery(undefined, {
    enabled: !!session?.user,
    staleTime: Infinity,
  });

  const defaultModuleId = useDefaultModuleId();
  const mod = getModuleByPathname(pathname, defaultModuleId);
  const theme = mod.theme;

  // 最长前缀匹配，避免 /lucky-wheel 误匹配 /lucky-wheel/records
  const activeNavHref = [...mod.navLinks]
    .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const navLinks = (
    <>
      {mod.navLinks.map((link) => {
        if (link.auth && !session?.user) return null;
        const isActive = link.href === activeNavHref;
        return (
          <Link
            className={`flex items-center gap-1.5 font-medium text-sm transition-colors ${
              isActive ? theme.active : 'text-gray-600'
            }`}
            href={link.href}
            key={link.href}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          className={`flex items-center gap-1.5 font-medium text-sm transition-colors ${
            pathname.startsWith('/admin') ? theme.active : 'text-gray-600'
          }`}
          href={`/admin/${mod.id}`}
          onClick={() => setMenuOpen(false)}
        >
          管理后台
        </Link>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-gray-200 border-b bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link
            className={`font-bold text-xl ${theme.brand}`}
            href={mod.basePath}
          >
            {mod.name}
          </Link>
          <nav className="hidden items-center gap-6 md:flex">{navLinks}</nav>
        </div>
        <div className="flex items-center gap-4">
          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="hidden max-w-48 truncate text-gray-600 text-sm sm:inline">
                {authMethod === 'phone-otp'
                  ? session.user.name
                  : (session.user.email ?? session.user.name)}
              </span>
              <button
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-gray-600 text-sm transition-colors hover:bg-gray-50"
                onClick={() => {
                  toast('确定要退出登录吗？', {
                    action: {
                      label: '确定退出',
                      onClick: () => {
                        authClient.signOut({
                          fetchOptions: {
                            onSuccess: () => {
                              toast.success('已退出登录');
                              router.push('/');
                              router.refresh();
                            },
                          },
                        });
                      },
                    },
                    cancel: { label: '取消', onClick: () => {} },
                  });
                }}
                type="button"
              >
                <LogOut className="h-4 w-4" />
                退出
              </button>
            </div>
          ) : (
            <Link
              className={`rounded-lg px-4 py-2 font-medium text-sm text-white transition-colors ${theme.btn}`}
              href="/signin"
            >
              登录
            </Link>
          )}
          {/* Mobile menu toggle */}
          <button
            className="md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            type="button"
          >
            {menuOpen ? (
              <X className="h-6 w-6 text-gray-600" />
            ) : (
              <Menu className="h-6 w-6 text-gray-600" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="flex flex-col gap-4 border-gray-200 border-t bg-white px-6 py-4 md:hidden">
          {navLinks}
        </nav>
      )}
    </header>
  );
}
