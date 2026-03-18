import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/server/better-auth/server';
import { Footer } from '@/shared/components/layout/footer';
import { Header } from '@/shared/components/layout/header';
import { api, HydrateClient } from '@/trpc/server';

export const metadata = {
  title: '我的结果 - SoulScope',
};

export default async function ResultsPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  const results = await api.soulscope.result.myResults();

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <h1 className="mb-8 font-bold text-3xl text-gray-900">
            我的测试结果
          </h1>

          {results.length === 0 ? (
            <div className="py-20 text-center">
              <p className="mb-4 text-gray-500">你还没有完成任何测试</p>
              <Link
                className="rounded-lg bg-purple-600 px-6 py-2 font-medium text-sm text-white hover:bg-purple-700"
                href="/soulscope/tests"
              >
                去做测试
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((result) => (
                <Link
                  className="block rounded-xl border border-gray-200 p-6 transition-all hover:border-purple-300 hover:shadow-sm"
                  href={`/soulscope/results/${result.id}`}
                  key={result.id}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-gray-500 text-sm">
                        {result.testType?.name}
                      </p>
                      <h3 className="font-semibold text-gray-900 text-lg">
                        {result.resultLabel}
                      </h3>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                      <span className="rounded-full bg-purple-100 px-3 py-1 font-medium text-purple-700 text-sm">
                        {result.resultCode}
                      </span>
                      <p className="text-gray-400 text-xs">
                        {new Date(result.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </HydrateClient>
  );
}
