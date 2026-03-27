'use client';

import type { TableProps } from 'antd';
import {
  Breadcrumb,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';
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

export default function AuditLogsPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const { data, isLoading } = api.sys.listAuditLogs.useQuery({
    page: filters.page,
    pageSize: filters.pageSize,
    startDate: filters.startDate || undefined,
    endDate: filters.endDate || undefined,
    action: filters.action || undefined,
    userEmail: filters.userEmail || undefined,
  });

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
      render: (action: string) => (
        <Typography.Text code>{action}</Typography.Text>
      ),
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
            placeholder="搜索操作人（邮箱/手机号）"
            style={{ width: 260 }}
          />
          <Select
            allowClear
            onChange={(val) =>
              setFilters((prev) => ({ ...prev, page: 1, action: val ?? '' }))
            }
            options={[
              { label: '创建用户', value: 'admin.createUser' },
              { label: '删除用户', value: 'admin.deleteUser' },
              { label: '系统配置', value: 'admin.setConfig' },
            ]}
            placeholder="操作类型"
            style={{ width: 240 }}
            value={filters.action || undefined}
          />
        </Space>
      </Card>

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
