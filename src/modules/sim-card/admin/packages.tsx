'use client';

import {
  HolderOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
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
  Button,
  ColorPicker,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MODULE_NAME } from '@/modules/sim-card/constants';
import { formatSimCardPrice } from '@/modules/sim-card/schema';
import { api } from '@/trpc/react';

// ── 拖拽行组件 ──────────────────────────────────────────

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

// ── 类型 ──────────────────────────────────────────────

type EditingPackage = {
  id?: string;
  title: string;
  carrier: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string;
  monthlyPrice: number; // 元
  dataAllowance: string;
  callMinutes: string;
  highlights: string[];
  description: string;
  purchaseLink: string;
};

type PackageRow = {
  id: string;
  title: string;
  carrier: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string | null;
  monthlyPrice: number;
  dataAllowance: string | null;
  callMinutes: string | null;
  highlights: string[] | null;
  description: string | null;
  purchaseLink: string | null;
  sortOrder: number;
  isActive: boolean;
};

function rowToEditing(r: PackageRow): EditingPackage {
  return {
    id: r.id,
    title: r.title,
    carrier: r.carrier,
    imageUrl: r.imageUrl,
    detailImageUrl: r.detailImageUrl,
    cardBgColor: r.cardBgColor ?? '#ffffff',
    monthlyPrice: r.monthlyPrice / 100,
    dataAllowance: r.dataAllowance ?? '',
    callMinutes: r.callMinutes ?? '',
    highlights: r.highlights ?? [],
    description: r.description ?? '',
    purchaseLink: r.purchaseLink ?? '',
  };
}

const DEFAULT_EDITING: EditingPackage = {
  title: '',
  carrier: '',
  imageUrl: null,
  detailImageUrl: null,
  cardBgColor: '#ffffff',
  monthlyPrice: 0,
  dataAllowance: '',
  callMinutes: '',
  highlights: [],
  description: '',
  purchaseLink: '',
};

// ── 主组件 ──────────────────────────────────────────────

export default function AdminSimCardPackagesPage() {
  const { data: packages, refetch } = api.simCard.admin.list.useQuery();

  const upsertMutation = api.simCard.admin.upsert.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = api.simCard.admin.toggleActive.useMutation({
    onSuccess: () => {
      toast.success('状态已更新');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.simCard.admin.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = api.simCard.admin.reorder.useMutation({
    onSuccess: () => void refetch(),
    onError: (err) => {
      toast.error(err.message);
      void refetch();
    },
  });

  const [editing, setEditing] = useState<EditingPackage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingDetail, setUploadingDetail] = useState(false);

  // ── 拖拽排序 ──────────────────────────────────────
  const [localPackages, setLocalPackages] = useState<typeof packages>();

  useEffect(() => {
    if (packages) setLocalPackages(packages);
  }, [packages]);

  const displayPackages = localPackages ?? packages;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !displayPackages) return;

    const fromIdx = displayPackages.findIndex((p) => p.id === active.id);
    const toIdx = displayPackages.findIndex((p) => p.id === over.id);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = arrayMove([...displayPackages], fromIdx, toIdx);
    setLocalPackages(reordered);
    reorderMutation.mutate({ ids: reordered.map((p) => p.id) });
  }

  // ── 图片上传 ──────────────────────────────────────

  async function handleImageUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?module=sim-card', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? '上传失败');
        return;
      }
      setEditing((prev) =>
        prev ? { ...prev, imageUrl: data.url ?? null } : prev,
      );
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  async function handleDetailImageUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('详情长图大小不能超过 10MB');
      return;
    }
    setUploadingDetail(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?module=sim-card', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? '上传失败');
        return;
      }
      setEditing((prev) =>
        prev ? { ...prev, detailImageUrl: data.url ?? null } : prev,
      );
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploadingDetail(false);
    }
  }

  // ── 亮点标签管理 ──────────────────────────────────

  const [newHighlight, setNewHighlight] = useState('');

  function addHighlight() {
    if (!newHighlight.trim() || !editing) return;
    setEditing({
      ...editing,
      highlights: [...editing.highlights, newHighlight.trim()],
    });
    setNewHighlight('');
  }

  function removeHighlight(index: number) {
    if (!editing) return;
    setEditing({
      ...editing,
      highlights: editing.highlights.filter((_, i) => i !== index),
    });
  }

  // ── 保存 ──────────────────────────────────────────

  function handleSave() {
    if (!editing) return;
    if (!editing.carrier || !editing.title) {
      toast.error('请填写运营商和套餐标题');
      return;
    }
    upsertMutation.mutate({
      id: editing.id,
      title: editing.title,
      carrier: editing.carrier,
      imageUrl: editing.imageUrl,
      detailImageUrl: editing.detailImageUrl,
      cardBgColor: editing.cardBgColor || '#ffffff',
      monthlyPrice: Math.round(editing.monthlyPrice * 100),
      dataAllowance: editing.dataAllowance || null,
      callMinutes: editing.callMinutes || null,
      highlights: editing.highlights,
      description: editing.description || null,
      purchaseLink: editing.purchaseLink || null,
    });
  }

  function updateEditing(patch: Partial<EditingPackage>) {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  // ── 列定义 ──────────────────────────────────────────

  const columns: ColumnsType<PackageRow> = [
    {
      title: '',
      width: 40,
      render: () => (
        <HolderOutlined style={{ cursor: 'grab', color: '#999' }} />
      ),
    },
    {
      title: '图片',
      dataIndex: 'imageUrl',
      key: 'imageUrl',
      width: 70,
      render: (url: string | null) =>
        url ? (
          <Image
            alt="商品图"
            height={44}
            src={url}
            style={{ borderRadius: 4, objectFit: 'cover' }}
            width={44}
          />
        ) : (
          <span className="text-gray-400">无图</span>
        ),
    },
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 150,
      ellipsis: true,
    },
    {
      title: '运营商',
      dataIndex: 'carrier',
      key: 'carrier',
      width: 90,
      ellipsis: true,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '月费',
      key: 'monthlyPrice',
      width: 80,
      render: (_, r) => (
        <span className="font-bold text-red-500">
          ¥{formatSimCardPrice(r.monthlyPrice)}
        </span>
      ),
    },
    {
      title: '流量',
      dataIndex: 'dataAllowance',
      key: 'dataAllowance',
      width: 80,
      render: (v: string | null) => v || '—',
    },
    {
      title: '通话',
      dataIndex: 'callMinutes',
      key: 'callMinutes',
      width: 80,
      render: (v: string | null) => v || '—',
    },
    {
      title: '状态',
      key: 'isActive',
      width: 80,
      render: (_, r) =>
        r.isActive ? (
          <Tag color="green">已上架</Tag>
        ) : (
          <Tag color="default">已下架</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space>
          <Button onClick={() => setEditing(rowToEditing(record))} size="small">
            编辑
          </Button>
          {record.isActive ? (
            <Button
              danger
              loading={
                toggleMutation.isPending &&
                toggleMutation.variables?.id === record.id
              }
              onClick={() =>
                toggleMutation.mutate({ id: record.id, isActive: false })
              }
              size="small"
              variant="outlined"
            >
              下架
            </Button>
          ) : (
            <Button
              loading={
                toggleMutation.isPending &&
                toggleMutation.variables?.id === record.id
              }
              onClick={() =>
                toggleMutation.mutate({ id: record.id, isActive: true })
              }
              size="small"
              style={{ color: '#389e0d', borderColor: '#b7eb8f' }}
              variant="outlined"
            >
              上架
            </Button>
          )}
          <Popconfirm
            cancelText="取消"
            okText="确认删除"
            okType="danger"
            onConfirm={() => deleteMutation.mutate({ id: record.id })}
            title="删除后不可恢复，确认删除该套餐？"
          >
            <Button
              danger
              loading={
                deleteMutation.isPending &&
                deleteMutation.variables?.id === record.id
              }
              size="small"
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const sortableIds = displayPackages?.map((p) => p.id) ?? [];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-bold text-2xl text-gray-900">
            {MODULE_NAME}管理
          </h1>
          <Button
            onClick={() => setEditing({ ...DEFAULT_EDITING })}
            type="primary"
          >
            新建套餐
          </Button>
        </div>

        <DndContext
          id="sim-card-packages"
          onDragEnd={handleDragEnd}
          sensors={sensors}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            <Table
              columns={columns}
              components={{ body: { row: SortableRow } }}
              dataSource={displayPackages as PackageRow[] | undefined}
              pagination={false}
              rowKey="id"
              scroll={{ x: 900 }}
              style={{ background: '#fff', borderRadius: 12 }}
            />
          </SortableContext>
        </DndContext>
      </div>

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
        title={editing?.id ? '编辑套餐' : '新建套餐'}
        width={700}
      >
        {editing && (
          <Form layout="vertical" style={{ marginTop: 16 }}>
            {/* 商品图片 */}
            <Form.Item label="商品图片">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editing.imageUrl && (
                  <Image
                    alt="商品图片"
                    src={editing.imageUrl}
                    style={{ borderRadius: 8, objectFit: 'cover' }}
                    width={200}
                  />
                )}
                <Upload
                  accept="image/*"
                  beforeUpload={(file) => {
                    void handleImageUpload(file);
                    return false;
                  }}
                  showUploadList={false}
                >
                  <Button icon={<UploadOutlined />} loading={uploading}>
                    {editing.imageUrl ? '更换图片' : '上传图片'}
                  </Button>
                </Upload>
              </div>
            </Form.Item>

            {/* 详情长图 */}
            <Form.Item label="详情长图">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editing.detailImageUrl && (
                  <div
                    style={{ position: 'relative', display: 'inline-block' }}
                  >
                    <Image
                      alt="详情长图"
                      src={editing.detailImageUrl}
                      style={{ borderRadius: 8, objectFit: 'cover' }}
                      width={200}
                    />
                    <Button
                      danger
                      onClick={() => updateEditing({ detailImageUrl: null })}
                      size="small"
                      style={{ marginLeft: 8 }}
                      type="text"
                    >
                      移除
                    </Button>
                  </div>
                )}
                <Upload
                  accept="image/*"
                  beforeUpload={(file) => {
                    void handleDetailImageUpload(file);
                    return false;
                  }}
                  showUploadList={false}
                >
                  <Button icon={<UploadOutlined />} loading={uploadingDetail}>
                    {editing.detailImageUrl ? '更换详情图' : '上传详情图'}
                  </Button>
                </Upload>
              </div>
            </Form.Item>

            {/* 卡片背景色 */}
            <Form.Item label="卡片背景色">
              <Space>
                <ColorPicker
                  onChange={(_, hex) => updateEditing({ cardBgColor: hex })}
                  showText
                  value={editing.cardBgColor}
                />
                <Button
                  onClick={() => updateEditing({ cardBgColor: '#ffffff' })}
                  size="small"
                  type="link"
                >
                  重置为白色
                </Button>
              </Space>
            </Form.Item>

            {/* 运营商 */}
            <Form.Item label="运营商" required>
              <Input
                onChange={(e) => updateEditing({ carrier: e.target.value })}
                placeholder="如：中国移动"
                value={editing.carrier}
              />
            </Form.Item>

            {/* 套餐标题 */}
            <Form.Item label="套餐标题" required>
              <Input
                onChange={(e) => updateEditing({ title: e.target.value })}
                placeholder="如：大流量畅享套餐"
                value={editing.title}
              />
            </Form.Item>

            {/* 月费 */}
            <Form.Item label="月费（元）" required>
              <InputNumber
                min={0}
                onChange={(v) => updateEditing({ monthlyPrice: v ?? 0 })}
                precision={2}
                step={0.01}
                style={{ width: 200 }}
                value={editing.monthlyPrice}
              />
            </Form.Item>

            {/* 流量额度 */}
            <div style={{ display: 'flex', gap: 16 }}>
              <Form.Item label="流量额度" style={{ flex: 1 }}>
                <Input
                  onChange={(e) =>
                    updateEditing({ dataAllowance: e.target.value })
                  }
                  placeholder="如：100GB"
                  value={editing.dataAllowance}
                />
              </Form.Item>
              <Form.Item label="通话时长" style={{ flex: 1 }}>
                <Input
                  onChange={(e) =>
                    updateEditing({ callMinutes: e.target.value })
                  }
                  placeholder="如：500分钟"
                  value={editing.callMinutes}
                />
              </Form.Item>
            </div>

            {/* 亮点标签 */}
            <Form.Item label="亮点标签">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {editing.highlights.map((tag, idx) => (
                    <Tag
                      closable
                      key={idx}
                      onClose={() => removeHighlight(idx)}
                    >
                      {tag}
                    </Tag>
                  ))}
                </div>
                <Space>
                  <Input
                    onChange={(e) => setNewHighlight(e.target.value)}
                    onPressEnter={addHighlight}
                    placeholder="输入标签后按回车"
                    size="small"
                    style={{ width: 200 }}
                    value={newHighlight}
                  />
                  <Button
                    icon={<PlusOutlined />}
                    onClick={addHighlight}
                    size="small"
                    type="dashed"
                  >
                    添加
                  </Button>
                </Space>
              </div>
            </Form.Item>

            {/* 套餐说明 */}
            <Form.Item label="套餐说明">
              <Input.TextArea
                autoSize={{ minRows: 2 }}
                onChange={(e) => updateEditing({ description: e.target.value })}
                placeholder="套餐详细说明"
                value={editing.description}
              />
            </Form.Item>

            {/* 办理链接 */}
            <Form.Item label="办理跳转链接">
              <Input
                onChange={(e) =>
                  updateEditing({ purchaseLink: e.target.value })
                }
                placeholder="https://..."
                value={editing.purchaseLink}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </main>
  );
}
