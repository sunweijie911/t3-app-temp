'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { getModuleByPathname } from '@/modules/registry';
import { useDefaultModuleId } from '@/shared/components/default-module-provider';

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('callbackUrl') ?? '/';
  const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

  const defaultModuleId = useDefaultModuleId();
  const mod = getModuleByPathname(callbackUrl, defaultModuleId);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? '登录失败，请检查邮箱和密码');
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError('登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-orange-50 to-pink-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link className={`font-bold text-3xl ${mod.theme.brand}`} href="/">
            {mod.name}
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-lg">
          <h1 className="mb-6 text-center font-semibold text-2xl text-gray-900">
            登录
          </h1>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-center text-red-600 text-sm">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSignIn}>
            <div>
              <label
                className="mb-1 block font-medium text-gray-700 text-sm"
                htmlFor="email"
              >
                邮箱
              </label>
              <input
                autoComplete="email"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="请输入邮箱"
                required
                type="email"
                value={email}
              />
            </div>
            <div>
              <label
                className="mb-1 block font-medium text-gray-700 text-sm"
                htmlFor="password"
              >
                密码
              </label>
              <input
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                id="password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                required
                type="password"
                value={password}
              />
            </div>
            <button
              className={`w-full rounded-lg px-4 py-2.5 font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 ${mod.theme.btn}`}
              disabled={loading}
              type="submit"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
