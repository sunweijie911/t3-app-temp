'use client';

import {
  Button,
  Card,
  DatePicker,
  Modal,
  Popover,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useState } from 'react';
import { toast } from 'sonner';
import XLSX from 'xlsx-js-style';
import { api } from '@/trpc/react';
import { type BotPlatform, PLATFORM_LABELS } from '../constants';

const { RangePicker } = DatePicker;

type LogRow = {
  id: number;
  platform: BotPlatform;
  eventId: string;
  chatName?: string | null;
  senderName?: string | null;
  content?: string | null;
  sceneId?: string | null;
  intent?: string | null;
  result: 'success' | 'error' | 'ignored' | 'pending';
  /** 请求与结果摘要（解析出的筛选键/操作符、影响的记录数与 recordId…） */
  resultData?: unknown;
  errorMsg?: string | null;
  costMs?: number | null;
  createdAt: Date;
};

const RESULT_COLORS = {
  success: 'green',
  error: 'red',
  ignored: 'default',
  // 等用户确认，不是失败 —— 用橙色区别于 error 的红色
  pending: 'orange',
} as const;
const RESULT_LABELS = {
  success: '成功',
  error: '失败',
  ignored: '忽略',
  pending: '待确认',
} as const;

function toExcel(records: LogRow[]): Blob {
  const headers = [
    '时间',
    '平台',
    '发送者',
    '消息内容',
    '场景',
    '意图',
    '结果',
    '耗时(ms)',
    '错误信息',
  ];
  const colWidths = [20, 10, 14, 40, 12, 10, 8, 10, 40];
  const rows = records.map((r) => [
    dayjs(r.createdAt).format('YYYY-MM-DD HH:mm:ss'),
    PLATFORM_LABELS[r.platform],
    r.senderName ?? '',
    r.content ?? '',
    r.sceneId ?? '',
    r.intent ?? '',
    RESULT_LABELS[r.result] ?? r.result,
    r.costMs ?? '',
    r.errorMsg ?? '',
  ]);

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

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '事件日志');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export default function ImBotEventLogsPage() {
  const [filters, setFilters] = useState<{
    platform?: BotPlatform;
    sceneId?: string;
    result?: 'success' | 'error' | 'ignored' | 'pending';
    startDate?: string;
    endDate?: string;
  }>({});
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const pageSize = 20;

  const [purgeDate, setPurgeDate] = useState<dayjs.Dayjs | null>(null);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);

  const utils = api.useUtils();
  const { data: stats } = api.imBot.admin.getStats.useQuery();
  const { data: logStats } = api.imBot.admin.getEventLogStats.useQuery();
  const { data: logs, isLoading } = api.imBot.admin.listEventLogs.useQuery({
    ...filters,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  async function handleExport() {
    setExporting(true);
    try {
      const data = await utils.imBot.admin.listEventLogs.fetch({
        ...filters,
        limit: 10000,
        offset: 0,
      });
      const blob = toExcel(data.items as LogRow[]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().slice(0, 10);
      a.download = `IM_Bot事件日志_${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${data.items.length} 条记录`);
    } catch {
      toast.error('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  const purgeMutation = api.imBot.admin.purgeEventLogs.useMutation({
    onSuccess: (data) => {
      toast.success(`已清除 ${data.deleted} 条日志`);
      setPurgeModalOpen(false);
      setPurgeDate(null);
      void refetch();
      void utils.imBot.admin.getEventLogStats.invalidate();
      void utils.imBot.admin.getStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const refetch = utils.imBot.admin.listEventLogs.invalidate;

  const columns: ColumnsType<LogRow> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (val: Date) => dayjs(val).format('MM-DD HH:mm:ss'),
    },
    {
      title: '平台',
      dataIndex: 'platform',
      width: 80,
      render: (val: BotPlatform) => PLATFORM_LABELS[val],
    },
    { title: '发送者', dataIndex: 'senderName', width: 100 },
    { title: '消息', dataIndex: 'content', ellipsis: true },
    { title: '场景', dataIndex: 'sceneId', width: 100 },
    { title: '意图', dataIndex: 'intent', width: 80 },
    {
      title: '结果',
      dataIndex: 'result',
      width: 80,
      render: (val: keyof typeof RESULT_COLORS) => (
        <Tag color={RESULT_COLORS[val]}>{RESULT_LABELS[val]}</Tag>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'costMs',
      width: 80,
      render: (val: number | null) => (val != null ? `${val}ms` : '-'),
    },
    {
      title: '错误',
      dataIndex: 'errorMsg',
      ellipsis: true,
      width: 200,
    },
    {
      // 排障最有用的一列：解析出的筛选键/操作符、置信度、影响了哪些记录。
      // 以前只落库不展示，只能连数据库才看得到
      title: '详情',
      dataIndex: 'resultData',
      width: 90,
      render: (val: unknown) =>
        val == null ? (
          '-'
        ) : (
          <Popover
            content={
              <pre
                style={{
                  margin: 0,
                  maxWidth: 560,
                  maxHeight: 420,
                  overflow: 'auto',
                  fontSize: 12,
                }}
              >
                {JSON.stringify(val, null, 2)}
              </pre>
            }
            title="请求与结果摘要"
            trigger="click"
          >
            <Button size="small" type="link">
              查看
            </Button>
          </Popover>
        ),
    },
  ];

  const todayStats = stats?.today ?? {
    total: 0,
    success: 0,
    error: 0,
    pending: 0,
    avgCostMs: 0,
  };
  // 分母排除待确认：二次确认是破坏性操作的设计正路、还等着用户回复，
  // 把它算进分母等于每次 DELETE 都拉低成功率 —— 当初把 pending 从 error
  // 里拆出来就是为了这个，只拆了存储侧没拆展示侧等于没拆
  const ratedTotal = todayStats.total - todayStats.pending;
  const successRate =
    ratedTotal > 0 ? Math.round((todayStats.success / ratedTotal) * 100) : 0;

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-bold text-2xl text-gray-900">事件日志</h1>
          <Space>
            <Button danger onClick={() => setPurgeModalOpen(true)}>
              清理日志
            </Button>
            <Button loading={exporting} onClick={handleExport}>
              {exporting ? '导出中...' : '导出 Excel'}
            </Button>
          </Space>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-4">
          <Card size="small">
            <Statistic title="今日消息" value={todayStats.total} />
          </Card>
          <Card size="small">
            <Statistic suffix="%" title="成功率" value={successRate} />
            <div className="text-gray-400 text-xs">不计待确认</div>
          </Card>
          <Card size="small">
            <Statistic
              title="待确认"
              value={todayStats.pending}
              valueStyle={{
                color: todayStats.pending > 0 ? '#d46b08' : undefined,
              }}
            />
          </Card>
          <Card size="small">
            <Statistic
              suffix="ms"
              title="平均耗时"
              value={todayStats.avgCostMs}
            />
          </Card>
        </div>

        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            allowClear
            onChange={(val) => {
              setFilters({ ...filters, platform: val });
              setPage(1);
            }}
            options={[
              { value: 'feishu', label: '飞书' },
              { value: 'dingtalk', label: '钉钉' },
              { value: 'wecom', label: '企微' },
            ]}
            placeholder="平台"
            style={{ width: 120 }}
            value={filters.platform}
          />
          <Select
            allowClear
            onChange={(val) => {
              setFilters({ ...filters, result: val });
              setPage(1);
            }}
            options={[
              { value: 'success', label: '成功' },
              { value: 'error', label: '失败' },
              { value: 'pending', label: '待确认' },
              { value: 'ignored', label: '忽略' },
            ]}
            placeholder="结果"
            style={{ width: 120 }}
            value={filters.result}
          />
          <RangePicker
            onChange={(dates) => {
              setFilters({
                ...filters,
                startDate: dates?.[0]?.toISOString(),
                endDate: dates?.[1]?.toISOString(),
              });
              setPage(1);
            }}
          />
        </Space>

        <Table
          columns={columns}
          dataSource={logs?.items ?? []}
          loading={isLoading}
          pagination={{
            current: page,
            pageSize,
            total: logs?.total ?? 0,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 条`,
          }}
          rowKey="id"
          size="small"
        />

        <Modal
          confirmLoading={purgeMutation.isPending}
          okButtonProps={{ danger: true, disabled: !purgeDate }}
          okText="确认清除"
          onCancel={() => {
            setPurgeModalOpen(false);
            setPurgeDate(null);
          }}
          onOk={() => {
            if (!purgeDate) return;
            purgeMutation.mutate({
              beforeDate: purgeDate.endOf('day').toISOString(),
            });
          }}
          open={purgeModalOpen}
          title="清理事件日志"
        >
          <div style={{ marginBottom: 16 }}>
            <Typography.Text type="secondary">
              当前共 {logStats?.total ?? 0} 条日志
              {logStats?.earliestDate && (
                <>
                  ，最早记录：
                  {dayjs(logStats.earliestDate).format('YYYY-MM-DD')}
                </>
              )}
            </Typography.Text>
          </div>
          <div>
            <Typography.Text>清除此日期之前的所有日志：</Typography.Text>
            <DatePicker
              onChange={setPurgeDate}
              style={{ display: 'block', marginTop: 8 }}
              value={purgeDate}
            />
          </div>
        </Modal>
      </div>
    </main>
  );
}
