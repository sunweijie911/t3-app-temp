import Link from 'next/link';
import { Header } from '@/app/_components/layout/header';
import { api, HydrateClient } from '@/trpc/server';

export const metadata = {
  title: '管理后台 - SoulScope',
};

export default async function AdminPage() {
  const stats = await api.admin.stats();

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="mb-8 font-bold text-3xl text-gray-900">管理后台</h1>

          {/* Stats Grid */}
          <div className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">总用户数</p>
              <p className="font-bold text-3xl text-gray-900">
                {stats.totalUsers}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">总测试数</p>
              <p className="font-bold text-3xl text-gray-900">
                {stats.totalAttempts}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">已完成</p>
              <p className="font-bold text-3xl text-gray-900">
                {stats.totalCompleted}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">总收入</p>
              <p className="font-bold text-3xl text-gray-900">
                &yen;{stats.revenue}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Link
              className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-md"
              href="/admin/tests"
            >
              <h3 className="mb-2 font-semibold text-gray-900 text-lg">
                测试管理
              </h3>
              <p className="text-gray-500 text-sm">管理测试类型和题目</p>
            </Link>
            <Link
              className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-md"
              href="/admin/config"
            >
              <h3 className="mb-2 font-semibold text-gray-900 text-lg">
                系统配置
              </h3>
              <p className="text-gray-500 text-sm">LLM设置、提示词配置</p>
            </Link>
            <Link
              className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-md"
              href="/admin/orders"
            >
              <h3 className="mb-2 font-semibold text-gray-900 text-lg">
                订单管理
              </h3>
              <p className="text-gray-500 text-sm">查看订单和收入</p>
            </Link>
          </div>
        </div>
      </main>
    </HydrateClient>
  );
}
