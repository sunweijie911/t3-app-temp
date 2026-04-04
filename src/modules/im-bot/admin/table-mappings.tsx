'use client';

import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/trpc/react';
import { type BotPlatform, PLATFORM_LABELS } from '../constants';

type MappingRow = {
  id: string;
  sceneId: string;
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMapping: unknown;
  isActive: boolean;
};

type EditingMapping = {
  id?: string;
  sceneId: string;
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMappingStr: string;
};

export default function ImBotTableMappingsPage() {
  const { data: mappings, refetch } =
    api.imBot.admin.listTableMappings.useQuery();
  const { data: scenes } = api.imBot.admin.listScenes.useQuery();
  const [editing, setEditing] = useState<EditingMapping | null>(null);

  const upsertMutation = api.imBot.admin.upsertTableMapping.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.imBot.admin.deleteTableMapping.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const columns: ColumnsType<MappingRow> = [
    { title: '场景', dataIndex: 'sceneId', width: 120 },
    {
      title: '平台',
      dataIndex: 'platform',
      width: 100,
      render: (val: BotPlatform) => (
        <Tag color="blue">{PLATFORM_LABELS[val]}</Tag>
      ),
    },
    { title: 'Workspace ID', dataIndex: 'workspaceId', ellipsis: true },
    { title: 'Table ID', dataIndex: 'tableId', ellipsis: true },
    {
      title: '字段映射',
      dataIndex: 'fieldMapping',
      ellipsis: true,
      render: (val: unknown) => {
        const obj = (val ?? {}) as Record<string, string>;
        return Object.entries(obj).map(([k, v]) => (
          <Tag key={k}>
            {k} → {v}
          </Tag>
        ));
      },
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, record: MappingRow) => (
        <Space size="small">
          <Button
            onClick={() =>
              setEditing({
                id: record.id,
                sceneId: record.sceneId,
                platform: record.platform,
                workspaceId: record.workspaceId,
                tableId: record.tableId,
                fieldMappingStr: JSON.stringify(
                  record.fieldMapping ?? {},
                  null,
                  2,
                ),
              })
            }
            size="small"
            type="link"
          >
            编辑
          </Button>
          <Popconfirm
            onConfirm={() => deleteMutation.mutate({ id: record.id })}
            title="确认删除?"
          >
            <Button danger size="small" type="link">
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div
          style={{
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <h1 className="font-bold text-2xl text-gray-900">表格映射</h1>
          <Button
            onClick={() =>
              setEditing({
                sceneId: '',
                platform: 'feishu',
                workspaceId: '',
                tableId: '',
                fieldMappingStr: '{}',
              })
            }
            type="primary"
          >
            新增映射
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={mappings ?? []}
          pagination={false}
          rowKey="id"
          size="small"
        />

        <Modal
          confirmLoading={upsertMutation.isPending}
          onCancel={() => setEditing(null)}
          onOk={() => {
            if (!editing) return;
            let fieldMapping: Record<string, string> = {};
            try {
              fieldMapping = JSON.parse(editing.fieldMappingStr);
            } catch {
              toast.error('字段映射 JSON 格式错误');
              return;
            }
            upsertMutation.mutate({
              id: editing.id,
              sceneId: editing.sceneId,
              platform: editing.platform,
              workspaceId: editing.workspaceId,
              tableId: editing.tableId,
              fieldMapping,
            });
          }}
          open={!!editing}
          title={editing?.id ? '编辑映射' : '新增映射'}
          width={640}
        >
          {editing && (
            <Form layout="vertical">
              <Form.Item label="场景" required>
                <Select
                  onChange={(val) => setEditing({ ...editing, sceneId: val })}
                  options={(scenes ?? []).map((s) => ({
                    value: s.sceneId,
                    label: s.name,
                  }))}
                  placeholder="选择场景"
                  value={editing.sceneId || undefined}
                />
              </Form.Item>
              <Form.Item label="平台" required>
                <Select
                  onChange={(val) => setEditing({ ...editing, platform: val })}
                  options={[
                    { value: 'feishu', label: '飞书' },
                    { value: 'dingtalk', label: '钉钉 (TODO)', disabled: true },
                    { value: 'wecom', label: '企微 (TODO)', disabled: true },
                  ]}
                  value={editing.platform}
                />
              </Form.Item>
              <Form.Item label="Workspace ID (飞书 app_token)" required>
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, workspaceId: e.target.value })
                  }
                  value={editing.workspaceId}
                />
              </Form.Item>
              <Form.Item label="Table ID" required>
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, tableId: e.target.value })
                  }
                  value={editing.tableId}
                />
              </Form.Item>
              <Form.Item label="字段映射 (JSON: 逻辑字段 → 平台字段)" required>
                <Input.TextArea
                  onChange={(e) =>
                    setEditing({ ...editing, fieldMappingStr: e.target.value })
                  }
                  placeholder='{"product": "商品名称", "cost": "成本", "price": "售价"}'
                  rows={6}
                  value={editing.fieldMappingStr}
                />
              </Form.Item>
            </Form>
          )}
        </Modal>
      </div>
    </main>
  );
}
