'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

export default function AdminActivitiesPage() {
  const { data: activities, refetch } =
    api.luckyWheel.admin.listActivities.useQuery();
  const upsertMutation = api.luckyWheel.admin.upsertActivity.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = api.luckyWheel.admin.deleteActivity.useMutation({
    onSuccess: () => {
      toast.success('已下线');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    slug: string;
    description: string;
    maxDrawsPerUser: number;
    maxDrawsPerDay: number;
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
                href="/admin/lucky-wheel"
              >
                &larr; 返回大转盘管理
              </Link>
              <h1 className="mt-2 font-bold text-3xl text-gray-900">
                活动管理
              </h1>
            </div>
            <button
              className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-sm text-white hover:bg-orange-600"
              onClick={() =>
                setEditing({
                  name: '',
                  slug: '',
                  description: '',
                  maxDrawsPerUser: 0,
                  maxDrawsPerDay: 0,
                })
              }
              type="button"
            >
              新建活动
            </button>
          </div>

          {/* Edit Form */}
          {editing && (
            <div className="mb-8 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-semibold text-lg">
                {editing.id ? '编辑活动' : '新建活动'}
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="活动名称"
                  value={editing.name}
                />
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({ ...editing, slug: e.target.value })
                  }
                  placeholder="URL标识 (slug)"
                  value={editing.slug}
                />
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      maxDrawsPerUser: Number(e.target.value) || 0,
                    })
                  }
                  placeholder="每人总次数限制 (0=不限)"
                  type="number"
                  value={editing.maxDrawsPerUser}
                />
                <input
                  className="rounded-lg border px-3 py-2"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      maxDrawsPerDay: Number(e.target.value) || 0,
                    })
                  }
                  placeholder="每人每日次数限制 (0=不限)"
                  type="number"
                  value={editing.maxDrawsPerDay}
                />
                <textarea
                  className="rounded-lg border px-3 py-2 md:col-span-2"
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  placeholder="活动描述"
                  rows={3}
                  value={editing.description}
                />
              </div>
              <div className="mt-4 flex gap-3">
                <button
                  className="rounded-lg bg-orange-500 px-4 py-2 font-medium text-sm text-white hover:bg-orange-600 disabled:opacity-50"
                  disabled={upsertMutation.isPending}
                  onClick={() =>
                    upsertMutation.mutate({
                      id: editing.id,
                      name: editing.name,
                      slug: editing.slug,
                      description: editing.description || null,
                      maxDrawsPerUser: editing.maxDrawsPerUser,
                      maxDrawsPerDay: editing.maxDrawsPerDay,
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

          {/* Activities Table */}
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    名称
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    Slug
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {activities?.map((activity) => (
                  <tr key={activity.id}>
                    <td className="whitespace-nowrap px-6 py-4 font-medium text-gray-900">
                      {activity.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-gray-500">
                      {activity.slug}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      {activity.isActive ? (
                        <span className="rounded-full bg-green-100 px-2 py-1 text-green-700 text-xs">
                          活跃
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500 text-xs">
                          已下线
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex gap-3">
                        <Link
                          className="text-orange-600 text-sm hover:text-orange-700"
                          href={`/admin/lucky-wheel/${activity.id}/prizes`}
                        >
                          奖品配置
                        </Link>
                        <button
                          className="text-orange-600 text-sm hover:text-orange-700"
                          onClick={() =>
                            setEditing({
                              id: activity.id,
                              name: activity.name,
                              slug: activity.slug,
                              description: activity.description ?? '',
                              maxDrawsPerUser: activity.maxDrawsPerUser,
                              maxDrawsPerDay: activity.maxDrawsPerDay,
                            })
                          }
                          type="button"
                        >
                          编辑
                        </button>
                        {activity.isActive && (
                          <button
                            className="text-red-600 text-sm hover:text-red-700"
                            onClick={() =>
                              deleteMutation.mutate({ id: activity.id })
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
