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
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import Link from 'next/link';
import { use } from 'react';
import { Header } from '@/app/_components/layout/header';
import { PRIZE_TYPE_LABELS } from '@/modules/lucky-wheel/constants';
import { api } from '@/trpc/react';

type PrizeStat = {
  prizeId: string;
  prizeName: string;
  prizeType: string;
  probability: number;
  totalStock: number;
  remainingStock: number;
  drawnCount: number;
  activityId: string;
};

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
    title: '概率',
    dataIndex: 'probability',
    render: (prob: number) => `${prob / 100}%`,
  },
  {
    title: '已发放 / 总库存',
    key: 'stock',
    width: 240,
    render: (_, record) => {
      if (record.prizeType === 'thanks') {
        return <Typography.Text type="secondary">—</Typography.Text>;
      }
      const consumed = record.totalStock - record.remainingStock;
      const pct =
        record.totalStock > 0
          ? Math.round((consumed / record.totalStock) * 100)
          : 0;
      const status = pct >= 90 ? 'exception' : pct >= 60 ? 'normal' : 'success';
      return (
        <div style={{ minWidth: 180 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <span>
              {record.drawnCount} / {record.totalStock}
            </span>
            {record.remainingStock === 0 && (
              <Tag color="red" style={{ margin: 0 }}>
                已售罄
              </Tag>
            )}
          </div>
          <Progress
            percent={pct}
            showInfo={false}
            size="small"
            status={status}
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

  const activityDrawStat = stats?.activityDrawStats.find(
    (a) => a.activityId === activityId,
  );
  const activityPrizes =
    stats?.prizeStats.filter((p) => p.activityId === activityId) ?? [];

  const totalDraws = activityDrawStat?.totalDraws ?? 0;
  const totalWins = activityDrawStat?.totalWins ?? 0;
  const winRate =
    totalDraws > 0 ? Math.round((totalWins / totalDraws) * 1000) / 10 : 0;

  return (
    <>
      <Header />
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
          <Breadcrumb
            className="mb-6"
            items={[
              { title: <Link href="/admin/lucky-wheel">大转盘管理</Link> },
              { title: activityDrawStat?.activityName ?? '活动概览' },
            ]}
          />

          <Card
            extra={
              <Space>
                <Link
                  href={`/admin/lucky-wheel/records?activityId=${activityId}`}
                >
                  <Button size="small">中奖记录</Button>
                </Link>
                <Link href={`/admin/lucky-wheel/${activityId}/prizes`}>
                  <Button size="small">奖品配置</Button>
                </Link>
                <Link href={`/admin/lucky-wheel/${activityId}/chances`}>
                  <Button size="small">额外次数</Button>
                </Link>
              </Space>
            }
            title={activityDrawStat?.activityName ?? '活动概览'}
          >
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Statistic title="总抽奖次数" value={totalDraws} />
              </Col>
              <Col span={8}>
                <Statistic title="总中奖数" value={totalWins} />
              </Col>
              <Col span={8}>
                <Statistic suffix="%" title="中奖率" value={winRate} />
              </Col>
            </Row>

            {activityPrizes.length > 0 && (
              <Table<PrizeStat>
                columns={prizeColumns}
                dataSource={activityPrizes as PrizeStat[]}
                pagination={false}
                rowKey="prizeId"
                size="small"
              />
            )}
          </Card>
        </div>
      </main>
    </>
  );
}
