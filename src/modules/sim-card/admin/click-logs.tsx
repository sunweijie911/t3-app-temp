'use client';

import { DownloadOutlined } from '@ant-design/icons';
import { Button, DatePicker, Input, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useState } from 'react';
import { toast } from 'sonner';
import XLSX from 'xlsx-js-style';

import { MODULE_NAME } from '@/modules/sim-card/constants';
import { api } from '@/trpc/react';

type ClickLogRow = {
  id: number;
  packageId: string;
  packageTitle: string;
  dingtalkUserid: string;
  userName: string | null;
  userPhone: string | null;
  department: string | null;
  jobNumber: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: Date;
};

export default function AdminSimCardClickLogsPage() {
  const [packageId, setPackageId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<
    [dayjs.Dayjs | null, dayjs.Dayjs | null] | null
  >(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // 获取套餐列表（用于筛选下拉）
  const { data: allPackages } = api.simCard.admin.list.useQuery();

  const { data, isLoading } = api.simCard.admin.clickLogs.useQuery({
    packageId,
    search: search || undefined,
    startDate: dateRange?.[0]?.startOf('day').toISOString(),
    endDate: dateRange?.[1]?.endOf('day').toISOString(),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const exportQuery = api.simCard.admin.exportClickLogs.useQuery(
    {
      packageId,
      search: search || undefined,
      startDate: dateRange?.[0]?.startOf('day').toISOString(),
      endDate: dateRange?.[1]?.endOf('day').toISOString(),
    },
    { enabled: false },
  );

  async function handleExport() {
    try {
      const result = await exportQuery.refetch();
      const rows = result.data;
      if (!rows || rows.length === 0) {
        toast.error('暂无数据可导出');
        return;
      }

      const headerStyle = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4472C4' } },
        alignment: { horizontal: 'center' as const },
      };

      const headers = [
        '姓名',
        '手机号',
        '工号',
        '部门',
        '套餐名称',
        '设备信息',
        'IP地址',
        '点击时间',
      ];

      const wsData = [
        headers.map((h) => ({ v: h, s: headerStyle })),
        ...rows.map((r) => [
          { v: r.userName ?? '' },
          { v: r.userPhone ?? '' },
          { v: r.jobNumber ?? '' },
          { v: r.department ?? '' },
          { v: r.packageTitle },
          { v: r.deviceInfo ?? '' },
          { v: r.ipAddress ?? '' },
          { v: dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss') },
        ]),
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [
        { wch: 10 },
        { wch: 14 },
        { wch: 12 },
        { wch: 20 },
        { wch: 25 },
        { wch: 25 },
        { wch: 16 },
        { wch: 20 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '点击记录');
      XLSX.writeFile(
        wb,
        `${MODULE_NAME}_点击记录_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`,
      );
      toast.success(`已导出 ${rows.length} 条记录`);
    } catch {
      toast.error('导出失败');
    }
  }

  const columns: ColumnsType<ClickLogRow> = [
    {
      title: '姓名',
      dataIndex: 'userName',
      key: 'userName',
      width: 80,
      render: (v: string | null) => v || '—',
    },
    {
      title: '手机号',
      dataIndex: 'userPhone',
      key: 'userPhone',
      width: 120,
    },
    {
      title: '工号',
      dataIndex: 'jobNumber',
      key: 'jobNumber',
      width: 90,
      render: (v: string | null) => v || '—',
    },
    {
      title: '部门',
      dataIndex: 'department',
      key: 'department',
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: '套餐名称',
      dataIndex: 'packageTitle',
      key: 'packageTitle',
      width: 180,
      ellipsis: true,
    },
    {
      title: '设备',
      dataIndex: 'deviceInfo',
      key: 'deviceInfo',
      width: 150,
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: 'IP',
      dataIndex: 'ipAddress',
      key: 'ipAddress',
      width: 120,
      render: (v: string | null) => v || '—',
    },
    {
      title: '点击时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: Date) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-bold text-2xl text-gray-900">
            {MODULE_NAME} - 办理点击记录
          </h1>
          <Button
            icon={<DownloadOutlined />}
            loading={exportQuery.isFetching}
            onClick={handleExport}
            type="primary"
          >
            导出 Excel
          </Button>
        </div>

        {/* 筛选条件 */}
        <div className="mb-4 rounded-xl bg-white p-4">
          <Space wrap>
            <Select
              allowClear
              onChange={(v) => {
                setPackageId(v);
                setPage(1);
              }}
              options={allPackages?.map((p) => ({
                label: `${p.carrier} - ${p.title}`,
                value: p.id,
              }))}
              placeholder="筛选套餐"
              style={{ width: 250 }}
              value={packageId}
            />
            <Input.Search
              allowClear
              onSearch={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="搜索姓名/手机/工号"
              style={{ width: 220 }}
            />
            <DatePicker.RangePicker
              format="YYYY-MM-DD"
              onChange={(range) => {
                setDateRange(range);
                setPage(1);
              }}
              value={dateRange}
            />
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={data?.rows as ClickLogRow[] | undefined}
          loading={isLoading}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            onChange: (p) => setPage(p),
            showTotal: (total) => `共 ${total} 条`,
          }}
          rowKey="id"
          scroll={{ x: 1100 }}
          style={{ background: '#fff', borderRadius: 12 }}
        />
      </div>
    </main>
  );
}
