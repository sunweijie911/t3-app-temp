'use client';

import type { TableProps } from 'antd';
import {
  Breadcrumb,
  Button,
  Card,
  Form,
  Input,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/app/_components/layout/header';
import {
  PRIZE_TYPE_LABELS,
  RECORD_STATUS_LABELS,
} from '@/modules/lucky-wheel/constants';
import type { WheelUserInfo } from '@/modules/lucky-wheel/schema';
import { api } from '@/trpc/react';

type Filters = {
  activityId: string;
  isWin: '' | 'true' | 'false';
  status: string;
  prizeType: string;
  search: string;
};

const defaultFilters: Filters = {
  activityId: '',
  isWin: '',
  status: '',
  prizeType: '',
  search: '',
};

function buildFilterInput(filters: Filters) {
  return {
    activityId: filters.activityId || undefined,
    isWin:
      filters.isWin === 'true'
        ? true
        : filters.isWin === 'false'
          ? false
          : undefined,
    status:
      (filters.status as
        | 'pending'
        | 'confirmed'
        | 'shipped'
        | 'claimed'
        | undefined) || undefined,
    prizeType:
      (filters.prizeType as
        | 'physical'
        | 'virtual'
        | 'coupon'
        | 'points'
        | 'thanks'
        | undefined) || undefined,
    search: filters.search || undefined,
  };
}

type ExportRecord = {
  createdAt: Date;
  userId: string;
  isWin: boolean;
  status: string;
  userInfo: WheelUserInfo | null;
  user?: { name?: string | null; phoneNumber?: string | null } | null;
  activity?: { name?: string } | null;
  prize?: { name?: string; type?: string } | null;
};

function toCsv(records: ExportRecord[]): string {
  const headers = [
    '抽奖时间',
    '用户手机',
    '用户名',
    '活动',
    '奖品',
    '奖品类型',
    '状态',
    '收件人',
    '手机',
    '收货地址',
  ];
  const csvEscape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = records.map((r) => {
    const info = r.userInfo;
    return [
      new Date(r.createdAt).toLocaleString('zh-CN'),
      r.user?.phoneNumber ?? r.userId,
      r.user?.name ?? '',
      r.activity?.name ?? '',
      r.isWin ? (r.prize?.name ?? '') : '未中奖',
      r.isWin ? (PRIZE_TYPE_LABELS[r.prize?.type ?? ''] ?? '') : '',
      RECORD_STATUS_LABELS[r.status] ?? r.status,
      info?.name ?? '',
      info?.phone ?? '',
      info?.address ?? '',
    ].map(csvEscape);
  });
  return (
    '\ufeff' +
    [headers.map(csvEscape), ...rows].map((row) => row.join(',')).join('\n')
  );
}

// 状态 Tag 颜色映射
const STATUS_TAG_COLOR: Record<string, string> = {
  pending: 'orange',
  confirmed: 'green',
  shipped: 'blue',
  claimed: 'default',
};

type RecordItem = NonNullable<
  ReturnType<typeof api.luckyWheel.admin.getRecords.useQuery>['data']
>['items'][number];

export default function AdminRecordsPage() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>({
    ...defaultFilters,
    activityId: searchParams.get('activityId') ?? '',
  });
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [exporting, setExporting] = useState(false);

  const { data: activities } = api.luckyWheel.admin.listActivities.useQuery();
  const utils = api.useUtils();

  const queryInput = { ...buildFilterInput(filters), limit, offset };

  const { data, refetch } =
    api.luckyWheel.admin.getRecords.useQuery(queryInput);

  const updateMutation = api.luckyWheel.admin.updateRecordStatus.useMutation({
    onSuccess: () => {
      toast.success('状态已更新');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const currentPage = Math.floor(offset / limit) + 1;

  function applyFilters(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setOffset(0);
  }

  function resetFilters() {
    setFilters(defaultFilters);
    setOffset(0);
  }

  async function handleExport() {
    setExporting(true);
    try {
      const records = await utils.luckyWheel.admin.exportRecords.fetch(
        buildFilterInput(filters),
      );
      const csv = toCsv(records);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `records_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${records.length} 条记录`);
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const columns: TableProps<RecordItem>['columns'] = [
    {
      title: '用户',
      key: 'user',
      render: (_, record) => (
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {record.user?.name ?? '—'}
          </Typography.Text>
          <br />
          <Typography.Text style={{ fontSize: 12 }} type="secondary">
            {record.user?.phoneNumber ?? record.userId}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '活动',
      key: 'activity',
      render: (_, record) => (
        <Typography.Text>{record.activity?.name ?? '—'}</Typography.Text>
      ),
    },
    {
      title: '奖品',
      key: 'prize',
      render: (_, record) =>
        record.isWin ? (
          <div>
            <Typography.Text strong style={{ fontSize: 14 }}>
              {record.prize?.name ?? '—'}
            </Typography.Text>
            <br />
            <Typography.Text style={{ fontSize: 12 }} type="secondary">
              {PRIZE_TYPE_LABELS[record.prize?.type ?? ''] ?? ''}
            </Typography.Text>
          </div>
        ) : (
          <Typography.Text type="secondary">未中奖</Typography.Text>
        ),
    },
    {
      title: '收货信息',
      key: 'userInfo',
      render: (_, record) => {
        const info = record.userInfo;
        const isPhysical = record.prize?.type === 'physical';
        if (!isPhysical || !record.isWin) {
          return (
            <Typography.Text style={{ fontSize: 12 }} type="secondary">
              —
            </Typography.Text>
          );
        }
        if (!info) {
          return (
            <Typography.Text style={{ color: '#f59e0b', fontSize: 12 }}>
              未提交
            </Typography.Text>
          );
        }
        return (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {info.name} / {info.phone}
            </Typography.Text>
            <br />
            <Typography.Text
              ellipsis={{ tooltip: info.address ?? undefined }}
              style={{ fontSize: 12, maxWidth: 200 }}
              type="secondary"
            >
              {info.address}
            </Typography.Text>
          </div>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_, record) => (
        <Tag color={STATUS_TAG_COLOR[record.status] ?? 'default'}>
          {RECORD_STATUS_LABELS[record.status] ?? record.status}
        </Tag>
      ),
    },
    {
      title: '时间',
      key: 'createdAt',
      render: (_, record) => (
        <Typography.Text style={{ fontSize: 13 }}>
          {new Date(record.createdAt).toLocaleString('zh-CN')}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) =>
        record.isWin ? (
          <Select
            disabled={updateMutation.isPending}
            onChange={(value) =>
              updateMutation.mutate({
                id: record.id,
                status: value as
                  | 'pending'
                  | 'confirmed'
                  | 'shipped'
                  | 'claimed',
              })
            }
            options={Object.entries(RECORD_STATUS_LABELS).map(([k, v]) => ({
              value: k,
              label: v,
            }))}
            size="small"
            style={{ width: 100 }}
            value={record.status}
          />
        ) : null,
    },
  ];

  return (
    <>
      <Header />
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 24px' }}>
          {/* 面包屑 + 操作区 */}
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
                {
                  title: <Link href="/admin/lucky-wheel">大转盘管理</Link>,
                },
                {
                  title: '中奖记录管理',
                },
              ]}
            />
            <Button loading={exporting} onClick={handleExport}>
              {exporting ? '导出中...' : '导出 CSV'}
            </Button>
          </div>

          {/* 筛选栏 */}
          <Card style={{ marginBottom: 16 }}>
            <Form layout="inline" style={{ rowGap: 8 }}>
              <Form.Item label="搜索用户">
                <Input.Search
                  allowClear
                  onChange={(e) => applyFilters({ search: e.target.value })}
                  onSearch={(v) => applyFilters({ search: v })}
                  placeholder="姓名 / 手机号"
                  style={{ width: 200 }}
                  value={filters.search}
                />
              </Form.Item>

              <Form.Item label="活动">
                <Select
                  allowClear
                  onChange={(v) => applyFilters({ activityId: v ?? '' })}
                  options={[
                    ...(activities?.map((a) => ({
                      value: a.id,
                      label: a.name,
                    })) ?? []),
                  ]}
                  placeholder="全部活动"
                  style={{ width: 160 }}
                  value={filters.activityId || undefined}
                />
              </Form.Item>

              <Form.Item label="结果">
                <Select
                  allowClear
                  onChange={(v) =>
                    applyFilters({ isWin: (v ?? '') as Filters['isWin'] })
                  }
                  options={[
                    { value: 'true', label: '中奖' },
                    { value: 'false', label: '未中奖' },
                  ]}
                  placeholder="全部"
                  style={{ width: 110 }}
                  value={filters.isWin || undefined}
                />
              </Form.Item>

              <Form.Item label="奖品类型">
                <Select
                  allowClear
                  onChange={(v) => applyFilters({ prizeType: v ?? '' })}
                  options={Object.entries(PRIZE_TYPE_LABELS).map(([k, v]) => ({
                    value: k,
                    label: v,
                  }))}
                  placeholder="全部类型"
                  style={{ width: 120 }}
                  value={filters.prizeType || undefined}
                />
              </Form.Item>

              <Form.Item label="状态">
                <Select
                  allowClear
                  onChange={(v) => applyFilters({ status: v ?? '' })}
                  options={Object.entries(RECORD_STATUS_LABELS).map(
                    ([k, v]) => ({
                      value: k,
                      label: v,
                    }),
                  )}
                  placeholder="全部状态"
                  style={{ width: 120 }}
                  value={filters.status || undefined}
                />
              </Form.Item>

              {hasActiveFilters && (
                <Form.Item>
                  <Button onClick={resetFilters}>重置筛选</Button>
                </Form.Item>
              )}
            </Form>
          </Card>

          {/* 数据表格 */}
          <Card>
            <Table<RecordItem>
              columns={columns}
              dataSource={data?.items ?? []}
              loading={!data}
              locale={{ emptyText: '暂无符合条件的记录' }}
              pagination={{
                current: currentPage,
                pageSize: limit,
                total: data?.total ?? 0,
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page) => {
                  setOffset((page - 1) * limit);
                },
              }}
              rowKey="id"
              scroll={{ x: 900 }}
            />
          </Card>
        </div>
      </main>
    </>
  );
}
