'use client';

import {
  DeleteOutlined,
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
  DatePicker,
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
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  BANNER_CONFIG_KEY,
  MODULE_NAME,
} from '@/modules/battery-swap/constants';
import type { PackageSpec } from '@/modules/battery-swap/schema';
import { formatPrice } from '@/modules/battery-swap/schema';
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
  company: string;
  title: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string;
  originalPrice: number; // 元
  salePrice: number; // 元
  specs: { model: string; price: number }[]; // price 是元
  depositMethod: string;
  regionLimit: string;
  purchaseNotes: string;
  timeRange: [Dayjs, Dayjs] | null;
  purchaseLink: string;
};

type PackageRow = {
  id: string;
  company: string;
  title: string;
  imageUrl: string | null;
  detailImageUrl: string | null;
  cardBgColor: string | null;
  originalPrice: number;
  salePrice: number;
  specs: PackageSpec[];
  depositMethod: string | null;
  regionLimit: string | null;
  purchaseNotes: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  purchaseLink: string | null;
  sortOrder: number;
  isActive: boolean;
};

function rowToEditing(r: PackageRow): EditingPackage {
  return {
    id: r.id,
    company: r.company,
    title: r.title,
    imageUrl: r.imageUrl,
    detailImageUrl: r.detailImageUrl,
    cardBgColor: r.cardBgColor ?? '#ffffff',
    originalPrice: r.originalPrice / 100,
    salePrice: r.salePrice / 100,
    specs: r.specs.map((s) => ({ model: s.model, price: s.price / 100 })),
    depositMethod: r.depositMethod ?? '芝麻信用抵押金',
    regionLimit: r.regionLimit ?? '',
    purchaseNotes: r.purchaseNotes ?? '',
    timeRange:
      r.validFrom && r.validTo ? [dayjs(r.validFrom), dayjs(r.validTo)] : null,
    purchaseLink: r.purchaseLink ?? '',
  };
}

const DEFAULT_EDITING: EditingPackage = {
  company: '',
  title: '',
  imageUrl: null,
  detailImageUrl: null,
  cardBgColor: '#ffffff',
  originalPrice: 0,
  salePrice: 0,
  specs: [
    { model: '', price: 0 },
    { model: '', price: 0 },
  ],
  depositMethod: '芝麻信用抵押金',
  regionLimit: '',
  purchaseNotes: '上海仅限48V，60V慎拍',
  timeRange: null,
  purchaseLink: '',
};

// ── 主组件 ──────────────────────────────────────────────

export default function AdminBatterySwapPage() {
  const { data: packages, refetch } = api.batterySwap.admin.list.useQuery();

  const upsertMutation = api.batterySwap.admin.upsert.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = api.batterySwap.admin.toggleActive.useMutation({
    onSuccess: () => {
      toast.success('状态已更新');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.batterySwap.admin.delete.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = api.batterySwap.admin.reorder.useMutation({
    onSuccess: () => void refetch(),
    onError: (err) => {
      toast.error(err.message);
      // 回滚：用服务端数据恢复本地状态
      void refetch();
    },
  });

  // ── Banner 配置 ──────────────────────────────────────
  const utils = api.useUtils();
  const { data: bannerConfig } = api.admin.getConfig.useQuery({
    key: BANNER_CONFIG_KEY,
  });
  const setConfigMutation = api.admin.setConfig.useMutation({
    onSuccess: () => {
      toast.success('Banner 已更新');
      void utils.admin.getConfig.invalidate({ key: BANNER_CONFIG_KEY });
    },
    onError: (err) => toast.error(err.message),
  });
  const [uploadingBanner, setUploadingBanner] = useState(false);

  async function handleBannerUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Banner 图片不能超过 5MB');
      return;
    }
    setUploadingBanner(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?module=battery-swap', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? '上传失败');
        return;
      }
      setConfigMutation.mutate({
        key: BANNER_CONFIG_KEY,
        value: data.url,
        description: `${MODULE_NAME}页面顶部 Banner 图`,
      });
    } catch {
      toast.error('上传失败，请重试');
    } finally {
      setUploadingBanner(false);
    }
  }

  const [editing, setEditing] = useState<EditingPackage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingDetail, setUploadingDetail] = useState(false);

  // ── 拖拽排序（乐观更新，先更新 UI 再提交服务器）──────
  const [localPackages, setLocalPackages] = useState<typeof packages>();

  // 服务端数据变更时同步到本地（首次加载 + 增删改后 refetch）
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

  // ── 图片上传 ──────────────────────────────────────────

  async function handleImageUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?module=battery-swap', {
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

  // ── 详情长图上传 ──────────────────────────────────────

  async function handleDetailImageUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('详情长图大小不能超过 10MB');
      return;
    }
    setUploadingDetail(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload?module=battery-swap', {
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

  // ── 保存 ──────────────────────────────────────────────

  function handleSave() {
    if (!editing) return;
    if (!editing.company || !editing.title) {
      toast.error('请填写公司名称和商品标题');
      return;
    }
    if (editing.specs.some((s) => !s.model)) {
      toast.error('请填写所有规格的电池型号');
      return;
    }
    upsertMutation.mutate({
      id: editing.id,
      company: editing.company,
      title: editing.title,
      imageUrl: editing.imageUrl,
      detailImageUrl: editing.detailImageUrl,
      cardBgColor: editing.cardBgColor || '#ffffff',
      originalPrice: Math.round(editing.originalPrice * 100),
      salePrice: Math.round(editing.salePrice * 100),
      specs: editing.specs.map((s) => ({
        model: s.model,
        price: Math.round(s.price * 100),
      })),
      depositMethod: editing.depositMethod || null,
      regionLimit: editing.regionLimit || null,
      purchaseNotes: editing.purchaseNotes || null,
      validFrom: editing.timeRange ? editing.timeRange[0].toISOString() : null,
      validTo: editing.timeRange ? editing.timeRange[1].toISOString() : null,
      purchaseLink: editing.purchaseLink || null,
    });
  }

  function updateEditing(patch: Partial<EditingPackage>) {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function updateSpec(
    index: number,
    field: 'model' | 'price',
    value: string | number,
  ) {
    setEditing((prev) => {
      if (!prev) return prev;
      const specs = [...prev.specs];
      const current = specs[index];
      if (current) specs[index] = { ...current, [field]: value };
      return { ...prev, specs };
    });
  }

  function addSpec() {
    setEditing((prev) => {
      if (!prev) return prev;
      return { ...prev, specs: [...prev.specs, { model: '', price: 0 }] };
    });
  }

  function removeSpec(index: number) {
    setEditing((prev) => {
      if (!prev || prev.specs.length <= 1) return prev;
      return { ...prev, specs: prev.specs.filter((_, i) => i !== index) };
    });
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
      title: '公司',
      dataIndex: 'company',
      key: 'company',
      width: 90,
      ellipsis: true,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '售价',
      key: 'price',
      width: 100,
      render: (_, r) => (
        <span>
          <span className="font-bold text-red-500">
            ¥{formatPrice(r.salePrice)}
          </span>
          <br />
          <span className="text-gray-400 text-xs line-through">
            ¥{formatPrice(r.originalPrice)}
          </span>
        </span>
      ),
    },
    {
      title: '详情',
      dataIndex: 'detailImageUrl',
      key: 'detailImageUrl',
      width: 56,
      render: (url: string | null) =>
        url ? (
          <Image
            alt="详情图"
            height={36}
            src={url}
            style={{ borderRadius: 4, objectFit: 'cover' }}
            width={36}
          />
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
    {
      title: '底色',
      dataIndex: 'cardBgColor',
      key: 'cardBgColor',
      width: 48,
      render: (color: string | null) => (
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            backgroundColor: color ?? '#ffffff',
            border: '1px solid #d9d9d9',
          }}
        />
      ),
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
    <>
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

          {/* Banner 配置 */}
          <div className="mb-6 rounded-xl bg-white p-4">
            <h2 className="mb-3 font-semibold text-gray-700">页面 Banner</h2>
            <div className="flex items-center gap-4">
              {bannerConfig?.value && typeof bannerConfig.value === 'string' ? (
                <Image
                  alt="Banner"
                  height={80}
                  src={bannerConfig.value}
                  style={{ borderRadius: 8, objectFit: 'cover' }}
                  width={240}
                />
              ) : (
                <div className="flex h-20 w-60 items-center justify-center rounded-lg border border-gray-300 border-dashed text-gray-400 text-sm">
                  未设置 Banner
                </div>
              )}
              <Space>
                <Upload
                  accept="image/*"
                  beforeUpload={(file) => {
                    void handleBannerUpload(file);
                    return false;
                  }}
                  showUploadList={false}
                >
                  <Button icon={<UploadOutlined />} loading={uploadingBanner}>
                    {bannerConfig?.value ? '更换 Banner' : '上传 Banner'}
                  </Button>
                </Upload>
                {typeof bannerConfig?.value === 'string' &&
                  bannerConfig.value && (
                    <Popconfirm
                      onConfirm={() =>
                        setConfigMutation.mutate({
                          key: BANNER_CONFIG_KEY,
                          value: '',
                          description: `${MODULE_NAME}页面顶部 Banner 图`,
                        })
                      }
                      title="确定删除 Banner 吗？"
                    >
                      <Button danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  )}
              </Space>
            </div>
          </div>

          <DndContext
            id="battery-swap-packages"
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
        title={editing?.id ? '编辑套餐' : '新建套餐'}
        width={700}
      >
        {editing && (
          <Form layout="vertical" style={{ marginTop: 16 }}>
            {/* 商品图片 */}
            <Form.Item label="商品实物图">
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
            <Form.Item label="详情长图（前台可查看）">
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

            {/* 换电公司 */}
            <Form.Item label="换电公司" required>
              <Input
                onChange={(e) => updateEditing({ company: e.target.value })}
                placeholder="如：智租换电"
                value={editing.company}
              />
            </Form.Item>

            {/* 商品标题 */}
            <Form.Item label="商品标题" required>
              <Input
                onChange={(e) => updateEditing({ title: e.target.value })}
                placeholder="如：智租×申通专属包月套餐"
                value={editing.title}
              />
            </Form.Item>

            {/* 价格 */}
            <div style={{ display: 'flex', gap: 16 }}>
              <Form.Item label="划线价（元）" required>
                <InputNumber
                  min={0}
                  onChange={(v) => updateEditing({ originalPrice: v ?? 0 })}
                  precision={2}
                  step={0.01}
                  style={{ width: 180 }}
                  value={editing.originalPrice}
                />
              </Form.Item>
              <Form.Item label="最低销售价（元）" required>
                <InputNumber
                  min={0}
                  onChange={(v) => updateEditing({ salePrice: v ?? 0 })}
                  precision={2}
                  step={0.01}
                  style={{ width: 180 }}
                  value={editing.salePrice}
                />
              </Form.Item>
            </div>

            {/* 套餐规格 */}
            <Form.Item label="套餐规格" required>
              {editing.specs.map((spec, idx) => (
                <Space
                  align="center"
                  key={idx}
                  style={{ display: 'flex', marginBottom: 8 }}
                >
                  <Input
                    onChange={(e) => updateSpec(idx, 'model', e.target.value)}
                    placeholder="电池型号，如 48V 20Ah"
                    style={{ width: 200 }}
                    value={spec.model}
                  />
                  <InputNumber
                    min={0}
                    onChange={(v) => updateSpec(idx, 'price', v ?? 0)}
                    placeholder="价格"
                    precision={2}
                    step={0.01}
                    style={{ width: 140 }}
                    value={spec.price}
                  />
                  <span className="text-gray-500 text-sm leading-8">元/月</span>
                  {editing.specs.length > 1 && (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeSpec(idx)}
                      size="small"
                      type="text"
                    />
                  )}
                </Space>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={addSpec}
                size="small"
                type="dashed"
              >
                添加规格
              </Button>
            </Form.Item>

            {/* 押金方式 */}
            <Form.Item label="押金方式">
              <Input
                onChange={(e) =>
                  updateEditing({ depositMethod: e.target.value })
                }
                placeholder="芝麻信用抵押金"
                value={editing.depositMethod}
              />
            </Form.Item>

            {/* 区域限制 */}
            <Form.Item label="区域限制">
              <Input.TextArea
                autoSize={{ minRows: 2 }}
                onChange={(e) => updateEditing({ regionLimit: e.target.value })}
                placeholder="如：66个城市可用"
                value={editing.regionLimit}
              />
            </Form.Item>

            {/* 购买须知 */}
            <Form.Item label="购买须知">
              <Input.TextArea
                autoSize={{ minRows: 2 }}
                onChange={(e) =>
                  updateEditing({ purchaseNotes: e.target.value })
                }
                placeholder="上海仅限48V，60V慎拍"
                value={editing.purchaseNotes}
              />
            </Form.Item>

            {/* 有效期 */}
            <Form.Item label="套餐有效期">
              <DatePicker.RangePicker
                format="YYYY-MM-DD"
                onChange={(range) =>
                  updateEditing({
                    timeRange:
                      range?.[0] && range[1] ? [range[0], range[1]] : null,
                  })
                }
                style={{ width: '100%' }}
                value={editing.timeRange}
              />
            </Form.Item>

            {/* 购买链接 */}
            <Form.Item label="购买跳转链接">
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
    </>
  );
}
