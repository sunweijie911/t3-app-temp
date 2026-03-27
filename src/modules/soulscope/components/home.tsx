import { MousePointerClick, PenLine, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { TestGrid } from '@/modules/soulscope/components/test/test-grid';
import { SkeletonCardGrid } from '@/shared/components/skeleton';
import { api, HydrateClient } from '@/trpc/server';

async function FeaturedTests() {
  const tests = await api.soulscope.test.getFeatured();
  return <TestGrid tests={tests} />;
}

export default async function SoulscopeHome() {
  return (
    <HydrateClient>
      <main className="min-h-screen bg-white">
        {/* Hero Section */}
        <section className="bg-gradient-to-br from-purple-600 via-purple-700 to-pink-600 px-4 py-20 text-white">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-4 font-bold text-4xl tracking-tight sm:text-5xl">
              探索你的内心世界
            </h1>
            <p className="mb-8 text-lg text-purple-100">
              10种专业人格测试 + 专家定制化深度分析
            </p>
            <Link
              className="inline-block rounded-xl bg-white px-8 py-3.5 font-semibold text-purple-700 shadow-lg transition-all hover:bg-purple-50 hover:shadow-xl"
              href="/soulscope/tests"
            >
              开始测试
            </Link>
          </div>
        </section>

        {/* Featured Tests */}
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="font-bold text-2xl text-gray-900">热门测试</h2>
            <Link
              className="font-medium text-purple-600 text-sm hover:text-purple-700"
              href="/soulscope/tests"
            >
              查看全部 &rarr;
            </Link>
          </div>
          <Suspense fallback={<SkeletonCardGrid count={3} />}>
            <FeaturedTests />
          </Suspense>
        </section>

        {/* How It Works */}
        <section className="bg-gray-50 px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center font-bold text-2xl text-gray-900">
              三步探索自我
            </h2>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                  <MousePointerClick className="h-6 w-6" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">选择测试</h3>
                <p className="text-gray-500 text-sm">
                  从MBTI、九型人格等10种测试中选择你感兴趣的
                </p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                  <PenLine className="h-6 w-6" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">完成答题</h3>
                <p className="text-gray-500 text-sm">
                  轻松作答，即刻获取免费结果摘要和维度分析
                </p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h3 className="mb-2 font-semibold text-gray-900">
                  专家深度报告
                </h3>
                <p className="text-gray-500 text-sm">
                  付费解锁专家为你定制的深度分析报告
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </HydrateClient>
  );
}
