'use client';

import {
  Breadcrumb,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { use, useState } from 'react';
import { toast } from 'sonner';
import { Header } from '@/app/_components/layout/header';
import { api } from '@/trpc/react';

interface EditingChance {
  id?: string;
  phone: string;
  extraChances: number;
  note: string;
}

interface Props {
  params: Promise<{ activityId: string }>;
}

export default function AdminChancesPage({ params }: Props) {
  const { activityId } = use(params);

  const { data: chances, refetch } =
    api.luckyWheel.admin.listExtraChances.useQuery({ activityId });

  const upsertMutation = api.luckyWheel.admin.upsertExtraChance.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.luckyWheel.admin.deleteExtraChance.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [editing, setEditing] = useState<EditingChance | null>(null);
  const [form] = Form.useForm<EditingChance>();

  // 打开 Modal 时同步表单初始值
  function openModal(initial: EditingChance) {
    setEditing(initial);
    form.setFieldsValue(initial);
  }

  function handleModalOk() {
    form
      .validateFields()
      .then((values) => {
        upsertMutation.mutate({
          id: editing?.id,
          activityId,
          phone: values.phone,
          extraChances: values.extraChances,
          note: values.note || undefined,
        });
      })
      .catch(() => {
        // 表单校验失败，不提交
      });
  }

  type ChanceRow = NonNullable<typeof chances>[number];

  const columns: ColumnsType<ChanceRow> = [
    {
      title: '手机号',
      dataIndex: 'phone',
      render: (val: string) => (
        <span style={{ fontFamily: 'monospace' }}>{val}</span>
      ),
    },
    {
      title: '额外次数',
      dataIndex: 'extraChances',
      render: (val: number) => <Tag color="orange">+{val} 次</Tag>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      render: (val: string | null) => (
        <span style={{ color: '#6b7280' }}>{val ?? '—'}</span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (val: Date | string) => new Date(val).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      dataIndex: 'id',
      render: (_, row) => (
        <Space>
          <Button
            onClick={() =>
              openModal({
                id: row.id,
                phone: row.phone,
                extraChances: row.extraChances,
                note: row.note ?? '',
              })
            }
            type="link"
          >
            编辑
          </Button>
          <Popconfirm
            cancelText="取消"
            okText="确认删除"
            okType="danger"
            onConfirm={() => deleteMutation.mutate({ id: row.id })}
            title="确认删除这条配置？"
          >
            <Button danger type="link">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Header />
      <main style={{ minHeight: '100vh', background: '#f9fafb' }}>
        <div
          style={{
            maxWidth: 896,
            margin: '0 auto',
            padding: '48px 16px',
          }}
        >
          {/* 顶部：面包屑 + 添加按钮 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 32,
            }}
          >
            <div>
              <Breadcrumb
                items={[
                  {
                    title: (
                      <Link href="/admin/lucky-wheel/activities">活动管理</Link>
                    ),
                  },
                  { title: '额外次数配置' },
                ]}
              />
              <p style={{ marginTop: 8, color: '#6b7280', fontSize: 14 }}>
                为指定手机号配置额外抽奖次数（在基础次数之上叠加）
              </p>
            </div>
            <Button
              onClick={() =>
                openModal({ phone: '', extraChances: 1, note: '' })
              }
              type="primary"
            >
              添加配置
            </Button>
          </div>

          {/* 额外次数表格 */}
          <Table
            columns={columns}
            dataSource={chances ?? []}
            locale={{ emptyText: '暂无配置，点击「添加配置」开始' }}
            pagination={false}
            rowKey="id"
          />
        </div>

        {/* 新增/编辑 Modal */}
        <Modal
          confirmLoading={upsertMutation.isPending}
          okText="保存"
          onCancel={() => setEditing(null)}
          onOk={handleModalOk}
          open={!!editing}
          title={editing?.id ? '编辑配置' : '新增配置'}
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              label="手机号"
              name="phone"
              rules={[{ required: true, message: '请输入手机号' }]}
            >
              <Input
                disabled={!!editing?.id}
                inputMode="numeric"
                maxLength={11}
                placeholder="1xxxxxxxxxx"
              />
            </Form.Item>
            <Form.Item
              label="额外次数"
              name="extraChances"
              rules={[{ required: true, message: '请输入额外次数' }]}
            >
              <InputNumber min={0} placeholder="1" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="备注（可选）" name="note">
              <Input placeholder="如：VIP用户" />
            </Form.Item>
          </Form>
        </Modal>
      </main>
    </>
  );
}
