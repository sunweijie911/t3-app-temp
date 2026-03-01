import Link from 'next/link';
import { Header } from '@/app/_components/layout/header';
import { getModule } from '@/modules/registry';
import { api, HydrateClient } from '@/trpc/server';

export const metadata = {
  title: '大转盘管理 - 管理后台',
};

export default async function AdminLuckyWheelPage() {
  const mod = getModule('lucky-wheel');
  const stats = await api.luckyWheel.admin.stats();

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <Link className={`text-sm ${mod.theme.link}`} href="/admin">
              &larr; 返回管理后台
            </Link>
            <h1 className="mt-2 font-bold text-3xl text-gray-900">
              大转盘管理
            </h1>
          </div>

          {/* Stats */}
          <div className="mb-12 grid grid-cols-2 gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">活跃活动数</p>
              <p className="font-bold text-3xl text-gray-900">
                {stats.totalActivities}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">总抽奖次数</p>
              <p className="font-bold text-3xl text-gray-900">
                {stats.totalDraws}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm">
              <p className="text-gray-500 text-sm">总中奖数</p>
              <p className="font-bold text-3xl text-gray-900">
                {stats.totalWins}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {mod.adminNavItems.map((item) => (
              <Link
                className="rounded-xl bg-white p-6 shadow-sm transition-all hover:shadow-md"
                href={item.href}
                key={item.href}
              >
                <h3 className="mb-2 font-semibold text-gray-900 text-lg">
                  {item.label}
                </h3>
                <p className="text-gray-500 text-sm">{item.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </HydrateClient>
  );
}
