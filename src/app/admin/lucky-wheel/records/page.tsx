'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

const statusLabels: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  shipped: '已发货',
  claimed: '已领取',
};

export default function AdminRecordsPage() {
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { data, refetch } = api.luckyWheel.admin.getRecords.useQuery({
    limit,
    offset,
  });

  const updateMutation = api.luckyWheel.admin.updateRecordStatus.useMutation({
    onSuccess: () => {
      toast.success('状态已更新');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8">
            <Link
              className="text-orange-600 text-sm hover:text-orange-700"
              href="/admin/lucky-wheel"
            >
              &larr; 返回大转盘管理
            </Link>
            <h1 className="mt-2 font-bold text-3xl text-gray-900">
              中奖记录管理
            </h1>
          </div>

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    用户
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    活动
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    奖品
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    时间
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data?.items.map((record) => (
                  <tr key={record.id}>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-900">
                      {record.user?.name ?? record.userId}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {record.activity?.name ?? '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {record.isWin ? (record.prize?.name ?? '-') : '未中奖'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${
                          record.isWin
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {statusLabels[record.status] ?? record.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500 text-sm">
                      {new Date(record.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {record.isWin && (
                        <select
                          className="rounded border px-2 py-1 text-sm"
                          disabled={updateMutation.isPending}
                          onChange={(e) =>
                            updateMutation.mutate({
                              id: record.id,
                              status: e.target.value as
                                | 'pending'
                                | 'confirmed'
                                | 'shipped'
                                | 'claimed',
                            })
                          }
                          value={record.status}
                        >
                          {Object.entries(statusLabels).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-4">
              <button
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                disabled={currentPage <= 1}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                type="button"
              >
                上一页
              </button>
              <span className="text-gray-500 text-sm">
                {currentPage} / {totalPages}
              </span>
              <button
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + limit)}
                type="button"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
