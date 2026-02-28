'use client';

import {
  BarChart3,
  FlaskConical,
  LogOut,
  Menu,
  Settings,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { api } from '@/trpc/react';

export function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const { data: isAdmin } = api.admin.isAdmin.useQuery(undefined, {
    enabled: !!session?.user,
  });

  const navLinks = (
    <>
      <Link
        className={`flex items-center gap-1.5 font-medium text-sm transition-colors hover:text-purple-600 ${
          pathname.startsWith('/tests') ? 'text-purple-600' : 'text-gray-600'
        }`}
        href="/tests"
        onClick={() => setMenuOpen(false)}
      >
        <FlaskConical className="h-4 w-4" />
        全部测试
      </Link>
      {session?.user && (
        <Link
          className={`flex items-center gap-1.5 font-medium text-sm transition-colors hover:text-purple-600 ${
            pathname.startsWith('/results')
              ? 'text-purple-600'
              : 'text-gray-600'
          }`}
          href="/results"
          onClick={() => setMenuOpen(false)}
        >
          <BarChart3 className="h-4 w-4" />
          我的结果
        </Link>
      )}
      {isAdmin && (
        <Link
          className={`flex items-center gap-1.5 font-medium text-sm transition-colors hover:text-purple-600 ${
            pathname.startsWith('/admin') ? 'text-purple-600' : 'text-gray-600'
          }`}
          href="/admin"
          onClick={() => setMenuOpen(false)}
        >
          <Settings className="h-4 w-4" />
          管理后台
        </Link>
      )}
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-gray-200 border-b bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link className="font-bold text-purple-600 text-xl" href="/">
            SoulScope
          </Link>
          <nav className="hidden items-center gap-6 md:flex">{navLinks}</nav>
        </div>
        <div className="flex items-center gap-4">
          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-gray-600 text-sm sm:inline">
                {session.user.name}
              </span>
              <button
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-gray-600 text-sm transition-colors hover:bg-gray-50"
                onClick={() => {
                  authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        toast.success('已退出登录');
                      },
                    },
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
              className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-purple-700"
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
