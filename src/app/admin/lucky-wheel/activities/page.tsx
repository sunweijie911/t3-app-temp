'use client';

import {
  Breadcrumb,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/app/_components/layout/header';
import { RichTextEditor } from '@/app/_components/rich-text-editor';
import { api } from '@/trpc/react';

type EditingActivity = {
  id?: string;
  name: string;
  slug: string;
  rulesHtml: string;
  timeRange: [Dayjs, Dayjs] | null;
  maxDrawsPerUser: number;
};

type ActivityRow = {
  id: string;
  name: string;
  slug: string;
  startAt?: Date | null;
  endAt?: Date | null;
  isActive: boolean;
  rules?: { html?: string } | null;
  maxDrawsPerUser: number;
};

export default function AdminActivitiesPage() {
  const { data: activities, refetch } =
    api.luckyWheel.admin.listActivities.useQuery();
  const upsertMutation = api.luckyWheel.admin.upsertActivity.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteMutation = api.luckyWheel.admin.deleteActivity.useMutation({
    onSuccess: () => {
      toast.success('已下线');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const activateMutation = api.luckyWheel.admin.activateActivity.useMutation({
    onSuccess: () => {
      toast.success('已上线');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [editing, setEditing] = useState<EditingActivity | null>(null);

  const columns: ColumnsType<ActivityRow> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Slug',
      dataIndex: 'slug',
      key: 'slug',
    },
    {
      title: '活动时间',
      key: 'time',
      render: (_, record) => {
        if (!record.startAt && !record.endAt) {
          return <span className="text-gray-400">永久有效</span>;
        }
        return (
          <span>
            {record.startAt ? new Date(record.startAt).toLocaleString() : '∞'}
            {' ~ '}
            {record.endAt ? new Date(record.endAt).toLocaleString() : '∞'}
          </span>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_, record) => (
        <Switch
          checked={record.isActive}
          checkedChildren="上线"
          loading={
            (deleteMutation.isPending || activateMutation.isPending) &&
            (deleteMutation.variables?.id === record.id ||
              activateMutation.variables?.id === record.id)
          }
          onChange={(checked) => {
            if (checked) {
              activateMutation.mutate({ id: record.id });
            } else {
              deleteMutation.mutate({ id: record.id });
            }
          }}
          unCheckedChildren="下线"
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <Link href={`/admin/lucky-wheel/${record.id}/prizes`}>奖品配置</Link>
          <Link href={`/admin/lucky-wheel/${record.id}/chances`}>额外次数</Link>
          <Button
            onClick={() =>
              setEditing({
                id: record.id,
                name: record.name,
                slug: record.slug,
                rulesHtml: record.rules?.html ?? '',
                timeRange:
                  record.startAt && record.endAt
                    ? [dayjs(record.startAt), dayjs(record.endAt)]
                    : null,
                maxDrawsPerUser: record.maxDrawsPerUser,
              })
            }
            style={{ padding: 0 }}
            type="link"
          >
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  function handleSave() {
    if (!editing) return;
    upsertMutation.mutate({
      id: editing.id,
      name: editing.name,
      slug: editing.slug,
      description: null,
      rules: editing.rulesHtml ? { html: editing.rulesHtml } : null,
      startAt: editing.timeRange ? editing.timeRange[0].toISOString() : null,
      endAt: editing.timeRange ? editing.timeRange[1].toISOString() : null,
      maxDrawsPerUser: editing.maxDrawsPerUser,
    });
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <Breadcrumb
            className="mb-4"
            items={[
              { title: <Link href="/admin/lucky-wheel">大转盘管理</Link> },
              { title: '活动管理' },
            ]}
          />

          <div className="mb-6 flex items-center justify-between">
            <h1 className="font-bold text-2xl text-gray-900">活动管理</h1>
            <Button
              onClick={() =>
                setEditing({
                  name: '',
                  slug: '',
                  rulesHtml: '',
                  timeRange: null,
                  maxDrawsPerUser: 1,
                })
              }
              type="primary"
            >
              新建活动
            </Button>
          </div>

          <Table
            columns={columns}
            dataSource={activities as ActivityRow[] | undefined}
            pagination={false}
            rowKey="id"
            style={{ background: '#fff', borderRadius: 12 }}
          />
        </div>
      </main>

      <Modal
        footer={
          <Space>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              loading={upsertMutation.isPending}
              onClick={handleSave}
              type="primary"
            >
              保存
            </Button>
          </Space>
        }
        onCancel={() => setEditing(null)}
        open={!!editing}
        title={editing?.id ? '编辑活动' : '新建活动'}
        width={700}
      >
        {editing && (
          <Form layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item label="活动名称">
              <Input
                onChange={(e) =>
                  setEditing((prev) =>
                    prev ? { ...prev, name: e.target.value } : prev,
                  )
                }
                placeholder="活动名称"
                value={editing.name}
              />
            </Form.Item>

            <Form.Item
              extra="只允许字母和数字，用于活动链接 /lucky-wheel/{slug}"
              label="URL标识（slug）"
            >
              <Input
                onChange={(e) => {
                  // 只保留字母和数字
                  const filtered = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
                  setEditing((prev) =>
                    prev ? { ...prev, slug: filtered } : prev,
                  );
                }}
                placeholder="仅限字母和数字，例如：summer2024"
                value={editing.slug}
              />
            </Form.Item>

            <Form.Item label="活动时间（留空为永久有效）">
              <DatePicker.RangePicker
                format="YYYY-MM-DD HH:mm"
                onChange={(range) =>
                  setEditing((prev) =>
                    prev
                      ? {
                          ...prev,
                          timeRange:
                            range?.[0] && range[1]
                              ? [range[0], range[1]]
                              : null,
                        }
                      : prev,
                  )
                }
                showTime={{ format: 'HH:mm' }}
                style={{ width: '100%' }}
                value={editing.timeRange}
              />
            </Form.Item>

            <Form.Item label="每人抽奖次数（0 = 不限）">
              <InputNumber
                min={0}
                onChange={(val) =>
                  setEditing((prev) =>
                    prev ? { ...prev, maxDrawsPerUser: val ?? 1 } : prev,
                  )
                }
                style={{ width: '100%' }}
                value={editing.maxDrawsPerUser}
              />
            </Form.Item>

            <Form.Item label="活动规则（富文本）">
              <RichTextEditor
                defaultValue={editing.rulesHtml}
                key={editing.id ?? 'new'}
                onChange={(html) =>
                  setEditing((prev) =>
                    prev ? { ...prev, rulesHtml: html } : prev,
                  )
                }
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </>
  );
}
