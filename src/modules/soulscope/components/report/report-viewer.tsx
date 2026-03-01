'use client';

import { LoadingSpinner } from '@/app/_components/ui/loading-spinner';
import { MarkdownRenderer } from '@/app/_components/ui/markdown-renderer';
import { api } from '@/trpc/react';

export function ReportViewer({ resultId }: { resultId: string }) {
  const { data: report, isLoading } = api.soulscope.report.get.useQuery({
    resultId,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <LoadingSpinner size="lg" />
        <p className="text-gray-500">加载报告中...</p>
      </div>
    );
  }

  if (!report?.content) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-gray-500">报告尚未生成</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-bold text-2xl text-gray-900">深度分析报告</h1>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
        <MarkdownRenderer content={report.content} />
      </div>
    </div>
  );
}
