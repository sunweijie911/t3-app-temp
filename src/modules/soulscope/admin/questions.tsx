'use client';

import { Breadcrumb, Button, List, Pagination, Tag, Typography } from 'antd';
import Link from 'next/link';
import { use, useState } from 'react';
import { api } from '@/trpc/react';

const PAGE_SIZE = 50;

export default function AdminQuestionsPage({
  params,
}: {
  params: Promise<{ testTypeId: string }>;
}) {
  const { testTypeId } = use(params);
  const utils = api.useUtils();
  const [page, setPage] = useState(1);

  const { data: questions, isLoading } =
    api.soulscope.admin.getQuestions.useQuery({
      testTypeId,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });

  const generateQuestions = api.soulscope.admin.generateQuestions.useMutation({
    onSuccess: () => {
      void utils.soulscope.admin.getQuestions.invalidate();
    },
  });

  return (
    <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 24px' }}>
        <Breadcrumb
          items={[
            {
              title: <Link href="/admin/soulscope/tests">测试管理</Link>,
            },
            { title: '题目管理' },
          ]}
          style={{ marginBottom: 8 }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#111827',
              margin: 0,
            }}
          >
            题目管理
          </h1>
          <Button
            loading={generateQuestions.isPending}
            onClick={() => generateQuestions.mutate({ testTypeId, count: 5 })}
            type="primary"
          >
            {generateQuestions.isPending ? 'AI生成中...' : 'AI生成5道题'}
          </Button>
        </div>

        <List
          dataSource={questions?.items ?? []}
          loading={isLoading}
          locale={{ emptyText: '暂无题目' }}
          renderItem={(q, i) => (
            <List.Item
              key={q.id}
              style={{
                background: '#fff',
                borderRadius: 12,
                marginBottom: 12,
                padding: '20px 24px',
                display: 'block',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <Typography.Text style={{ fontSize: 13 }} type="secondary">
                  #{(page - 1) * PAGE_SIZE + i + 1}
                </Typography.Text>
                <div style={{ display: 'flex', gap: 6 }}>
                  {q.dimension && <Tag color="blue">{q.dimension}</Tag>}
                  <Tag color="default">{q.source}</Tag>
                </div>
              </div>
              <Typography.Text
                strong
                style={{ fontSize: 15, display: 'block', marginBottom: 12 }}
              >
                {q.text}
              </Typography.Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(q.options as Array<{ value: string; label: string }>).map(
                  (opt) => (
                    <span
                      key={opt.value}
                      style={{
                        background: '#f3f4f6',
                        borderRadius: 8,
                        padding: '4px 12px',
                        fontSize: 13,
                        color: '#4b5563',
                      }}
                    >
                      {opt.label}
                    </span>
                  ),
                )}
              </div>
            </List.Item>
          )}
        />

        {questions && questions.total > PAGE_SIZE && (
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Pagination
              current={page}
              onChange={(p) => setPage(p)}
              pageSize={PAGE_SIZE}
              showSizeChanger={false}
              showTotal={(total) => `共 ${total} 道题目`}
              total={questions.total}
            />
          </div>
        )}
      </div>
    </main>
  );
}
