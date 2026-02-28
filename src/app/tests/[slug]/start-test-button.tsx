'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { api } from '@/trpc/react';

export function StartTestButton({
  testTypeId,
  testSlug,
}: {
  testTypeId: string;
  testSlug: string;
}) {
  const router = useRouter();
  const { data: session } = authClient.useSession();

  const startAttempt = api.attempt.start.useMutation();

  const handleStart = async () => {
    if (!session?.user) {
      router.push('/signin');
      return;
    }

    try {
      const result = await startAttempt.mutateAsync({ testTypeId });
      router.push(`/tests/${testSlug}/take?attemptId=${result.id}`);
    } catch {
      toast.error('开始测试失败，请稍后重试');
    }
  };

  return (
    <button
      className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-4 font-semibold text-lg text-white shadow-lg transition-all hover:from-purple-700 hover:to-pink-700 hover:shadow-xl disabled:opacity-50"
      disabled={startAttempt.isPending}
      onClick={handleStart}
      type="button"
    >
      {startAttempt.isPending ? '准备中...' : '开始测试'}
    </button>
  );
}
