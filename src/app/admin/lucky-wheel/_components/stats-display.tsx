'use client';

import type { TableProps } from 'antd';
import {
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
import { PRIZE_TYPE_LABELS } from '@/modules/lucky-wheel/constants';

type PrizeStat = {
  prizeId: string;
  prizeName: string;
  prizeType: string;
  probability: number;
  totalStock: number;
  remainingStock: number;
  drawnCount: number;
};

type ActivityStat = {
  activityId: string;
  activityName: string;
  totalDraws: number;
  totalWins: number;
  prizes: PrizeStat[];
};

type AdminNavItem = {
  href: string;
  label: string;
  description?: string;
};

type Props = {
  byActivity: Record<string, ActivityStat>;
  navItems: AdminNavItem[];
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

export function StatsDisplay({ byActivity, navItems }: Props) {
  const activities = Object.values(byActivity);

  return (
    <>
      {/* 每个活动独立卡片 */}
      {activities.length === 0 ? (
        <Card style={{ marginBottom: 32, textAlign: 'center' }}>
          <Typography.Text type="secondary">暂无活跃活动</Typography.Text>
        </Card>
      ) : (
        activities.map((activity) => {
          const winRate =
            activity.totalDraws > 0
              ? Math.round((activity.totalWins / activity.totalDraws) * 1000) /
                10
              : 0;
          return (
            <Card
              extra={
                <Space>
                  <Link
                    href={`/admin/lucky-wheel/records?activityId=${activity.activityId}`}
                  >
                    中奖记录
                  </Link>
                  <Link
                    href={`/admin/lucky-wheel/${activity.activityId}/prizes`}
                  >
                    奖品配置
                  </Link>
                </Space>
              }
              key={activity.activityId}
              style={{ marginBottom: 24 }}
              title={activity.activityName}
            >
              {/* 活动维度统计 */}
              <Row gutter={16} style={{ marginBottom: 16 }}>
                <Col span={8}>
                  <Statistic title="总抽奖次数" value={activity.totalDraws} />
                </Col>
                <Col span={8}>
                  <Statistic title="总中奖数" value={activity.totalWins} />
                </Col>
                <Col span={8}>
                  <Statistic suffix="%" title="中奖率" value={winRate} />
                </Col>
              </Row>

              {/* 奖品发放明细 */}
              {activity.prizes.length > 0 && (
                <Table<PrizeStat>
                  columns={prizeColumns}
                  dataSource={activity.prizes}
                  pagination={false}
                  rowKey="prizeId"
                  size="small"
                />
              )}
            </Card>
          );
        })
      )}

      {/* 导航快捷卡片 */}
      <Row gutter={16} style={{ marginTop: 8 }}>
        {navItems.map((item) => (
          <Col key={item.href} sm={12} xs={24}>
            <Link href={item.href} style={{ display: 'block' }}>
              <Card hoverable style={{ marginBottom: 16 }}>
                <Typography.Title level={5} style={{ marginBottom: 4 }}>
                  {item.label}
                </Typography.Title>
                <Typography.Text style={{ fontSize: 13 }} type="secondary">
                  {item.description}
                </Typography.Text>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </>
  );
}
