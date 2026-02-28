'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function SignInPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
        });
        if (result.error) {
          setError(result.error.message ?? '注册失败，请重试');
          return;
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
        });
        if (result.error) {
          setError(result.error.message ?? '登录失败，请检查邮箱和密码');
          return;
        }
      }
      router.push('/');
      router.refresh();
    } catch {
      setError(isSignUp ? '注册失败，请重试' : '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-purple-50 to-pink-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link className="font-bold text-3xl text-purple-600" href="/">
            SoulScope
          </Link>
          <p className="mt-2 text-gray-500">专业人格测试平台</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-lg">
          <h1 className="mb-6 text-center font-semibold text-2xl text-gray-900">
            {isSignUp ? '创建账号' : '欢迎回来'}
          </h1>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-center text-red-600 text-sm">
              {error}
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            {isSignUp && (
              <div>
                <label
                  className="mb-1 block font-medium text-gray-700 text-sm"
                  htmlFor="name"
                >
                  昵称
                </label>
                <input
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                  id="name"
                  onChange={(e) => setName(e.target.value)}
                  placeholder="输入你的昵称"
                  required
                  type="text"
                  value={name}
                />
              </div>
            )}

            <div>
              <label
                className="mb-1 block font-medium text-gray-700 text-sm"
                htmlFor="email"
              >
                邮箱
              </label>
              <input
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                id="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="输入邮箱地址"
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
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm transition-colors focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                id="password"
                minLength={8}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入密码（至少8位）"
                required
                type="password"
                value={password}
              />
            </div>

            <button
              className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-2.5 font-medium text-white transition-all hover:from-purple-700 hover:to-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={loading}
              type="submit"
            >
              {loading ? '请稍候...' : isSignUp ? '注册' : '登录'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm">
            <span className="text-gray-500">
              {isSignUp ? '已有账号？' : '还没有账号？'}
            </span>
            <button
              className="ml-1 font-medium text-purple-600 hover:text-purple-700"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError('');
              }}
              type="button"
            >
              {isSignUp ? '去登录' : '去注册'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
