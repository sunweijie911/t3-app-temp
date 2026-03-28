'use client';

import type { TableProps } from 'antd';
import {
  Breadcrumb,
  Button,
  Card,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import XLSX from 'xlsx-js-style';
import { ACTION_LABELS } from '@/server/api/audit-action-labels';
import { api, type RouterOutputs } from '@/trpc/react';

type AuditLog = RouterOutputs['sys']['listAuditLogs']['logs'][number];

type Filters = {
  page: number;
  pageSize: number;
  startDate: string;
  endDate: string;
  action: string;
  userEmail: string;
};

const defaultFilters: Filters = {
  page: 1,
  pageSize: 20,
  startDate: '',
  endDate: '',
  action: '',
  userEmail: '',
};

function getActionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

const RETENTION_OPTIONS = [
  { label: '30 天', value: 30 },
  { label: '60 天', value: 60 },
  { label: '90 天', value: 90 },
  { label: '180 天', value: 180 },
  { label: '365 天', value: 365 },
];

export default function AuditLogsPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState(90);

  const { data, isLoading } = api.sys.listAuditLogs.useQuery({
    page: filters.page,
    pageSize: filters.pageSize,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    action: filters.action || undefined,
    userEmail: filters.userEmail || undefined,
  });

  // 日志统计
  const { data: stats } = api.sys.getAuditLogStats.useQuery();
  const utils = api.useUtils();

  // 动态获取操作类型列表
  const { data: actionOptions } = api.sys.listDistinctActions.useQuery();

  // 保留策略配置
  const { data: retentionConfig } = api.sys.getConfig.useQuery({
    key: 'audit.retentionDays',
  });
  const { data: autoCleanupConfig } = api.sys.getConfig.useQuery({
    key: 'audit.autoCleanupEnabled',
  });
  const setConfigMutation = api.sys.setConfig.useMutation({
    onSuccess: () => {
      void utils.sys.getConfig.invalidate();
      toast.success('配置已保存');
    },
  });

  // 手动清理
  const purgeMutation = api.sys.purgeAuditLogs.useMutation({
    onSuccess: (result) => {
      toast.success(`已清理 ${result.deleted} 条日志`);
      setPurgeModalOpen(false);
      void utils.sys.listAuditLogs.invalidate();
      void utils.sys.getAuditLogStats.invalidate();
      void utils.sys.listDistinctActions.invalidate();
    },
    onError: () => toast.error('清理失败'),
  });

  function handlePurge() {
    const beforeDate = new Date();
    beforeDate.setDate(beforeDate.getDate() - purgeDays);
    purgeMutation.mutate({ beforeDate: beforeDate.toISOString() });
  }

  // 导出查询（按需触发）
  const exportQuery = api.sys.exportAuditLogs.useQuery(
    {
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      action: filters.action || undefined,
      userEmail: filters.userEmail || undefined,
    },
    { enabled: false },
  );

  async function handleExport() {
    try {
      const result = await exportQuery.refetch();
      const rows = result.data;
      if (!rows || rows.length === 0) {
        toast.error('暂无数据可导出');
        return;
      }

      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4472C4' } },
        alignment: { horizontal: 'center' as const },
      };

      const headers = [
        '时间',
        '操作人',
        '操作',
        '操作代码',
        '参数',
        '结果',
        '错误信息',
        'IP',
      ];

      const wsData = [
        headers.map((h) => ({ v: h, s: headerStyle })),
        ...rows.map((r) => [
          { v: dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss') },
          { v: r.userEmail ?? '' },
          { v: getActionLabel(r.action) },
          { v: r.action },
          { v: r.input ? JSON.stringify(r.input) : '' },
          { v: r.result === 'success' ? '成功' : '失败' },
          { v: r.errorMessage ?? '' },
          { v: r.ipAddress ?? '' },
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [
        { wch: 20 },
        { wch: 20 },
        { wch: 22 },
        { wch: 30 },
        { wch: 40 },
        { wch: 8 },
        { wch: 30 },
        { wch: 16 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '操作日志');
      XLSX.writeFile(wb, `操作日志_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`);
      toast.success(`已导出 ${rows.length} 条记录`);
    } catch {
      toast.error('导出失败');
    }
  }

  const columns: TableProps<AuditLog>['columns'] = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (val: Date) => dayjs(val).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作人',
      dataIndex: 'userEmail',
      key: 'userEmail',
      width: 200,
      render: (email: string | null) => email ?? '-',
    },
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      width: 260,
      render: (action: string) => {
        const label = getActionLabel(action);
        return label !== action ? (
          <Tooltip title={action}>
            <Tag>{label}</Tag>
          </Tooltip>
        ) : (
          <Typography.Text code>{action}</Typography.Text>
        );
      },
    },
    {
      title: '参数',
      dataIndex: 'input',
      key: 'input',
      ellipsis: true,
      render: (input: unknown) =>
        input ? (
          <Typography.Text
            ellipsis={{ tooltip: JSON.stringify(input, null, 2) }}
            style={{ maxWidth: 300 }}
          >
            {JSON.stringify(input)}
          </Typography.Text>
        ) : (
          '-'
        ),
    },
    {
      title: '结果',
      dataIndex: 'result',
      key: 'result',
      width: 80,
      render: (result: string) => (
        <Tag color={result === 'success' ? 'green' : 'red'}>
          {result === 'success' ? '成功' : '失败'}
        </Tag>
      ),
    },
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      width: 200,
      ellipsis: true,
      render: (msg: string | null) =>
        msg ? (
          <Typography.Text ellipsis={{ tooltip: msg }} type="danger">
            {msg}
          </Typography.Text>
        ) : (
          '-'
        ),
    },
    {
      title: 'IP',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 140,
      render: (ip: string | null) => ip ?? '-',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb
        items={[
          { title: <Link href="/admin">管理后台</Link> },
          { title: '操作日志' },
        ]}
        style={{ marginBottom: 16 }}
      />

      <Card style={{ marginBottom: 16 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Space wrap>
            <DatePicker.RangePicker
              onChange={(dates) => {
                setFilters((prev) => ({
                  ...prev,
                  page: 1,
                  startDate: dates?.[0]?.startOf('day').toISOString() ?? '',
                  endDate: dates?.[1]?.endOf('day').toISOString() ?? '',
                }));
              }}
              placeholder={['开始时间', '结束时间']}
            />
            <Input.Search
              allowClear
              onSearch={(val) =>
                setFilters((prev) => ({
                  ...prev,
                  page: 1,
                  userEmail: val,
                }))
              }
              placeholder="搜索操作人邮箱"
              style={{ width: 220 }}
            />
            <Select
              allowClear
              onChange={(val) =>
                setFilters((prev) => ({ ...prev, page: 1, action: val ?? '' }))
              }
              optionFilterProp="label"
              options={actionOptions ?? []}
              placeholder="操作类型"
              showSearch
              style={{ width: 240 }}
              value={filters.action || undefined}
            />
          </Space>
          <Button onClick={handleExport} type="primary">
            导出 Excel
          </Button>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Space size="large">
            <Typography.Text type="secondary">
              日志总数：
              <Typography.Text strong>{stats?.total ?? '-'}</Typography.Text>
            </Typography.Text>
            {stats?.earliestDate && (
              <Typography.Text type="secondary">
                最早记录：{dayjs(stats.earliestDate).format('YYYY-MM-DD')}
              </Typography.Text>
            )}
          </Space>
          <Space>
            <Space size="middle">
              <Typography.Text type="secondary">自动清理：</Typography.Text>
              <Switch
                checked={String(autoCleanupConfig?.value) === 'true'}
                loading={setConfigMutation.isPending}
                onChange={(checked) =>
                  setConfigMutation.mutate({
                    key: 'audit.autoCleanupEnabled',
                    value: String(checked),
                    description: '审计日志自动清理开关',
                  })
                }
              />
              <Typography.Text type="secondary">保留天数：</Typography.Text>
              <InputNumber
                changeOnBlur
                defaultValue={
                  retentionConfig?.value ? Number(retentionConfig.value) : 90
                }
                key={String(retentionConfig?.value ?? 90)}
                max={3650}
                min={7}
                onBlur={(e) => {
                  const val = Number(e.target.value);
                  if (val && val >= 7)
                    setConfigMutation.mutate({
                      key: 'audit.retentionDays',
                      value: String(val),
                      description: '审计日志保留天数',
                    });
                }}
                onPressEnter={(e) => {
                  const val = Number((e.target as HTMLInputElement).value);
                  if (val && val >= 7)
                    setConfigMutation.mutate({
                      key: 'audit.retentionDays',
                      value: String(val),
                      description: '审计日志保留天数',
                    });
                }}
                style={{ width: 100 }}
              />
            </Space>
            <Button danger onClick={() => setPurgeModalOpen(true)}>
              手动清理
            </Button>
          </Space>
        </div>
      </Card>

      <Modal
        cancelText="取消"
        okButtonProps={{ danger: true, loading: purgeMutation.isPending }}
        okText={`确认清理`}
        onCancel={() => setPurgeModalOpen(false)}
        onOk={handlePurge}
        open={purgeModalOpen}
        title="手动清理日志"
      >
        <div className="py-4">
          <Typography.Paragraph>
            将删除指定天数之前的所有操作日志，此操作不可恢复。
          </Typography.Paragraph>
          <Space>
            <Typography.Text>保留最近</Typography.Text>
            <Select
              onChange={setPurgeDays}
              options={RETENTION_OPTIONS}
              style={{ width: 120 }}
              value={purgeDays}
            />
            <Typography.Text>的日志</Typography.Text>
          </Space>
          <Typography.Paragraph style={{ marginTop: 12 }} type="secondary">
            即删除 {dayjs().subtract(purgeDays, 'day').format('YYYY-MM-DD')}{' '}
            之前的所有记录
          </Typography.Paragraph>
        </div>
      </Modal>

      <Card>
        <Table<AuditLog>
          columns={columns}
          dataSource={data?.logs}
          loading={isLoading}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) =>
              setFilters((prev) => ({ ...prev, page, pageSize })),
          }}
          rowKey="id"
          scroll={{ x: 1200 }}
          size="middle"
        />
      </Card>
    </div>
  );
}
