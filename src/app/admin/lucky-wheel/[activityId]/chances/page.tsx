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
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import Link from 'next/link';
import { use, useRef, useState } from 'react';
import { toast } from 'sonner';
import XLSX from 'xlsx-js-style';
import { Header } from '@/app/_components/layout/header';
import { PHONE_RE } from '@/modules/lucky-wheel/constants';
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

  const { data: activities } = api.luckyWheel.admin.listActivities.useQuery();
  const activityName =
    activities?.find((a) => a.id === activityId)?.name ?? '活动';

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

  const batchDeleteMutation =
    api.luckyWheel.admin.batchDeleteExtraChances.useMutation({
      onSuccess: (res) => {
        toast.success(`已删除 ${res.count} 条配置`);
        setSelectedRowKeys([]);
        void refetch();
      },
      onError: (err) => toast.error(err.message),
    });

  const batchImportMutation =
    api.luckyWheel.admin.batchImportExtraChances.useMutation({
      onSuccess: (res) => {
        toast.success(`已导入 ${res.count} 条配置`);
        void refetch();
      },
      onError: (err) => toast.error(err.message),
    });

  const [editing, setEditing] = useState<EditingChance | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function downloadTemplate() {
    const headers = ['手机号', '额外次数', '备注'];
    const example = ['13800138000', 1, 'VIP用户'];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = [{ wch: 15 }, { wch: 10 }, { wch: 20 }];
    // 表头样式
    for (let c = 0; c < headers.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell)
        cell.s = {
          font: { bold: true, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '4472C4' } },
          alignment: { horizontal: 'center' },
        };
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '额外次数模板');
    XLSX.writeFile(wb, '额外次数导入模板.xlsx');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // 重置 input 以便重复选择同一文件
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]!];
        if (!ws) {
          toast.error('文件为空');
          return;
        }
        const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
          header: 1,
        });
        // 跳过表头，过滤空行
        const items = rows
          .slice(1)
          .filter((row) => row[0])
          .map((row) => ({
            phone: String(row[0]).trim(),
            extraChances: Number(row[1]) || 0,
            note: row[2] ? String(row[2]).trim() : undefined,
          }));

        if (items.length === 0) {
          toast.error('未找到有效数据');
          return;
        }

        // 前端校验手机号格式
        const invalid = items.filter((item) => !PHONE_RE.test(item.phone));
        if (invalid.length > 0) {
          toast.error(
            `${invalid.length} 条手机号格式错误：${invalid
              .slice(0, 3)
              .map((i) => i.phone)
              .join('、')}${invalid.length > 3 ? '...' : ''}`,
          );
          return;
        }

        batchImportMutation.mutate({ activityId, items });
      } catch {
        toast.error('文件解析失败，请检查格式');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function handleBatchDelete() {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '确认批量删除',
      content: `确定删除选中的 ${selectedRowKeys.length} 条配置？`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => batchDeleteMutation.mutate({ ids: selectedRowKeys }),
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
      render: (val: Date | string) => dayjs(val).format('YYYY-MM-DD HH:mm:ss'),
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
          {/* 面包屑 */}
          <Breadcrumb
            items={[
              {
                title: <Link href="/admin/lucky-wheel">大转盘管理</Link>,
              },
              {
                title: (
                  <Link href={`/admin/lucky-wheel/${activityId}`}>
                    {activityName}
                  </Link>
                ),
              },
              { title: '额外次数配置' },
            ]}
            style={{ marginBottom: 16 }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 24,
            }}
          >
            <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>
              为指定手机号配置额外抽奖次数（在基础次数之上叠加）
            </p>
            <Space>
              <Button onClick={downloadTemplate}>下载模板</Button>
              <Button
                loading={batchImportMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                批量导入
              </Button>
              <Button
                onClick={() =>
                  openModal({ phone: '', extraChances: 1, note: '' })
                }
                type="primary"
              >
                添加配置
              </Button>
            </Space>
          </div>

          {/* 批量操作栏 */}
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
              <Button
                onClick={() => setSelectedRowKeys([])}
                size="small"
                type="link"
              >
                取消选择
              </Button>
            </div>
          )}

          {/* 额外次数表格 */}
          <Table
            columns={columns}
            dataSource={chances ?? []}
            locale={{ emptyText: '暂无配置，点击「添加配置」开始' }}
            pagination={false}
            rowKey="id"
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys as string[]),
            }}
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

        {/* 隐藏文件上传 */}
        <input
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          ref={fileInputRef}
          style={{ display: 'none' }}
          type="file"
        />
      </main>
    </>
  );
}
