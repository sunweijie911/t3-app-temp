'use client';

import type { TableProps } from 'antd';
import {
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import XLSX from 'xlsx-js-style';
import {
  PRIZE_TYPE_LABELS,
  RECORD_STATUS_LABELS,
} from '@/modules/lucky-wheel/constants';
import type { WheelUserInfo } from '@/modules/lucky-wheel/schema';
import { api, type RouterOutputs } from '@/trpc/react';

type Filters = {
  activityId: string;
  status: string;
  prizeType: string;
  search: string;
  startDate: string;
  endDate: string;
};

const defaultFilters: Filters = {
  activityId: '',
  status: '',
  prizeType: '',
  search: '',
  startDate: '',
  endDate: '',
};

function buildFilterInput(filters: Filters) {
  return {
    activityId: filters.activityId || undefined,
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
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
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

function toExcel(records: ExportRecord[]): Blob {
  const headers = [
    '用户手机',
    '奖品',
    '状态',
    '收件人',
    '手机',
    '收货地址',
    '活动',
    '抽奖时间',
  ];
  const colWidths = [16, 14, 10, 10, 14, 30, 14, 20];
  const rows = records.map((r) => {
    const info = r.userInfo;
    return [
      r.user?.phoneNumber ?? r.userId,
      r.isWin ? (r.prize?.name ?? '') : '未中奖',
      RECORD_STATUS_LABELS[r.status] ?? r.status,
      info?.name ?? '',
      info?.phone ?? '',
      info?.address ?? '',
      r.activity?.name ?? '',
      dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // 列宽
  ws['!cols'] = colWidths.map((w) => ({ wch: w }));

  const border = {
    top: { style: 'thin', color: { rgb: 'D9D9D9' } },
    bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
    left: { style: 'thin', color: { rgb: 'D9D9D9' } },
    right: { style: 'thin', color: { rgb: 'D9D9D9' } },
  } as const;
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { fgColor: { rgb: '4472C4' } },
    alignment: { horizontal: 'center' as const, vertical: 'center' as const },
    border,
  };
  const cellStyle = {
    alignment: { vertical: 'center' as const, wrapText: true },
    border,
  };

  const totalRows = rows.length + 1;
  for (let c = 0; c < headers.length; c++) {
    // 表头样式
    const hCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (hCell) hCell.s = headerStyle;
    // 数据行样式
    for (let r = 1; r < totalRows; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = cellStyle;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '中奖记录');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

type RecordItem =
  RouterOutputs['luckyWheel']['admin']['getRecords']['items'][number];

export default function AdminRecordsPage() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<Filters>({
    ...defaultFilters,
    activityId: searchParams.get('activityId') ?? '',
  });
  const [searchInput, setSearchInput] = useState(filters.search);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [exporting, setExporting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const { data: activities } = api.luckyWheel.admin.listActivities.useQuery();
  const utils = api.useUtils();

  const hasActivity = !!filters.activityId;
  const queryInput = { ...buildFilterInput(filters), limit, offset };

  const { data, refetch } = api.luckyWheel.admin.getRecords.useQuery(
    queryInput,
    {
      enabled: hasActivity,
    },
  );

  const updateMutation = api.luckyWheel.admin.updateRecordStatus.useMutation({
    onSuccess: () => {
      toast.success('状态已更新');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteRecordMutation = api.luckyWheel.admin.deleteRecord.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const batchDeleteMutation =
    api.luckyWheel.admin.batchDeleteRecords.useMutation({
      onSuccess: (res) => {
        toast.success(`已删除 ${res.count} 条记录`);
        setSelectedRowKeys([]);
        void refetch();
      },
      onError: (err) => toast.error(err.message),
    });

  const batchUpdateStatusMutation =
    api.luckyWheel.admin.batchUpdateRecordStatus.useMutation({
      onSuccess: (res) => {
        toast.success(`已更新 ${res.count} 条记录状态`);
        setSelectedRowKeys([]);
        void refetch();
      },
      onError: (err) => toast.error(err.message),
    });

  const clearMutation = api.luckyWheel.admin.clearRecords.useMutation({
    onSuccess: () => {
      toast.success('已清除所有数据');
      setSelectedRowKeys([]);
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const currentPage = Math.floor(offset / limit) + 1;

  function applyFilters(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setOffset(0);
    setSelectedRowKeys([]);
  }

  function handleBatchDelete() {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '确认批量删除',
      content: `确定删除选中的 ${selectedRowKeys.length} 条记录？此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => batchDeleteMutation.mutate({ ids: selectedRowKeys }),
    });
  }

  function handleBatchUpdateStatus(
    status: 'pending' | 'confirmed' | 'shipped' | 'claimed',
  ) {
    if (selectedRowKeys.length === 0) return;
    batchUpdateStatusMutation.mutate({ ids: selectedRowKeys, status });
  }

  function handleDeleteRecord(id: string) {
    Modal.confirm({
      title: '确认删除',
      content: '确定删除这条记录？此操作不可撤销。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => deleteRecordMutation.mutate({ id }),
    });
  }

  function handleClearAll() {
    if (!filters.activityId) return;
    Modal.confirm({
      title: '确认清除',
      content:
        '将删除该活动所有抽奖记录并重置奖品库存，此操作不可撤销，确定继续？',
      okText: '确认清除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => clearMutation.mutate({ activityId: filters.activityId }),
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const records = await utils.luckyWheel.admin.exportRecords.fetch(
        buildFilterInput(filters),
      );
      const blob = toExcel(records);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const activityName =
        activities?.find((a) => a.id === filters.activityId)?.name ??
        '全部活动';
      const date = new Date().toISOString().slice(0, 10);
      a.download = `中奖记录_${activityName}_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${records.length} 条记录`);
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

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
      title: '时间',
      key: 'createdAt',
      render: (_, record) => (
        <Typography.Text style={{ fontSize: 13 }}>
          {dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss')}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="small">
          {record.isWin && (
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
          )}
          <Button
            danger
            disabled={deleteRecordMutation.isPending}
            onClick={() => handleDeleteRecord(record.id)}
            size="small"
            type="link"
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
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
              ...(filters.activityId
                ? [
                    {
                      title: (
                        <Link href={`/admin/lucky-wheel/${filters.activityId}`}>
                          {activities?.find((a) => a.id === filters.activityId)
                            ?.name ?? '活动'}
                        </Link>
                      ),
                    },
                  ]
                : []),
              {
                title: '中奖记录',
              },
            ]}
          />
          <Space>
            <Button
              danger
              disabled={!hasActivity || clearMutation.isPending}
              loading={clearMutation.isPending}
              onClick={handleClearAll}
            >
              清除所有数据
            </Button>
            <Button
              disabled={!hasActivity}
              loading={exporting}
              onClick={handleExport}
            >
              {exporting ? '导出中...' : '导出 Excel'}
            </Button>
          </Space>
        </div>

        {/* 筛选栏 */}
        <Card style={{ marginBottom: 16 }}>
          <Form layout="inline" style={{ rowGap: 8 }}>
            <Form.Item label="搜索用户">
              <Input.Search
                allowClear
                enterButton="搜索"
                onChange={(e) => setSearchInput(e.target.value)}
                onSearch={(v) => applyFilters({ search: v })}
                placeholder="姓名 / 手机号"
                style={{ width: 260 }}
                value={searchInput}
              />
            </Form.Item>

            <Form.Item label="活动" required>
              <Select
                onChange={(v) => applyFilters({ activityId: v ?? '' })}
                options={
                  activities?.map((a) => ({
                    value: a.id,
                    label: a.name,
                  })) ?? []
                }
                placeholder="请选择活动"
                style={{ width: 160 }}
                value={filters.activityId || undefined}
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
                options={Object.entries(RECORD_STATUS_LABELS).map(([k, v]) => ({
                  value: k,
                  label: v,
                }))}
                placeholder="全部状态"
                style={{ width: 120 }}
                value={filters.status || undefined}
              />
            </Form.Item>

            <Form.Item label="时间范围">
              <DatePicker.RangePicker
                allowClear
                onChange={(dates) => {
                  if (dates?.[0] && dates?.[1]) {
                    applyFilters({
                      startDate: dates[0].startOf('day').toISOString(),
                      endDate: dates[1].endOf('day').toISOString(),
                    });
                  } else {
                    applyFilters({ startDate: '', endDate: '' });
                  }
                }}
                value={
                  filters.startDate && filters.endDate
                    ? [dayjs(filters.startDate), dayjs(filters.endDate)]
                    : null
                }
              />
            </Form.Item>
          </Form>
        </Card>

        {/* 数据表格 */}
        {!hasActivity ? (
          <Card style={{ textAlign: 'center', padding: '48px 0' }}>
            <Typography.Text type="secondary">
              请先选择一个活动查看中奖记录
            </Typography.Text>
          </Card>
        ) : (
          <Card>
            {selectedRowKeys.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 16,
                  padding: '8px 16px',
                  background: '#f0f5ff',
                  borderRadius: 6,
                }}
              >
                <Typography.Text strong>
                  已选 {selectedRowKeys.length} 条
                </Typography.Text>
                <Button
                  danger
                  loading={batchDeleteMutation.isPending}
                  onClick={handleBatchDelete}
                  size="small"
                >
                  批量删除
                </Button>
                <Select
                  disabled={batchUpdateStatusMutation.isPending}
                  onChange={handleBatchUpdateStatus}
                  options={Object.entries(RECORD_STATUS_LABELS).map(
                    ([k, v]) => ({ value: k, label: v }),
                  )}
                  placeholder="批量更新状态"
                  size="small"
                  style={{ width: 140 }}
                  value={undefined}
                />
                <Button
                  onClick={() => setSelectedRowKeys([])}
                  size="small"
                  type="link"
                >
                  取消选择
                </Button>
              </div>
            )}
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
                  setSelectedRowKeys([]);
                },
              }}
              rowKey="id"
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }}
              scroll={{ x: 900 }}
            />
          </Card>
        )}
      </div>
    </main>
  );
}
