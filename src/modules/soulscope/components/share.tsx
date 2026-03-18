import { TRPCError } from '@trpc/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ResultSummary } from '@/modules/soulscope/components/result/result-summary';
import { Footer } from '@/shared/components/layout/footer';
import { Header } from '@/shared/components/layout/header';
import { api } from '@/trpc/server';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}): Promise<Metadata> {
  const { shareToken } = await params;
  try {
    const result = await api.soulscope.result.getByShareToken({ shareToken });
    return {
      title: `${result.resultLabel} - ${result.testType?.name} | SoulScope`,
      description: result.summary,
      openGraph: {
        title: `我的${result.testType?.name}结果：${result.resultLabel}`,
        description: result.summary,
        images: [`/api/og/${shareToken}`],
      },
    };
  } catch {
    return { title: 'SoulScope' };
  }
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ shareToken: string }>;
}) {
  const { shareToken } = await params;

  const result = await api.soulscope.result
    .getByShareToken({ shareToken })
    .catch((error) => {
      if (error instanceof TRPCError && error.code === 'NOT_FOUND') {
        notFound();
      }
      throw error;
    });

  return (
    <>
      <Header />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 text-center">
            <p className="text-gray-500 text-sm">SoulScope 人格测试结果</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
            <ResultSummary
              dimensionScores={result.dimensionScores as Record<string, number>}
              resultCode={result.resultCode}
              resultLabel={result.resultLabel}
              summary={result.summary}
              testName={result.testType?.name ?? ''}
            />
          </div>

          <div className="mt-8 text-center">
            <a
              className="inline-block rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-3 font-medium text-white shadow-lg transition-all hover:from-purple-700 hover:to-pink-700 hover:shadow-xl"
              href="/soulscope/tests"
            >
              我也要测试
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
