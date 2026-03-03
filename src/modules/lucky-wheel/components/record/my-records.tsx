'use client';

import { RECORD_STATUS_LABELS } from '@/modules/lucky-wheel/constants';
import { api } from '@/trpc/react';

// 状态标签颜色配置（方块标签样式，非按钮）
const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FFF7ED', text: '#C2410C' }, // 待确认 — 橙
  confirmed: { bg: '#F0FDF4', text: '#15803D' }, // 已确认 — 绿
  shipped: { bg: '#EFF6FF', text: '#1D4ED8' }, // 已发货 — 蓝
  claimed: { bg: '#F3F4F6', text: '#9CA3AF' }, // 已领取 — 灰
};

function StatusTag({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { bg: '#F3F4F6', text: '#6B7280' };
  return (
    <span
      className="shrink-0 select-none rounded-md px-2 py-1 font-medium text-xs"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {RECORD_STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ─── Shared record list rendering (used by both Sheet and standalone page) ───

export function RecordListContent({
  records,
  isLoading,
}: {
  records:
    | {
        id: string;
        isWin: boolean;
        status: string;
        createdAt: Date;
        prize: { name: string } | null;
        activity: { name: string } | null;
      }[]
    | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div className="h-16 animate-pulse rounded-xl bg-orange-50" key={i} />
        ))}
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center py-12 text-gray-400">
        暂无抽奖记录
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((record) => (
        <div
          className="flex items-center gap-3 rounded-2xl bg-white/80 p-3 shadow-sm"
          key={record.id}
        >
          {/* Prize icon circle */}
          <div
            className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full text-xl"
            style={{
              background: 'linear-gradient(135deg, #FFE7AF, #FFC5B7)',
            }}
          >
            {record.isWin ? '🎁' : '💫'}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-gray-900">
              {record.isWin && record.prize ? record.prize.name : '谢谢参与'}
            </p>
            <p className="truncate text-gray-400 text-xs">
              {record.activity?.name} &middot;{' '}
              {new Date(record.createdAt).toLocaleString()}
            </p>
          </div>

          {/* Status tag */}
          {record.isWin ? (
            <StatusTag status={record.status} />
          ) : (
            <span className="shrink-0 select-none rounded-md bg-gray-100 px-2 py-1 text-gray-400 text-xs">
              未中奖
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Standalone list component (for the /lucky-wheel/records page) ───

export function MyRecords() {
  const { data: records, isLoading } =
    api.luckyWheel.record.myRecords.useQuery();

  return <RecordListContent isLoading={isLoading} records={records} />;
}
