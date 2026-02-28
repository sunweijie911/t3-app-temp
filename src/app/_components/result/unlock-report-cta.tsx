'use client';

import { Lock, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/trpc/react';

interface UnlockReportCtaProps {
  resultId: string;
  price: string;
  hasReport: boolean;
  hasPaidOrder: boolean;
}

export function UnlockReportCta({
  resultId,
  price,
  hasReport,
  hasPaidOrder,
}: UnlockReportCtaProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const createOrder = api.order.create.useMutation();
  const simulatePayment = api.order.simulatePayment.useMutation();
  const generateReport = api.report.generate.useMutation();
  const utils = api.useUtils();

  if (hasReport) {
    return (
      <button
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-4 font-medium text-white shadow-lg transition-all hover:from-purple-700 hover:to-pink-700 hover:shadow-xl"
        onClick={() => router.push(`/results/${resultId}/report`)}
        type="button"
      >
        <Sparkles className="h-5 w-5" />
        查看深度分析报告
      </button>
    );
  }

  const pollUntilComplete = async (toastId: string | number) => {
    const maxAttempts = 60; // 60 * 2s = 2 minutes max
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const { status } = await utils.report.status.fetch({ resultId });
      if (status === 'completed') {
        toast.dismiss(toastId);
        toast.success('报告生成完成！');
        router.push(`/results/${resultId}/report`);
        return;
      }
      if (status === 'failed') {
        toast.dismiss(toastId);
        toast.error('报告生成失败，请稍后重试');
        setIsLoading(false);
        return;
      }
    }
    toast.dismiss(toastId);
    toast.error('报告生成超时，请稍后查看');
    setIsLoading(false);
  };

  const handleUnlock = async () => {
    setIsLoading(true);
    try {
      if (!hasPaidOrder) {
        const order = await createOrder.mutateAsync({ resultId });
        await simulatePayment.mutateAsync({ orderId: order.id });
        toast.success('支付成功！');
      }
      const toastId = toast.loading('正在生成报告，请稍候...');
      await generateReport.mutateAsync({ resultId });
      // Generation is now async — poll for completion
      void pollUntilComplete(toastId);
    } catch (_error) {
      toast.error('操作失败，请稍后重试');
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-purple-200 border-dashed bg-purple-50/50 p-6 text-center">
      <h3 className="mb-2 font-semibold text-gray-900 text-lg">
        解锁深度分析报告
      </h3>
      <p className="mb-4 text-gray-500 text-sm">
        专业心理咨询师为你量身定制的深度人格分析，包含个性化建议
      </p>
      <button
        className="mx-auto flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-3 font-medium text-white shadow-lg transition-all hover:from-purple-700 hover:to-pink-700 hover:shadow-xl disabled:opacity-50"
        disabled={isLoading}
        onClick={handleUnlock}
        type="button"
      >
        <Lock className="h-4 w-4" />
        {isLoading ? '处理中...' : `¥${price} 解锁报告`}
      </button>
    </div>
  );
}
