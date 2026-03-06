'use client';

import { RECORD_STATUS_LABELS } from '@/modules/lucky-wheel/constants';
import { api } from '@/trpc/react';

const STATUS_CONFIG: Record<
  string,
  { bg: string; text: string; label: string; desc: string }
> = {
  pending: {
    bg: '#FFF7ED',
    text: '#EA580C',
    label: '待确认',
    desc: '工作人员将尽快处理',
  },
  confirmed: {
    bg: '#F0FDF4',
    text: '#16A34A',
    label: '已确认',
    desc: '奖品已确认，等待发放',
  },
  shipped: {
    bg: '#EFF6FF',
    text: '#2563EB',
    label: '已发货',
    desc: '奖品已发出，请注意查收',
  },
  claimed: {
    bg: '#F3F4F6',
    text: '#6B7280',
    label: '已领取',
    desc: '奖品已领取完成',
  },
};

function StatusTag({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    bg: '#F3F4F6',
    text: '#6B7280',
    label: RECORD_STATUS_LABELS[status] ?? status,
    desc: '',
  };
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-xs"
      style={{ backgroundColor: config.bg, color: config.text }}
      title={config.desc}
    >
      {config.label}
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
            <span
              className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 font-medium text-gray-400 text-xs"
              style={{ backgroundColor: '#F9FAFB' }}
            >
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
