import { TRPCError } from '@trpc/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Footer } from '@/app/_components/layout/footer';
import { Header } from '@/app/_components/layout/header';
import { api, HydrateClient } from '@/trpc/server';
import { StartTestButton } from './start-test-button';

export default async function TestDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const testType = await api.test.getBySlug({ slug }).catch((error) => {
    if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
      notFound();
    }
    throw error;
  });

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            className="mb-6 inline-block text-purple-600 text-sm hover:text-purple-700"
            href="/tests"
          >
            &larr; 返回全部测试
          </Link>

          <div className="mb-8">
            <h1 className="mb-3 font-bold text-3xl text-gray-900">
              {testType.name}
            </h1>
            <div className="mb-4 flex items-center gap-4 text-gray-500 text-sm">
              <span>{testType.questionCount} 题</span>
              <span>&middot;</span>
              <span>约{testType.estimatedMinutes}分钟</span>
              <span>&middot;</span>
              <span>报告 &yen;{testType.reportPrice}</span>
            </div>
          </div>

          <div className="mb-8 rounded-2xl bg-gray-50 p-6">
            <p className="whitespace-pre-line text-gray-600 leading-relaxed">
              {testType.description}
            </p>
          </div>

          <StartTestButton testSlug={testType.slug} testTypeId={testType.id} />
        </div>
      </main>
      <Footer />
    </HydrateClient>
  );
}
