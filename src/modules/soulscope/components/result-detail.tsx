import { TRPCError } from '@trpc/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ResultSummary } from '@/modules/soulscope/components/result/result-summary';
import { ShareButtons } from '@/modules/soulscope/components/result/share-buttons';
import { UnlockReportCta } from '@/modules/soulscope/components/result/unlock-report-cta';
import { getSession } from '@/server/better-auth/server';
import { Footer } from '@/shared/components/layout/footer';
import { Header } from '@/shared/components/layout/header';
import { api, HydrateClient } from '@/trpc/server';

export default async function ResultDetailPage({
  params,
}: {
  params: Promise<{ resultId: string }>;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  const { resultId } = await params;

  const result = await api.soulscope.result
    .getById({ id: resultId })
    .catch((error) => {
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
            href="/soulscope/results"
          >
            &larr; 返回我的结果
          </Link>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
            <ResultSummary
              dimensionScores={result.dimensionScores as Record<string, number>}
              resultCode={result.resultCode}
              resultLabel={result.resultLabel}
              summary={result.summary}
              testName={result.testType?.name ?? ''}
            />
          </div>

          <div className="mt-6 flex items-center justify-between">
            <ShareButtons shareToken={result.shareToken} />
          </div>

          <div className="mt-8">
            <UnlockReportCta
              hasPaidOrder={result.hasPaidOrder}
              hasReport={result.hasReport}
              price={result.testType?.reportPrice ?? '9.90'}
              resultId={result.id}
            />
          </div>
        </div>
      </main>
      <Footer />
    </HydrateClient>
  );
}
