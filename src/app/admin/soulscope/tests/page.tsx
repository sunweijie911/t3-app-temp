'use client';

import type { TableProps } from 'antd';
import { Breadcrumb, Table, Tag } from 'antd';
import Link from 'next/link';
import { Header } from '@/app/_components/layout/header';
import { api, type RouterOutputs } from '@/trpc/react';

type TestItem = RouterOutputs['soulscope']['test']['list'][number];

const columns: TableProps<TestItem>['columns'] = [
  {
    title: '名称',
    dataIndex: 'name',
    key: 'name',
  },
  {
    title: '题数',
    dataIndex: 'questionCount',
    key: 'questionCount',
  },
  {
    title: '价格',
    dataIndex: 'reportPrice',
    key: 'reportPrice',
    render: (price: number) => `¥${price}`,
  },
  {
    title: '状态',
    key: 'status',
    render: (_, record) =>
      record.isFeatured ? <Tag color="purple">热门</Tag> : null,
  },
  {
    title: '操作',
    key: 'action',
    render: (_, record) => (
      <Link href={`/admin/soulscope/tests/${record.id}/questions`}>
        管理题目
      </Link>
    ),
  },
];

export default function AdminTestsPage() {
  const { data: tests, isLoading } = api.soulscope.test.list.useQuery();

  return (
    <>
      <Header />
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
          <Breadcrumb
            items={[
              { title: <Link href="/admin/soulscope">SoulScope 管理</Link> },
              { title: '测试管理' },
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
            测试管理
          </h1>

          <Table<TestItem>
            columns={columns}
            dataSource={tests ?? []}
            loading={isLoading}
            pagination={false}
            rowKey="id"
            style={{ background: '#fff', borderRadius: 12 }}
          />
        </div>
      </main>
    </>
  );
}
