'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

const PAGE_SIZE = 50;

export default function AdminQuestionsPage({
  params,
}: {
  params: Promise<{ testTypeId: string }>;
}) {
  const { testTypeId } = use(params);
  const utils = api.useUtils();
  const [page, setPage] = useState(0);

  const { data: questions, isLoading } =
    api.soulscope.admin.getQuestions.useQuery({
      testTypeId,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    });

  const generateQuestions = api.soulscope.admin.generateQuestions.useMutation({
    onSuccess: () => {
      void utils.soulscope.admin.getQuestions.invalidate();
    },
  });

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <Link
              className="text-purple-600 text-sm hover:text-purple-700"
              href="/admin/soulscope/tests"
            >
              &larr; 返回测试列表
            </Link>
            <h1 className="mt-2 font-bold text-3xl text-gray-900">题目管理</h1>
          </div>

          <div className="mb-6 flex items-center gap-4">
            <button
              className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-sm text-white hover:bg-purple-700 disabled:opacity-50"
              disabled={generateQuestions.isPending}
              onClick={() => generateQuestions.mutate({ testTypeId, count: 5 })}
              type="button"
            >
              {generateQuestions.isPending ? 'AI生成中...' : 'AI生成5道题'}
            </button>
          </div>

          {isLoading ? (
            <div className="py-20 text-center text-gray-500">加载中...</div>
          ) : (
            <>
              <div className="space-y-4">
                {questions?.items.map((q, i) => (
                  <div className="rounded-xl bg-white p-6 shadow-sm" key={q.id}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-gray-400 text-sm">
                        #{page * PAGE_SIZE + i + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        {q.dimension && (
                          <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700 text-xs">
                            {q.dimension}
                          </span>
                        )}
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500 text-xs">
                          {q.source}
                        </span>
                      </div>
                    </div>
                    <p className="mb-3 font-medium text-gray-900">{q.text}</p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        q.options as Array<{ value: string; label: string }>
                      ).map((opt) => (
                        <span
                          className="rounded-lg bg-gray-50 px-3 py-1 text-gray-600 text-sm"
                          key={opt.value}
                        >
                          {opt.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-gray-500 text-sm">
                  共 {questions?.total ?? 0} 道题目
                </span>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                    type="button"
                  >
                    上一页
                  </button>
                  <span className="text-gray-600 text-sm">
                    第 {page + 1} 页
                  </span>
                  <button
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
                    disabled={
                      !questions || (page + 1) * PAGE_SIZE >= questions.total
                    }
                    onClick={() => setPage((p) => p + 1)}
                    type="button"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
