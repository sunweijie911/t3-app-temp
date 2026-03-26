import { Suspense } from 'react';
import { TestGrid } from '@/modules/soulscope/components/test/test-grid';
import { MODULE_NAME } from '@/modules/soulscope/constants';
import { api, HydrateClient } from '@/trpc/server';

async function AllTests() {
  const tests = await api.soulscope.test.list();
  return <TestGrid tests={tests} />;
}

export const metadata = {
  title: `全部测试 - ${MODULE_NAME}`,
  description: '探索MBTI、九型人格、大五人格等10种专业人格测试',
};

export default function TestsPage() {
  return (
    <HydrateClient>
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h1 className="font-bold text-3xl text-gray-900">全部测试</h1>
            <p className="mt-2 text-gray-500">
              选择一项人格测试，开始探索你的内心世界
            </p>
          </div>
          <Suspense
            fallback={
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    className="h-48 animate-pulse rounded-2xl bg-gray-100"
                    key={i}
                  />
                ))}
              </div>
            }
          >
            <AllTests />
          </Suspense>
        </div>
      </main>
    </HydrateClient>
  );
}
