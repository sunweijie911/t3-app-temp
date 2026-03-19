'use client';

import { HolderOutlined } from '@ant-design/icons';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Alert,
  Breadcrumb,
  Button,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PRIZE_TYPE_LABELS } from '@/modules/lucky-wheel/constants';
import { api } from '@/trpc/react';

type PrizeType = 'physical' | 'virtual' | 'coupon' | 'points' | 'thanks';

type PrizeRow = {
  _key: string;
  id?: string;
  name: string;
  type: PrizeType;
  probability: string;
  totalStock: string;
  value: string;
};

function toPrizeRow(p: {
  id: string;
  name: string;
  type: string;
  probability: number;
  totalStock: number;
  value?: Record<string, unknown> | null;
}): PrizeRow {
  return {
    _key: p.id,
    id: p.id,
    name: p.name,
    type: p.type as PrizeType,
    probability: String(p.probability / 100),
    totalStock: String(p.totalStock),
    value: ((p.value?.display as string) ?? '').replace(/[^\d.]/g, ''),
  };
}

// 可拖拽的 Table Row
function SortableRow({
  children,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement> & { 'data-row-key': string }) {
  const key = props['data-row-key'];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: key });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: isDragging ? 'relative' : undefined,
    zIndex: isDragging ? 999 : undefined,
  };

  return (
    <tr
      {...props}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      {children}
    </tr>
  );
}

const prizeTypeOptions = Object.entries(PRIZE_TYPE_LABELS).map(([k, v]) => ({
  label: v,
  value: k,
}));

interface Props {
  params: Promise<{ activityId: string }>;
}

export default function AdminPrizesPage({ params }: Props) {
  const { activityId } = use(params);

  const { data: activities } = api.luckyWheel.admin.listActivities.useQuery();
  const activityName =
    activities?.find((a) => a.id === activityId)?.name ?? '活动';

  const { data: prizes, refetch } = api.luckyWheel.admin.getPrizes.useQuery({
    activityId,
  });
  const batchUpsertMutation =
    api.luckyWheel.admin.batchUpsertPrizes.useMutation({
      onSuccess: () => {
        toast.success('保存成功');
        initialized.current = false;
        void refetch();
      },
      onError: (err) => toast.error(err.message),
    });
  const deletePrizeMutation = api.luckyWheel.admin.deletePrize.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const [rows, setRows] = useState<PrizeRow[]>([]);
  const initialized = useRef(false);

  useEffect(() => {
    if (prizes && !initialized.current) {
      setRows(prizes.map(toPrizeRow));
      initialized.current = true;
    }
  }, [prizes]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // 拖拽前需移动 5px，避免点击输入框时误触发拖拽
      activationConstraint: { distance: 5 },
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const fromIdx = prev.findIndex((r) => r._key === active.id);
      const toIdx = prev.findIndex((r) => r._key === over.id);
      return arrayMove(prev, fromIdx, toIdx);
    });
  }

  const activePct = rows.reduce(
    (sum, r) => sum + (Number(r.probability) || 0),
    0,
  );
  const totalPctDisplay = Math.round(activePct * 10) / 10;
  const isPctValid = Math.abs(activePct - 100) < 0.1;

  function updateRow(key: string, patch: Partial<PrizeRow>) {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, ...patch } : r)),
    );
  }

  function addRow() {
    const key = `new-${Date.now()}`;
    setRows((prev) => [
      ...prev,
      {
        _key: key,
        name: '',
        type: 'physical',
        probability: '',
        totalStock: '',
        value: '',
      },
    ]);
  }

  function removeRow(row: PrizeRow) {
    setRows((prev) => prev.filter((r) => r._key !== row._key));
    if (row.id) {
      deletePrizeMutation.mutate({ id: row.id });
    }
  }

  function handleSaveAll() {
    for (const row of rows) {
      if (!row.name.trim()) {
        toast.error('请填写所有奖品名称');
        return;
      }
      if ((Number(row.probability) || 0) <= 0) {
        toast.error(`「${row.name || '新奖品'}」概率不能为 0`);
        return;
      }
      if (row.type !== 'thanks' && (Number(row.totalStock) || 0) <= 0) {
        toast.error(`「${row.name}」不是谢谢参与类型，库存不能为 0`);
        return;
      }
    }
    if (rows.length > 0 && Math.abs(activePct - 100) >= 0.1) {
      toast.error(`概率总计为 ${totalPctDisplay}%，请调整至 100% 后再保存`);
      return;
    }
    batchUpsertMutation.mutate(
      rows.map((row, idx) => ({
        id: row.id,
        activityId,
        name: row.name,
        type: row.type,
        probability: Math.round((Number(row.probability) || 0) * 100),
        totalStock: Number(row.totalStock) || 0,
        value: row.value ? { display: row.value } : null,
        sortOrder: idx,
        isActive: true,
      })),
    );
  }

  const columns: ColumnsType<PrizeRow> = [
    {
      title: '',
      dataIndex: '_drag',
      width: 32,
      render: () => (
        <HolderOutlined style={{ color: '#9ca3af', fontSize: 16 }} />
      ),
    },
    {
      title: '奖品名称',
      dataIndex: 'name',
      render: (_, row) => (
        <Input
          onChange={(e) => updateRow(row._key, { name: e.target.value })}
          placeholder="奖品名称"
          style={{ minWidth: 120 }}
          value={row.name}
        />
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      render: (_, row) => (
        <Select
          onChange={(val) => updateRow(row._key, { type: val as PrizeType })}
          options={prizeTypeOptions}
          style={{ width: 120 }}
          value={row.type}
        />
      ),
    },
    {
      title: '概率 %',
      dataIndex: 'probability',
      render: (_, row) => (
        <Space.Compact style={{ width: 130 }}>
          <InputNumber
            max={100}
            min={0}
            onChange={(val) =>
              updateRow(row._key, {
                probability: val == null ? '' : String(val),
              })
            }
            placeholder="0"
            step={0.01}
            style={{ flex: 1 }}
            value={row.probability === '' ? null : Number(row.probability)}
          />
          <Typography.Text
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 8px',
              background: '#fafafa',
              border: '1px solid #d9d9d9',
              borderLeft: 0,
              borderRadius: '0 6px 6px 0',
              color: '#6b7280',
              fontSize: 13,
            }}
          >
            %
          </Typography.Text>
        </Space.Compact>
      ),
    },
    {
      title: '价值',
      dataIndex: 'value',
      render: (_, row) => (
        <Space.Compact style={{ width: 130 }}>
          <InputNumber
            min={0}
            onChange={(val) =>
              updateRow(row._key, {
                value: val == null ? '' : String(val),
              })
            }
            placeholder="0"
            step={0.01}
            style={{ flex: 1 }}
            value={row.value === '' ? null : Number(row.value)}
          />
          <Typography.Text
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 8px',
              background: '#fafafa',
              border: '1px solid #d9d9d9',
              borderLeft: 0,
              borderRadius: '0 6px 6px 0',
              color: '#6b7280',
              fontSize: 13,
            }}
          >
            元
          </Typography.Text>
        </Space.Compact>
      ),
    },
    {
      title: '总库存',
      dataIndex: 'totalStock',
      render: (_, row) => (
        <InputNumber
          min={0}
          onChange={(val) =>
            updateRow(row._key, {
              totalStock: val == null ? '' : String(val),
            })
          }
          placeholder="0"
          style={{ width: 100 }}
          value={row.totalStock === '' ? null : Number(row.totalStock)}
        />
      ),
    },
    {
      title: '操作',
      dataIndex: '_key',
      render: (_, row) => (
        <Button
          danger
          disabled={deletePrizeMutation.isPending}
          onClick={() => removeRow(row)}
          size="small"
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <main style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto', padding: '48px 16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 32,
          }}
        >
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
              { title: '奖品配置' },
            ]}
          />
          <Space>
            <Button onClick={addRow}>+ 添加奖品</Button>
            <Button
              disabled={batchUpsertMutation.isPending}
              loading={batchUpsertMutation.isPending}
              onClick={handleSaveAll}
              type="primary"
            >
              保存全部
            </Button>
          </Space>
        </div>

        {rows.length > 0 && (
          <Alert
            showIcon
            style={{ marginBottom: 16 }}
            title={
              <>
                奖品概率总计：<strong>{totalPctDisplay}%</strong>
                {isPctValid ? ' ✓' : ' — 建议调整至 100%'}
              </>
            }
            type={isPctValid ? 'success' : 'warning'}
          />
        )}

        <DndContext onDragEnd={handleDragEnd} sensors={sensors}>
          <SortableContext
            items={rows.map((r) => r._key)}
            strategy={verticalListSortingStrategy}
          >
            <Table
              columns={columns}
              components={{ body: { row: SortableRow } }}
              dataSource={rows}
              locale={{ emptyText: '暂无奖品，点击「添加奖品」开始配置' }}
              pagination={false}
              rowKey="_key"
              scroll={{ x: true }}
            />
          </SortableContext>
        </DndContext>
      </div>
    </main>
  );
}
