'use client';

import {
  Button,
  Checkbox,
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

type FetchedField = {
  fieldId: string;
  fieldName: string;
  uiType: string;
  suggestedType: 'plain' | 'link' | 'multiSelect';
};

type FieldPickerSelection = Record<
  string,
  {
    selected: boolean;
    type: 'plain' | 'link' | 'multiSelect';
    sensitive: boolean;
    linkTableId?: string;
    displayField?: string;
  }
>;

/** 字段名启发式：含密码/密钥/secret/token 等关键字时默认勾选 sensitive */
const SENSITIVE_KEY_PATTERN =
  /密码|密钥|秘钥|password|passwd|secret|token|api[_-]?key|凭证|敏感/i;

type MappingRow = {
  id: string;
  sceneId: string;
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMapping: unknown;
  uniqueKey: string | null;
  isActive: boolean;
};

type EditingMapping = {
  id?: string;
  sceneId: string;
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMappingStr: string;
  uniqueKey: string;
};

export default function ImBotTableMappingsPage() {
  const { data: mappings, refetch } =
    api.imBot.admin.listTableMappings.useQuery();
  const { data: scenes } = api.imBot.admin.listScenes.useQuery();
  const [editing, setEditing] = useState<EditingMapping | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFields, setPickerFields] = useState<FetchedField[]>([]);
  const [pickerSelection, setPickerSelection] = useState<FieldPickerSelection>(
    {},
  );
  const fetchFields = api.imBot.admin.fetchBitableFields.useMutation({
    onSuccess: (fields) => {
      setPickerFields(fields);
      // 预填：所有字段默认勾选；按 suggestedType 设置；敏感关键字自动 sensitive
      const init: FieldPickerSelection = {};
      for (const f of fields) {
        init[f.fieldName] = {
          selected: true,
          type: f.suggestedType,
          sensitive: SENSITIVE_KEY_PATTERN.test(f.fieldName),
        };
      }
      setPickerSelection(init);
      setPickerOpen(true);
    },
    onError: (err) => toast.error(`拉取字段失败：${err.message}`),
  });

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
                uniqueKey: record.uniqueKey ?? '',
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
                uniqueKey: '',
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
            // 解析后由后端 zod 严格校验 string | LinkFieldMapping
            type FieldMappingInput = Parameters<
              typeof upsertMutation.mutate
            >[0]['fieldMapping'];
            let fieldMapping: FieldMappingInput = {};
            try {
              fieldMapping = JSON.parse(
                editing.fieldMappingStr,
              ) as FieldMappingInput;
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
              uniqueKey: editing.uniqueKey || undefined,
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
              <Form.Item
                label="唯一键字段（可选）"
                tooltip="逻辑字段名（如「项目名称」）。配置后，CREATE 前会按此键查重，命中已有记录时让用户选择「确认更新」「强制新建」或「取消」，避免重复录入"
              >
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, uniqueKey: e.target.value })
                  }
                  placeholder="如：项目名称（留空则不查重）"
                  value={editing.uniqueKey}
                />
              </Form.Item>
              <Form.Item
                label={
                  <Space>
                    <span>字段映射 (JSON: 逻辑字段 → 平台字段)</span>
                    <Button
                      disabled={
                        !editing.workspaceId ||
                        !editing.tableId ||
                        editing.platform !== 'feishu'
                      }
                      loading={fetchFields.isPending}
                      onClick={() =>
                        fetchFields.mutate({
                          workspaceId: editing.workspaceId,
                          tableId: editing.tableId,
                        })
                      }
                      size="small"
                    >
                      从飞书拉取字段…
                    </Button>
                  </Space>
                }
                required
                tooltip="普通字段值用字符串。Link 字段值用对象，声明 type/linkTableId/displayField 后可用显示值（如学校名）查询/写入。multiSelect 字段须用 {type:'multiSelect'} 让查询自动用 contains。敏感字段加 sensitive:true 在群消息中脱敏"
              >
                <Input.TextArea
                  onChange={(e) =>
                    setEditing({ ...editing, fieldMappingStr: e.target.value })
                  }
                  placeholder={`{
  "项目名称": "项目名称",
  "业务域": { "name": "业务域", "type": "multiSelect" },
  "部署学校": {
    "name": "部署学校",
    "type": "link",
    "linkTableId": "tblJsAbNRp7JpZeH",
    "displayField": "学校名"
  },
  "登录密码": { "name": "登录密码", "type": "plain", "sensitive": true }
}`}
                  rows={10}
                  value={editing.fieldMappingStr}
                />
              </Form.Item>
            </Form>
          )}
        </Modal>

        <Modal
          okText="生成 JSON"
          onCancel={() => setPickerOpen(false)}
          onOk={() => {
            if (!editing) return;
            const result: Record<string, unknown> = {};
            for (const f of pickerFields) {
              const sel = pickerSelection[f.fieldName];
              if (!sel?.selected) continue;
              if (sel.type === 'plain' && !sel.sensitive) {
                // 简单字段且无敏感标记 → 直接字符串映射
                result[f.fieldName] = f.fieldName;
                continue;
              }
              if (sel.type === 'link') {
                if (!sel.linkTableId || !sel.displayField) {
                  toast.error(
                    `字段「${f.fieldName}」是 link 类型，必须填写 linkTableId 和 displayField`,
                  );
                  return;
                }
                result[f.fieldName] = {
                  name: f.fieldName,
                  type: 'link',
                  linkTableId: sel.linkTableId,
                  displayField: sel.displayField,
                  ...(sel.sensitive ? { sensitive: true } : {}),
                };
                continue;
              }
              result[f.fieldName] = {
                name: f.fieldName,
                type: sel.type,
                ...(sel.sensitive ? { sensitive: true } : {}),
              };
            }
            setEditing({
              ...editing,
              fieldMappingStr: JSON.stringify(result, null, 2),
            });
            setPickerOpen(false);
          }}
          open={pickerOpen}
          title="勾选要纳入机器人管理的字段"
          width={840}
        >
          <p style={{ color: '#888', marginBottom: 8 }}>
            敏感字段建议保持「不勾选」。已勾选的敏感字段会在群消息回复中自动脱敏。
          </p>
          <Table
            columns={[
              {
                title: '纳入',
                width: 60,
                render: (_, f: FetchedField) => (
                  <Checkbox
                    checked={pickerSelection[f.fieldName]?.selected ?? false}
                    onChange={(e) =>
                      setPickerSelection({
                        ...pickerSelection,
                        [f.fieldName]: {
                          ...(pickerSelection[f.fieldName] ?? {
                            type: f.suggestedType,
                            sensitive: false,
                          }),
                          selected: e.target.checked,
                          type:
                            pickerSelection[f.fieldName]?.type ??
                            f.suggestedType,
                          sensitive:
                            pickerSelection[f.fieldName]?.sensitive ?? false,
                        },
                      })
                    }
                  />
                ),
              },
              { title: '字段名', dataIndex: 'fieldName', width: 180 },
              {
                title: 'UI 类型',
                dataIndex: 'uiType',
                width: 110,
                render: (v: string) => <Tag>{v || '—'}</Tag>,
              },
              {
                title: '映射类型',
                width: 130,
                render: (_, f: FetchedField) => (
                  <Select
                    onChange={(val) =>
                      setPickerSelection({
                        ...pickerSelection,
                        [f.fieldName]: {
                          ...(pickerSelection[f.fieldName] ?? {
                            selected: true,
                            sensitive: false,
                          }),
                          selected:
                            pickerSelection[f.fieldName]?.selected ?? true,
                          sensitive:
                            pickerSelection[f.fieldName]?.sensitive ?? false,
                          type: val,
                        },
                      })
                    }
                    options={[
                      { value: 'plain', label: 'plain' },
                      { value: 'link', label: 'link' },
                      { value: 'multiSelect', label: 'multiSelect' },
                    ]}
                    size="small"
                    style={{ width: '100%' }}
                    value={
                      pickerSelection[f.fieldName]?.type ?? f.suggestedType
                    }
                  />
                ),
              },
              {
                title: 'link 子表 ID',
                width: 160,
                render: (_, f: FetchedField) =>
                  pickerSelection[f.fieldName]?.type === 'link' ? (
                    <Input
                      onChange={(e) =>
                        setPickerSelection({
                          ...pickerSelection,
                          [f.fieldName]: {
                            ...(pickerSelection[f.fieldName] ?? {
                              selected: true,
                              type: 'link',
                              sensitive: false,
                            }),
                            linkTableId: e.target.value,
                          },
                        })
                      }
                      placeholder="tblXXX"
                      size="small"
                      value={pickerSelection[f.fieldName]?.linkTableId ?? ''}
                    />
                  ) : (
                    <span style={{ color: '#bbb' }}>—</span>
                  ),
              },
              {
                title: '显示字段',
                width: 130,
                render: (_, f: FetchedField) =>
                  pickerSelection[f.fieldName]?.type === 'link' ? (
                    <Input
                      onChange={(e) =>
                        setPickerSelection({
                          ...pickerSelection,
                          [f.fieldName]: {
                            ...(pickerSelection[f.fieldName] ?? {
                              selected: true,
                              type: 'link',
                              sensitive: false,
                            }),
                            displayField: e.target.value,
                          },
                        })
                      }
                      placeholder="如：学校名"
                      size="small"
                      value={pickerSelection[f.fieldName]?.displayField ?? ''}
                    />
                  ) : (
                    <span style={{ color: '#bbb' }}>—</span>
                  ),
              },
              {
                title: '敏感(脱敏)',
                width: 90,
                render: (_, f: FetchedField) => (
                  <Checkbox
                    checked={pickerSelection[f.fieldName]?.sensitive ?? false}
                    onChange={(e) =>
                      setPickerSelection({
                        ...pickerSelection,
                        [f.fieldName]: {
                          ...(pickerSelection[f.fieldName] ?? {
                            selected: true,
                            type: f.suggestedType,
                          }),
                          selected:
                            pickerSelection[f.fieldName]?.selected ?? true,
                          type:
                            pickerSelection[f.fieldName]?.type ??
                            f.suggestedType,
                          sensitive: e.target.checked,
                        },
                      })
                    }
                  />
                ),
              },
            ]}
            dataSource={pickerFields}
            pagination={false}
            rowKey="fieldId"
            scroll={{ y: 480 }}
            size="small"
          />
        </Modal>
      </div>
    </main>
  );
}
