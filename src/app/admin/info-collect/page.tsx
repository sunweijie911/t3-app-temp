'use client';

import type { TableProps } from 'antd';
import {
  Button,
  Card,
  Form,
  Image,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import XLSX from 'xlsx-js-style';

import { Header } from '@/app/_components/layout/header';
import { ModuleSwitcher } from '@/app/admin/_components/module-switcher';
import {
  REVIEW_STATUS_COLORS,
  REVIEW_STATUS_LABELS,
} from '@/modules/info-collect/constants';
import { api, type RouterOutputs } from '@/trpc/react';

type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'needs_supplement'
  | 'completed';

type Filters = {
  status: ReviewStatus | '';
  search: string;
};

const defaultFilters: Filters = {
  status: '',
  search: '',
};

function buildFilterInput(filters: Filters) {
  return {
    status: (filters.status || undefined) as ReviewStatus | undefined,
    search: filters.search || undefined,
  };
}

type ExportRecord = {
  name: string | null;
  phone: string;
  idCard: string;
  proofImageUrl: string | null;
  status: string;
  rejectReason: string | null;
  trackingNumber: string | null;
  remark: string | null;
  createdAt: Date;
};

function toExcel(
  records: ExportRecord[],
  origin: string,
  enabledFields: string[],
): Blob {
  const hasName = enabledFields.includes('name');
  const hasProof = enabledFields.includes('proofImage');

  const headers: string[] = [];
  const colWidths: number[] = [];

  if (hasName) {
    headers.push('姓名');
    colWidths.push(10);
  }
  headers.push('手机号', '身份证号');
  colWidths.push(14, 22);
  if (hasProof) {
    headers.push('在职证明截图');
    colWidths.push(40);
  }
  headers.push('状态', '拒绝/补充原因', '发货单号', '备注', '提交时间');
  colWidths.push(10, 20, 18, 20, 20);

  const rows = records.map((r) => {
    const row: (string | null)[] = [];
    if (hasName) row.push(r.name ?? '');
    row.push(r.phone, r.idCard);
    if (hasProof)
      row.push(r.proofImageUrl ? `${origin}${r.proofImageUrl}` : '');
    row.push(
      REVIEW_STATUS_LABELS[r.status] ?? r.status,
      r.rejectReason ?? '',
      r.trackingNumber ?? '',
      r.remark ?? '',
      dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    );
    return row;
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = colWidths.map((w) => ({ wch: w }));

  const border = {
    top: { style: 'thin', color: { rgb: 'D9D9D9' } },
    bottom: { style: 'thin', color: { rgb: 'D9D9D9' } },
    left: { style: 'thin', color: { rgb: 'D9D9D9' } },
    right: { style: 'thin', color: { rgb: 'D9D9D9' } },
  } as const;
  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { fgColor: { rgb: '4472C4' } },
    alignment: { horizontal: 'center' as const, vertical: 'center' as const },
    border,
  };
  const cellStyle = {
    alignment: { vertical: 'center' as const, wrapText: true },
    border,
  };

  const totalRows = rows.length + 1;
  for (let c = 0; c < headers.length; c++) {
    const hCell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (hCell) hCell.s = headerStyle;
    for (let r = 1; r < totalRows; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) cell.s = cellStyle;
    }
  }

  // 在职证明截图列设为超链接样式
  if (hasProof) {
    const proofColIdx = hasName ? 3 : 2;
    const linkStyle = {
      alignment: { vertical: 'center' as const, wrapText: true },
      border,
      font: { color: { rgb: '0563C1' }, underline: true },
    };
    for (let r = 1; r < totalRows; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: proofColIdx })];
      if (cell?.v) {
        cell.l = { Target: String(cell.v) };
        cell.s = linkStyle;
      }
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '采集记录');
  // cspell:ignore wbout openxmlformats officedocument spreadsheetml
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

type RecordItem =
  RouterOutputs['infoCollect']['admin']['list']['items'][number];

export default function AdminInfoCollectPage() {
  const [filters, setFilters] = useState<Filters>({ ...defaultFilters });
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [exporting, setExporting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [reviewModal, setReviewModal] = useState<{
    id: string;
    action: 'approved' | 'rejected' | 'needs_supplement';
  } | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [trackingModal, setTrackingModal] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [batchRejectReason, setBatchRejectReason] = useState('');
  const [batchRejectModal, setBatchRejectModal] = useState(false);
  const [remarkModal, setRemarkModal] = useState<{
    id: string;
    remark: string;
  } | null>(null);

  const utils = api.useUtils();
  const queryInput = { ...buildFilterInput(filters), limit, offset };
  const { data, refetch } = api.infoCollect.admin.list.useQuery(queryInput);

  const { data: configData } = api.infoCollect.admin.getConfig.useQuery();
  const enabledFields = configData?.enabledFields ?? ['name', 'proofImage'];

  const reviewMutation = api.infoCollect.admin.review.useMutation({
    onSuccess: () => {
      toast.success('审核操作成功');
      setReviewModal(null);
      setReviewReason('');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const batchReviewMutation = api.infoCollect.admin.batchReview.useMutation({
    onSuccess: (res) => {
      toast.success(`已批量操作 ${res.count} 条记录`);
      setSelectedRowKeys([]);
      setBatchRejectModal(false);
      setBatchRejectReason('');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.infoCollect.admin.deleteRecord.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const trackingMutation = api.infoCollect.admin.updateTracking.useMutation({
    onSuccess: () => {
      toast.success('发货单号已更新');
      setTrackingModal(null);
      setTrackingNumber('');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const remarkMutation = api.infoCollect.admin.updateRemark.useMutation({
    onSuccess: () => {
      toast.success('备注已更新');
      setRemarkModal(null);
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const currentPage = Math.floor(offset / limit) + 1;

  function applyFilters(patch: Partial<Filters>) {
    setFilters((prev) => ({ ...prev, ...patch }));
    setOffset(0);
    setSelectedRowKeys([]);
  }

  function handleReviewConfirm() {
    if (!reviewModal) return;
    reviewMutation.mutate({
      id: reviewModal.id,
      status: reviewModal.action,
      rejectReason: reviewReason || undefined,
    });
  }

  function handleBatchApprove() {
    if (selectedRowKeys.length === 0) return;
    batchReviewMutation.mutate({ ids: selectedRowKeys, status: 'approved' });
  }

  function handleBatchRejectConfirm() {
    if (selectedRowKeys.length === 0) return;
    batchReviewMutation.mutate({
      ids: selectedRowKeys,
      status: 'rejected',
      rejectReason: batchRejectReason,
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const records = await utils.infoCollect.admin.exportData.fetch(
        buildFilterInput(filters),
      );
      const blob = toExcel(records, window.location.origin, enabledFields);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `信息采集记录_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      if (records.length >= 10000) {
        toast.warning('数据量超过 10000 条，已截断导出，请缩小筛选范围');
      } else {
        toast.success(`已导出 ${records.length} 条记录`);
      }
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  const columns: TableProps<RecordItem>['columns'] = [
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
      width: 100,
      render: (val: string | null) => val ?? '-',
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      key: 'phone',
      width: 130,
    },
    {
      title: '身份证号',
      dataIndex: 'idCard',
      key: 'idCard',
      width: 200,
    },
    {
      title: '在职证明',
      key: 'proof',
      width: 120,
      render: (_: unknown, record: RecordItem) =>
        record.proofImageUrl ? (
          <Image
            alt="在职证明"
            height={40}
            src={record.proofImageUrl}
            style={{ objectFit: 'cover', borderRadius: 4 }}
            width={40}
          />
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_, record) => (
        <Tag color={REVIEW_STATUS_COLORS[record.status] ?? 'default'}>
          {REVIEW_STATUS_LABELS[record.status] ?? record.status}
        </Tag>
      ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      key: 'remark',
      width: 150,
      ellipsis: true,
      render: (val: string | null, record: RecordItem) => (
        <Typography.Link
          onClick={() => setRemarkModal({ id: record.id, remark: val ?? '' })}
          style={{ fontSize: 13 }}
        >
          {val || '添加备注'}
        </Typography.Link>
      ),
    },
    {
      title: '提交时间',
      key: 'createdAt',
      width: 170,
      render: (_, record) => (
        <Typography.Text style={{ fontSize: 13 }}>
          {dayjs(record.createdAt).format('YYYY-MM-DD HH:mm:ss')}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space size="small" wrap>
          {record.status === 'pending' && (
            <>
              <Button
                onClick={() =>
                  setReviewModal({ id: record.id, action: 'approved' })
                }
                size="small"
                type="link"
              >
                通过
              </Button>
              <Button
                danger
                onClick={() =>
                  setReviewModal({ id: record.id, action: 'rejected' })
                }
                size="small"
                type="link"
              >
                拒绝
              </Button>
              <Button
                onClick={() =>
                  setReviewModal({
                    id: record.id,
                    action: 'needs_supplement',
                  })
                }
                size="small"
                type="link"
              >
                需补充
              </Button>
            </>
          )}
          {record.status === 'approved' && (
            <Button
              onClick={() => setTrackingModal(record.id)}
              size="small"
              type="link"
            >
              填写单号
            </Button>
          )}
          <Button
            danger
            onClick={() =>
              Modal.confirm({
                title: '确认删除',
                content: '确定删除这条记录？此操作不可撤销。',
                okText: '确认删除',
                okType: 'danger',
                cancelText: '取消',
                onOk: () => deleteMutation.mutate({ id: record.id }),
              })
            }
            size="small"
            type="link"
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Header />
      <main style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 24px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 24,
            }}
          >
            <Typography.Title level={4} style={{ margin: 0 }}>
              信息采集记录
            </Typography.Title>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ModuleSwitcher currentModuleId="info-collect" />
              <Link href="/admin/info-collect/config">
                <Button>采集配置</Button>
              </Link>
              <Button loading={exporting} onClick={handleExport}>
                {exporting ? '导出中...' : '导出 Excel'}
              </Button>
            </div>
          </div>

          {/* 筛选栏 */}
          <Card style={{ marginBottom: 16 }}>
            <Form layout="inline" style={{ rowGap: 8 }}>
              <Form.Item label="搜索">
                <Input.Search
                  allowClear
                  enterButton="搜索"
                  onChange={(e) => setSearchInput(e.target.value)}
                  onSearch={(v) => applyFilters({ search: v })}
                  placeholder="姓名 / 手机号"
                  style={{ width: 260 }}
                  value={searchInput}
                />
              </Form.Item>
              <Form.Item label="状态">
                <Select
                  allowClear
                  onChange={(v) => applyFilters({ status: v ?? '' })}
                  options={Object.entries(REVIEW_STATUS_LABELS).map(
                    ([k, v]) => ({ value: k, label: v }),
                  )}
                  placeholder="全部状态"
                  style={{ width: 120 }}
                  value={filters.status || undefined}
                />
              </Form.Item>
            </Form>
          </Card>

          {/* 批量操作 */}
          {selectedRowKeys.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '4px 0',
                }}
              >
                <Typography.Text strong>
                  已选 {selectedRowKeys.length} 条
                </Typography.Text>
                <Button
                  loading={batchReviewMutation.isPending}
                  onClick={handleBatchApprove}
                  size="small"
                  type="primary"
                >
                  批量通过
                </Button>
                <Button
                  danger
                  loading={batchReviewMutation.isPending}
                  onClick={() => setBatchRejectModal(true)}
                  size="small"
                >
                  批量拒绝
                </Button>
                <Button
                  onClick={() => setSelectedRowKeys([])}
                  size="small"
                  type="link"
                >
                  取消选择
                </Button>
              </div>
            </Card>
          )}

          {/* 数据表格 */}
          <Card>
            <Table<RecordItem>
              columns={columns}
              dataSource={data?.items ?? []}
              loading={!data}
              locale={{ emptyText: '暂无采集记录' }}
              pagination={{
                current: currentPage,
                pageSize: limit,
                total: data?.total ?? 0,
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page) => {
                  setOffset((page - 1) * limit);
                  setSelectedRowKeys([]);
                },
              }}
              rowKey="id"
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }}
              scroll={{ x: 1000 }}
            />
          </Card>
        </div>
      </main>

      {/* 审核弹窗 */}
      <Modal
        confirmLoading={reviewMutation.isPending}
        okButtonProps={{
          disabled: reviewModal?.action !== 'approved' && !reviewReason.trim(),
        }}
        onCancel={() => {
          setReviewModal(null);
          setReviewReason('');
        }}
        onOk={handleReviewConfirm}
        open={!!reviewModal}
        title={
          reviewModal?.action === 'approved'
            ? '确认通过'
            : reviewModal?.action === 'rejected'
              ? '确认拒绝'
              : '需补充资料'
        }
      >
        {reviewModal?.action !== 'approved' && (
          <Input.TextArea
            onChange={(e) => setReviewReason(e.target.value)}
            placeholder="请输入原因（必填）"
            rows={3}
            value={reviewReason}
          />
        )}
        {reviewModal?.action === 'approved' && (
          <p>确认通过该条记录？通过后状态将变为"待发货"。</p>
        )}
      </Modal>

      {/* 批量拒绝弹窗 */}
      <Modal
        confirmLoading={batchReviewMutation.isPending}
        okButtonProps={{ disabled: !batchRejectReason.trim() }}
        onCancel={() => {
          setBatchRejectModal(false);
          setBatchRejectReason('');
        }}
        onOk={handleBatchRejectConfirm}
        open={batchRejectModal}
        title="批量拒绝"
      >
        <Input.TextArea
          onChange={(e) => setBatchRejectReason(e.target.value)}
          placeholder="请输入拒绝原因（必填）"
          rows={3}
          value={batchRejectReason}
        />
      </Modal>

      {/* 发货单号弹窗 */}
      <Modal
        confirmLoading={trackingMutation.isPending}
        onCancel={() => {
          setTrackingModal(null);
          setTrackingNumber('');
        }}
        onOk={() => {
          if (!trackingModal || !trackingNumber.trim()) {
            toast.error('请填写发货单号');
            return;
          }
          trackingMutation.mutate({
            id: trackingModal,
            trackingNumber: trackingNumber.trim(),
          });
        }}
        open={!!trackingModal}
        title="填写发货单号"
      >
        <Input
          onChange={(e) => setTrackingNumber(e.target.value)}
          placeholder="请输入发货单号"
          value={trackingNumber}
        />
      </Modal>

      {/* 备注弹窗 */}
      <Modal
        confirmLoading={remarkMutation.isPending}
        onCancel={() => setRemarkModal(null)}
        onOk={() => {
          if (!remarkModal) return;
          remarkMutation.mutate({
            id: remarkModal.id,
            remark: remarkModal.remark.trim() || null,
          });
        }}
        open={!!remarkModal}
        title="编辑备注"
      >
        <Input.TextArea
          maxLength={500}
          onChange={(e) =>
            setRemarkModal((prev) =>
              prev ? { ...prev, remark: e.target.value } : null,
            )
          }
          placeholder="输入备注内容（可选）"
          rows={3}
          showCount
          value={remarkModal?.remark ?? ''}
        />
      </Modal>
    </>
  );
}
