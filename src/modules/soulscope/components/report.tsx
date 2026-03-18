import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ReportViewer } from '@/modules/soulscope/components/report/report-viewer';
import { getSession } from '@/server/better-auth/server';
import { Footer } from '@/shared/components/layout/footer';
import { Header } from '@/shared/components/layout/header';
import { HydrateClient } from '@/trpc/server';

export const metadata = {
  title: '深度分析报告 - SoulScope',
};

export default async function ReportPage({
  params,
}: {
  params: Promise<{ resultId: string }>;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  const { resultId } = await params;

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            className="mb-6 inline-block text-purple-600 text-sm hover:text-purple-700"
            href={`/soulscope/results/${resultId}`}
          >
            &larr; 返回结果
          </Link>
          <ReportViewer resultId={resultId} />
        </div>
      </main>
      <Footer />
    </HydrateClient>
  );
}
