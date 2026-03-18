import { redirect } from 'next/navigation';
import { TestContainer } from '@/modules/soulscope/components/attempt/test-container';
import { getSession } from '@/server/better-auth/server';
import { Header } from '@/shared/components/layout/header';
import { HydrateClient } from '@/trpc/server';

export default async function TakeTestPage({
  searchParams,
}: {
  searchParams: Promise<{ attemptId?: string }>;
}) {
  const session = await getSession();
  if (!session?.user) {
    redirect('/signin');
  }

  const { attemptId } = await searchParams;
  if (!attemptId) {
    redirect('/soulscope/tests');
  }

  return (
    <HydrateClient>
      <Header />
      <main className="min-h-screen bg-white">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <TestContainer attemptId={attemptId} />
        </div>
      </main>
    </HydrateClient>
  );
}
