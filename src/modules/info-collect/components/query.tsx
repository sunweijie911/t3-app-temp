'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import {
  PHONE_RE,
  REVIEW_STATUS_LABELS,
} from '@/modules/info-collect/constants';
import { api } from '@/trpc/react';

const STATUS_ICONS: Record<string, string> = {
  pending: '\u23F3',
  approved: '\u2705',
  rejected: '\u274C',
  needs_supplement: '\u270F\uFE0F',
  completed: '\uD83D\uDCE6',
};

export default function InfoCollectQueryPage() {
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState(false);

  const {
    data: records,
    refetch,
    isFetching,
  } = api.infoCollect.query.useQuery({ phone }, { enabled: false });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!PHONE_RE.test(phone)) {
      toast.error('请输入有效的手机号');
      return;
    }
    setSearched(true);
    void refetch();
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{
        background:
          'linear-gradient(180deg, #3B82F6 0%, #60A5FA 40%, #93C5FD 100%)',
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          backdropFilter: 'blur(30px)',
          WebkitBackdropFilter: 'blur(30px)',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,1) 56%)',
        }}
      >
        <h1 className="mb-1 text-center font-bold text-gray-800 text-xl">
          进度查询
        </h1>
        <p className="mb-6 text-center text-gray-400 text-sm">
          输入手机号查询审核进度
        </p>

        <form className="space-y-4" onSubmit={handleSearch}>
          <div>
            <input
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              inputMode="tel"
              maxLength={11}
              onChange={(e) => {
                setPhone(e.target.value);
                setSearched(false);
              }}
              placeholder="请输入手机号"
              type="tel"
              value={phone}
            />
          </div>

          <button
            className="w-full rounded-lg bg-blue-500 py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isFetching}
            type="submit"
          >
            {isFetching ? '查询中...' : '查询'}
          </button>
        </form>

        {/* 查询结果 */}
        {searched && !isFetching && (
          <div className="mt-6">
            {!records || records.length === 0 ? (
              <div className="py-4 text-center text-gray-400 text-sm">
                未找到相关记录
              </div>
            ) : (
              <div className="space-y-3">
                {records.map((r) => (
                  <div
                    className="rounded-lg border border-gray-200 bg-white p-4"
                    key={r.id}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium text-gray-700 text-sm">
                        {STATUS_ICONS[r.status] ?? ''}{' '}
                        {REVIEW_STATUS_LABELS[r.status] ?? r.status}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>

                    {r.status === 'rejected' && r.rejectReason && (
                      <div>
                        <p className="mt-1 text-red-500 text-xs">
                          拒绝原因：{r.rejectReason}
                        </p>
                        <a
                          className="mt-1 inline-block text-blue-500 text-xs hover:text-blue-600"
                          href="/info-collect"
                        >
                          重新提交 &rarr;
                        </a>
                      </div>
                    )}

                    {r.status === 'needs_supplement' && r.rejectReason && (
                      <div>
                        <p className="mt-1 text-orange-500 text-xs">
                          需补充：{r.rejectReason}
                        </p>
                        <a
                          className="mt-1 inline-block text-blue-500 text-xs hover:text-blue-600"
                          href="/info-collect"
                        >
                          重新提交 &rarr;
                        </a>
                      </div>
                    )}

                    {r.status === 'completed' && r.trackingNumber && (
                      <p className="mt-1 text-green-600 text-xs">
                        发货单号：{r.trackingNumber}
                      </p>
                    )}

                    {r.status === 'approved' && (
                      <p className="mt-1 text-blue-500 text-xs">
                        审核已通过，等待发货
                      </p>
                    )}

                    {r.status === 'pending' && (
                      <p className="mt-1 text-gray-400 text-xs">
                        正在审核中，请耐心等待
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 返回链接 */}
            <div className="mt-4 text-center">
              <a
                className="text-blue-500 text-sm hover:text-blue-600"
                href="/info-collect"
              >
                返回信息采集
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
