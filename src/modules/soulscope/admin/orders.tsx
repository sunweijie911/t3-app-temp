'use client';

import type { TableProps } from 'antd';
import { Breadcrumb, Table, Tag } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import { api, type RouterOutputs } from '@/trpc/react';

const PAGE_SIZE = 20;

type OrderItem =
  RouterOutputs['soulscope']['admin']['allOrders']['items'][number];

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  paid: { color: 'green', label: '已付款' },
  pending: { color: 'orange', label: '待付款' },
};

const columns: TableProps<OrderItem>['columns'] = [
  {
    title: '订单ID',
    dataIndex: 'id',
    render: (id: string) => (
      <span style={{ fontFamily: 'monospace', fontSize: 13 }}>
        {id.slice(0, 12)}...
      </span>
    ),
  },
  {
    title: '金额',
    dataIndex: 'amount',
    render: (amount: number) => `¥${amount}`,
  },
  {
    title: '状态',
    dataIndex: 'status',
    render: (status: string) => {
      const tag = STATUS_TAG[status];
      return <Tag color={tag?.color ?? 'default'}>{tag?.label ?? status}</Tag>;
    },
  },
  {
    title: '时间',
    dataIndex: 'createdAt',
    render: (date: Date | string) => new Date(date).toLocaleString('zh-CN'),
  },
];

export default function AdminOrdersPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = api.soulscope.admin.allOrders.useQuery({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  return (
    <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
        <Breadcrumb
          items={[
            { title: <Link href="/admin/soulscope">SoulScope 管理</Link> },
            { title: '订单管理' },
          ]}
          style={{ marginBottom: 24 }}
        />
        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: '#111827',
            marginBottom: 24,
          }}
        >
          订单管理
        </h1>

        <Table<OrderItem>
          columns={columns}
          dataSource={data?.items ?? []}
          loading={isLoading}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (p) => setPage(p),
          }}
          rowKey="id"
          style={{ background: '#fff', borderRadius: 12 }}
        />
      </div>
    </main>
  );
}
