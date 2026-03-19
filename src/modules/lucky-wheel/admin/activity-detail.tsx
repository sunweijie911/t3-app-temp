'use client';

import type { TableProps } from 'antd';
import {
  Breadcrumb,
  Button,
  Card,
  Col,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import Link from 'next/link';
import { use } from 'react';
import {
  PRIZE_TYPE_LABELS,
  RECORD_STATUS_LABELS,
} from '@/modules/lucky-wheel/constants';
import { api } from '@/trpc/react';

const STATUS_TAG_COLORS: Record<string, string> = {
  pending: 'orange',
  confirmed: 'green',
  shipped: 'blue',
  claimed: 'default',
};

type PrizeStat = {
  prizeId: string;
  prizeName: string;
  prizeType: string;
  probability: number;
  totalStock: number;
  remainingStock: number;
  value: Record<string, unknown> | null;
  drawnCount: number;
  activityId: string;
};

// 统计卡片
function StatCard({
  icon,
  label,
  value,
  color,
  suffix,
}: {
  icon: string;
  label: string;
  value: number;
  color: string;
  suffix?: string;
}) {
  return (
    <Card size="small" style={{ borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: `${color}14`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 2 }}>
            {label}
          </div>
          <div
            style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.2 }}
          >
            {value.toLocaleString()}
            {suffix && (
              <span style={{ fontSize: 16, fontWeight: 500 }}>{suffix}</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

const prizeColumns: TableProps<PrizeStat>['columns'] = [
  {
    title: '奖品',
    dataIndex: 'prizeName',
    render: (name: string) => <Typography.Text strong>{name}</Typography.Text>,
  },
  {
    title: '类型',
    dataIndex: 'prizeType',
    render: (type: string) => <Tag>{PRIZE_TYPE_LABELS[type] ?? type}</Tag>,
  },
  {
    title: '价值',
    dataIndex: 'value',
    render: (value: Record<string, unknown> | null) => {
      const display = value?.display as string;
      return (
        <Typography.Text>{display ? `${display}元` : '—'}</Typography.Text>
      );
    },
  },
  {
    title: '中奖数',
    dataIndex: 'drawnCount',
    width: 80,
    render: (count: number, record) => {
      if (record.prizeType === 'thanks') {
        return <Typography.Text type="secondary">—</Typography.Text>;
      }
      return (
        <Typography.Text strong style={{ color: '#f97316' }}>
          {count}
        </Typography.Text>
      );
    },
  },
  {
    title: '库存（剩余 / 总计）',
    key: 'stock',
    width: 240,
    render: (_, record) => {
      if (record.prizeType === 'thanks') {
        return <Typography.Text type="secondary">—</Typography.Text>;
      }
      const pct =
        record.totalStock > 0
          ? Math.round((record.drawnCount / record.totalStock) * 100)
          : 0;
      const stockMismatch =
        record.remainingStock !== record.totalStock - record.drawnCount;
      return (
        <div style={{ minWidth: 160 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <span>
              {record.remainingStock} / {record.totalStock}
            </span>
            {record.remainingStock <= 0 && (
              <Tag color="red" style={{ margin: 0 }}>
                库存为0
              </Tag>
            )}
            {stockMismatch && record.remainingStock > 0 && (
              <Tag color="orange" style={{ margin: 0 }}>
                库存异常
              </Tag>
            )}
          </div>
          <Progress
            percent={pct}
            showInfo={false}
            size="small"
            strokeColor={
              pct >= 90 ? '#f87171' : pct >= 60 ? '#fbbf24' : '#4ade80'
            }
          />
        </div>
      );
    },
  },
];

interface Props {
  params: Promise<{ activityId: string }>;
}

export default function AdminActivityOverviewPage({ params }: Props) {
  const { activityId } = use(params);
  const { data: stats } = api.luckyWheel.admin.stats.useQuery();
  const { data: recordStats } =
    api.luckyWheel.admin.activityRecordStats.useQuery({ activityId });

  const activityDrawStat = stats?.activityDrawStats.find(
    (a) => a.activityId === activityId,
  );
  const activityPrizes =
    stats?.prizeStats.filter((p) => p.activityId === activityId) ?? [];

  const totalDraws = activityDrawStat?.totalDraws ?? 0;
  const totalWins = activityDrawStat?.totalWins ?? 0;
  const uniqueUsers = activityDrawStat?.uniqueUsers ?? 0;
  const winRate =
    totalDraws > 0 ? Math.round((totalWins / totalDraws) * 100) : 0;

  return (
    <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
        {/* 面包屑 + 操作按钮 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <Breadcrumb
            items={[
              { title: <Link href="/admin/lucky-wheel">大转盘管理</Link> },
              { title: activityDrawStat?.activityName ?? '活动概览' },
            ]}
          />
          <Space>
            <Link href={`/admin/lucky-wheel/records?activityId=${activityId}`}>
              <Button size="small">中奖记录</Button>
            </Link>
            <Link href={`/admin/lucky-wheel/${activityId}/prizes`}>
              <Button size="small" type="primary">
                奖品配置
              </Button>
            </Link>
            <Link href={`/admin/lucky-wheel/${activityId}/chances`}>
              <Button size="small">额外次数</Button>
            </Link>
          </Space>
        </div>

        {/* 统计卡片 */}
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <StatCard
              color="#f97316"
              icon="🎯"
              label="总抽奖次数"
              value={totalDraws}
            />
          </Col>
          <Col span={6}>
            <StatCard
              color="#10b981"
              icon="🏆"
              label="中奖次数"
              value={totalWins}
            />
          </Col>
          <Col span={6}>
            <StatCard
              color="#3b82f6"
              icon="👤"
              label="参与用户数"
              value={uniqueUsers}
            />
          </Col>
          <Col span={6}>
            <StatCard
              color="#8b5cf6"
              icon="📊"
              label="中奖率"
              suffix="%"
              value={winRate}
            />
          </Col>
        </Row>

        {/* 中奖记录状态分布 */}
        {recordStats && recordStats.length > 0 && (
          <Card
            size="small"
            style={{ borderRadius: 12, marginBottom: 24 }}
            title="中奖记录状态分布"
          >
            <Space size="middle" wrap>
              {Object.entries(RECORD_STATUS_LABELS).map(([key, label]) => {
                const count =
                  recordStats.find((s) => s.status === key)?.count ?? 0;
                return (
                  <Tag
                    color={STATUS_TAG_COLORS[key]}
                    key={key}
                    style={{ fontSize: 13, padding: '2px 12px' }}
                  >
                    {label}：{count}
                  </Tag>
                );
              })}
            </Space>
          </Card>
        )}

        {/* 奖品库存表格 */}
        {activityPrizes.length > 0 && (
          <Card style={{ borderRadius: 12 }} title="中奖明细">
            <Table<PrizeStat>
              columns={prizeColumns}
              dataSource={activityPrizes as PrizeStat[]}
              pagination={false}
              rowKey="prizeId"
              size="small"
            />
          </Card>
        )}
      </div>
    </main>
  );
}
