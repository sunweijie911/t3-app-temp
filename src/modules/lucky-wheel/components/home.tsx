import Link from 'next/link';
import { Suspense } from 'react';
import { ActivityCard } from '@/modules/lucky-wheel/components/activity/activity-card';
import { api, HydrateClient } from '@/trpc/server';

async function ActiveActivities() {
  const activities = await api.luckyWheel.activity.list();
  if (activities.length === 0) {
    return <p className="py-12 text-center text-gray-400">暂无进行中的活动</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {activities.map((a) => (
        <ActivityCard activity={a} key={a.id} />
      ))}
    </div>
  );
}

export default async function LuckyWheelHome() {
  return (
    <HydrateClient>
      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 px-4 py-20 text-white">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-4 font-bold text-4xl tracking-tight sm:text-5xl">
              幸运大转盘
            </h1>
            <p className="mb-8 text-lg text-orange-100">
              转一转，好运连连！精彩奖品等你来拿
            </p>
            <Link
              className="inline-block rounded-xl bg-white px-8 py-3.5 font-semibold text-orange-600 shadow-lg transition-all hover:bg-orange-50 hover:shadow-xl"
              href="/lucky-wheel/records"
            >
              我的记录
            </Link>
          </div>
        </section>

        {/* Activity List */}
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="font-bold text-2xl text-gray-900">进行中的活动</h2>
          </div>
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div
                    className="h-48 animate-pulse rounded-2xl bg-gray-100"
                    key={i}
                  />
                ))}
              </div>
            }
          >
            <ActiveActivities />
          </Suspense>
        </section>
      </main>
    </HydrateClient>
  );
}
