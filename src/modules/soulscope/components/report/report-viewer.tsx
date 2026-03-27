'use client';

import { SkeletonBlock, SkeletonText } from '@/shared/components/skeleton';
import { MarkdownRenderer } from '@/shared/components/ui/markdown-renderer';
import { api } from '@/trpc/react';

export function ReportViewer({ resultId }: { resultId: string }) {
  const {
    data: report,
    isLoading,
    isError,
    error,
  } = api.soulscope.report.get.useQuery({
    resultId,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <SkeletonBlock height={32} rounded="lg" width="40%" />
        </div>
        <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
          {/* 模拟 markdown 报告结构：标题 + 段落 + 小标题 + 段落 */}
          <SkeletonBlock height={24} rounded="md" width="60%" />
          <SkeletonText gap={10} lineHeight={16} lines={4} />
          <SkeletonBlock height={20} rounded="md" width="45%" />
          <SkeletonText gap={10} lineHeight={16} lines={5} />
          <SkeletonBlock height={20} rounded="md" width="50%" />
          <SkeletonText gap={10} lineHeight={16} lines={3} />
        </div>
      </div>
    );
  }

  if (isError) {
    const isForbidden = error?.data?.code === 'FORBIDDEN';
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-gray-500">
          {isForbidden
            ? '暂无权限查看该报告，请确认已完成支付'
            : '加载报告失败，请稍后重试'}
        </p>
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
