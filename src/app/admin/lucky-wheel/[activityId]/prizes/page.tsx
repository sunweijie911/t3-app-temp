'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

const prizeTypeLabels: Record<string, string> = {
  physical: '实物',
  virtual: '虚拟',
  coupon: '优惠券',
  points: '积分',
  thanks: '谢谢参与',
};

interface Props {
  params: Promise<{ activityId: string }>;
}

export default function AdminPrizesPage({ params }: Props) {
  const { activityId } = use(params);

  const { data: prizes, refetch } = api.luckyWheel.admin.getPrizes.useQuery({
    activityId,
  });
  const upsertMutation = api.luckyWheel.admin.upsertPrize.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = api.luckyWheel.admin.deletePrize.useMutation({
    onSuccess: () => {
      toast.success('已下线');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    type: 'physical' | 'virtual' | 'coupon' | 'points' | 'thanks';
    probability: number;
    totalStock: number;
    sortOrder: number;
  } | null>(null);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <Link
                className="text-orange-600 text-sm hover:text-orange-700"
                href="/admin/lucky-wheel/activities"
              >
                &larr; 返回活动管理
              </Link>
              <h1 className="mt-2 font-bold text-3xl text-gray-900">
                奖品配置
              </h1>
            </div>
            <button
              className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-sm text-white hover:bg-orange-600"
              onClick={() =>
                setEditing({
                  name: '',
                  type: 'thanks',
                  probability: 0,
                  totalStock: 0,
                  sortOrder: 0,
                })
              }
              type="button"
            >
              添加奖品
            </button>
          </div>

          {/* Probability hint */}
          {prizes && prizes.length > 0 && (
            <div className="mb-4 rounded-lg bg-orange-50 px-4 py-2 text-orange-700 text-sm">
              概率总和：
              {prizes.reduce((s, p) => s + p.probability, 0)} / 10000 （万分比）
            </div>
          )}

          {/* Edit Form */}
          {editing && (
            <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-semibold text-lg">
                {editing.id ? '编辑奖品' : '添加奖品'}
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="奖品名称"
                  value={editing.name}
                />
                <select
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      type: e.target.value as typeof editing.type,
                    })
                  }
                  value={editing.type}
                >
                  {Object.entries(prizeTypeLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      probability: Number(e.target.value) || 0,
                    })
                  }
                  placeholder="概率 (万分比)"
                  type="number"
                  value={editing.probability}
                />
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      totalStock: Number(e.target.value) || 0,
                    })
                  }
                  placeholder="总库存"
                  type="number"
                  value={editing.totalStock}
                />
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      sortOrder: Number(e.target.value) || 0,
                    })
                  }
                  placeholder="排序"
                  type="number"
                  value={editing.sortOrder}
                />
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-sm text-white hover:bg-orange-600 disabled:opacity-50"
                  disabled={upsertMutation.isPending}
                  onClick={() =>
                    upsertMutation.mutate({
                      id: editing.id,
                      activityId,
                      name: editing.name,
                      type: editing.type,
                      probability: editing.probability,
                      totalStock: editing.totalStock,
                      sortOrder: editing.sortOrder,
                    })
                  }
                  type="button"
                >
                  {upsertMutation.isPending ? '保存中...' : '保存'}
                </button>
                <button
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
                  onClick={() => setEditing(null)}
                  type="button"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {/* Prizes Table */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    名称
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    类型
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    概率
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    库存
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {prizes?.map((prize) => (
                  <tr key={prize.id}>
                    <td className="whitespace-nowrap px-6 py-4 font-medium text-gray-900">
                      {prize.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {prizeTypeLabels[prize.type] ?? prize.type}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {prize.probability} / 10000
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {prize.remainingStock} / {prize.totalStock}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex gap-3">
                        <button
                          className="text-orange-600 text-sm hover:text-orange-700"
                          onClick={() =>
                            setEditing({
                              id: prize.id,
                              name: prize.name,
                              type: prize.type,
                              probability: prize.probability,
                              totalStock: prize.totalStock,
                              sortOrder: prize.sortOrder,
                            })
                          }
                          type="button"
                        >
                          编辑
                        </button>
                        {prize.isActive && (
                          <button
                            className="text-red-600 text-sm hover:text-red-700"
                            onClick={() =>
                              deleteMutation.mutate({ id: prize.id })
                            }
                            type="button"
                          >
                            下线
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}
