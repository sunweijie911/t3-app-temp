'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

const PAGE_SIZE = 20;

export default function AdminOrdersPage() {
  const [page, setPage] = useState(0);

  const { data, isLoading } = api.soulscope.admin.allOrders.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <Link
            className="text-purple-600 text-sm hover:text-purple-700"
            href="/admin/soulscope"
          >
            &larr; 返回管理后台
          </Link>
          <h1 className="mt-2 mb-8 font-bold text-3xl text-gray-900">
            订单管理
          </h1>

          {isLoading ? (
            <div className="py-20 text-center text-gray-500">加载中...</div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                        订单ID
                      </th>
                      <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                        金额
                      </th>
                      <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                        状态
                      </th>
                      <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                        时间
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data?.items.map((order) => (
                      <tr key={order.id}>
                        <td className="whitespace-nowrap px-6 py-4 font-mono text-gray-900 text-sm">
                          {order.id.slice(0, 12)}...
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                          &yen;{order.amount}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span
                            className={`rounded-full px-2 py-1 font-medium text-xs ${
                              order.status === 'paid'
                                ? 'bg-green-100 text-green-700'
                                : order.status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {order.status === 'paid'
                              ? '已付款'
                              : order.status === 'pending'
                                ? '待付款'
                                : order.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-gray-500 text-sm">
                          {new Date(order.createdAt).toLocaleString('zh-CN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-gray-500 text-sm">
                  共 {data?.total ?? 0} 条记录
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
                    disabled={!data || (page + 1) * PAGE_SIZE >= data.total}
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
