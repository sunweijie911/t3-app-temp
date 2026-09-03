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
  Switch,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/trpc/react';
import {
  type BotPlatform,
  PLATFORM_LABELS,
  RESOURCE_KIND_LABELS,
} from '../constants';
import type { ResourceKind } from '../core/types';

type DisplayTypeOption = 'date' | 'number' | 'text';

type FetchedField = {
  fieldId: string;
  fieldName: string;
  uiType: string;
  suggestedType: 'plain' | 'link' | 'multiSelect';
  suggestedDisplayType: DisplayTypeOption;
};

type FieldPickerSelection = Record<
  string,
  {
    selected: boolean;
    type: 'plain' | 'link' | 'multiSelect';
    sensitive: boolean;
    /**
     * plain 列的取值语义。必须显式写进 fieldMapping：
     * 'text' 挡掉「文本列里的 2026-05-11 被写成时间戳」，
     * 'number' 挡掉「金额被按毫秒渲染成日期、区间查询走成日期段」，
     * 'date' 让 prompt 里带上日期格式提示。
     */
    displayType: DisplayTypeOption;
    linkTableId?: string;
    displayField?: string;
  }
>;

/** 字段名启发式：含密码/密钥/secret/token 等关键字时默认勾选 sensitive */
const SENSITIVE_KEY_PATTERN =
  /密码|密钥|秘钥|password|passwd|secret|token|api[_-]?key|凭证|敏感/i;

type BindingRow = {
  id: string;
  sceneId: string;
  alias: string;
  kind: ResourceKind;
  /** 数据所在平台，与消息来源平台无关 */
  provider: BotPlatform;
  workspaceId: string;
  resourceId: string;
  fieldMapping: unknown;
  uniqueKey: string | null;
  isDefault: boolean;
  isActive: boolean;
};

type EditingBinding = {
  id?: string;
  sceneId: string;
  alias: string;
  kind: ResourceKind;
  provider: BotPlatform;
  workspaceId: string;
  resourceId: string;
  fieldMappingStr: string;
  uniqueKey: string;
  isDefault: boolean;
};

export default function ImBotResourceBindingsPage() {
  const { data: bindings, refetch } =
    api.imBot.admin.listResourceBindings.useQuery();
  const { data: scenes } = api.imBot.admin.listScenes.useQuery();
  const [editing, setEditing] = useState<EditingBinding | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFields, setPickerFields] = useState<FetchedField[]>([]);
  const [pickerSelection, setPickerSelection] = useState<FieldPickerSelection>(
    {},
  );

  /**
   * 更新某个字段的勾选项。缺省值统一取拉取时的建议类型 ——
   * 原先每列各自展开旧值再补字段，加一个必填项就要改五处。
   */
  const patchSelection = (
    f: FetchedField,
    patch: Partial<FieldPickerSelection[string]>,
  ) => {
    setPickerSelection((prev) => {
      const cur = prev[f.fieldName];
      return {
        ...prev,
        [f.fieldName]: {
          selected: cur?.selected ?? true,
          type: cur?.type ?? f.suggestedType,
          sensitive: cur?.sensitive ?? false,
          displayType: cur?.displayType ?? f.suggestedDisplayType,
          linkTableId: cur?.linkTableId,
          displayField: cur?.displayField,
          ...patch,
        },
      };
    });
  };
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
          displayType: f.suggestedDisplayType,
        };
      }
      setPickerSelection(init);
      setPickerOpen(true);
    },
    onError: (err) => toast.error(`拉取字段失败：${err.message}`),
  });

  const upsertMutation = api.imBot.admin.upsertResourceBinding.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.imBot.admin.deleteResourceBinding.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const columns: ColumnsType<BindingRow> = [
    { title: '场景', dataIndex: 'sceneId', width: 120 },
    {
      title: '资源别名',
      dataIndex: 'alias',
      width: 130,
      render: (val: string, record: BindingRow) => (
        <Space size={4}>
          <span>{val}</span>
          {record.isDefault && <Tag color="green">默认</Tag>}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 110,
      render: (val: ResourceKind) => <Tag>{RESOURCE_KIND_LABELS[val]}</Tag>,
    },
    {
      title: '数据平台',
      dataIndex: 'provider',
      width: 100,
      render: (val: BotPlatform) => (
        <Tag color="blue">{PLATFORM_LABELS[val]}</Tag>
      ),
    },
    { title: 'Workspace ID', dataIndex: 'workspaceId', ellipsis: true },
    { title: '资源 ID', dataIndex: 'resourceId', ellipsis: true },
    {
      title: '字段映射',
      dataIndex: 'fieldMapping',
      ellipsis: true,
      render: (val: unknown) => {
        const obj = (val ?? {}) as Record<string, unknown>;
        return Object.entries(obj).map(([k, v]) => {
          const display =
            v !== null && typeof v === 'object' && 'name' in v
              ? `${(v as { name: string }).name} [${(v as { type?: string }).type ?? ''}]`
              : String(v ?? '');
          return (
            <Tag key={k}>
              {k} → {display}
            </Tag>
          );
        });
      },
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, record: BindingRow) => (
        <Space size="small">
          <Button
            onClick={() =>
              setEditing({
                id: record.id,
                sceneId: record.sceneId,
                alias: record.alias,
                kind: record.kind,
                provider: record.provider,
                workspaceId: record.workspaceId,
                resourceId: record.resourceId,
                fieldMappingStr: JSON.stringify(
                  record.fieldMapping ?? {},
                  null,
                  2,
                ),
                uniqueKey: record.uniqueKey ?? '',
                isDefault: record.isDefault,
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
          <h1 className="font-bold text-2xl text-gray-900">资源绑定</h1>
          <Button
            onClick={() =>
              setEditing({
                sceneId: '',
                alias: '',
                kind: 'table',
                provider: 'feishu',
                workspaceId: '',
                resourceId: '',
                fieldMappingStr: '{}',
                uniqueKey: '',
                isDefault: true,
              })
            }
            type="primary"
          >
            新增绑定
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={bindings ?? []}
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
              alias: editing.alias,
              kind: editing.kind,
              provider: editing.provider,
              workspaceId: editing.workspaceId,
              resourceId: editing.resourceId,
              fieldMapping,
              uniqueKey: editing.uniqueKey || undefined,
              isDefault: editing.isDefault,
            });
          }}
          open={!!editing}
          title={editing?.id ? '编辑绑定' : '新增绑定'}
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
              <Form.Item
                label="资源别名"
                required
                tooltip="场景内唯一的资源名，如「项目台账表」。一个场景可以绑多个资源，靠别名区分"
              >
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, alias: e.target.value })
                  }
                  placeholder="如：项目台账表"
                  value={editing.alias}
                />
              </Form.Item>
              <Form.Item label="资源类型" required>
                <Select
                  onChange={(val) =>
                    setEditing({
                      ...editing,
                      kind: val,
                      // 只有飞书实现了文档能力，切过去时顺带纠正平台，
                      // 免得留下一个存得下、跑不通的组合
                      provider: val === 'doc' ? 'feishu' : editing.provider,
                    })
                  }
                  options={[
                    { value: 'table', label: '多维表格' },
                    { value: 'doc', label: '文档' },
                    { value: 'file', label: '文件 (未实现)', disabled: true },
                  ]}
                  value={editing.kind}
                />
              </Form.Item>
              <Form.Item
                label="数据所在平台"
                required
                tooltip="数据存在哪个平台，与消息来自哪个 IM 无关 —— 可以在企微群里操作飞书多维表"
              >
                <Select
                  onChange={(val) => setEditing({ ...editing, provider: val })}
                  options={[
                    { value: 'feishu', label: '飞书' },
                    {
                      value: 'wecom',
                      label: '企业微信',
                      disabled: editing.kind === 'doc',
                    },
                    {
                      value: 'dingtalk',
                      label: '钉钉',
                      disabled: editing.kind === 'doc',
                    },
                  ]}
                  value={editing.provider}
                />
              </Form.Item>
              <Form.Item
                label="设为场景默认资源"
                tooltip="未在指令中指定资源时使用这一条。同场景内只会保留一条默认"
              >
                <Switch
                  checked={editing.isDefault}
                  onChange={(val) => setEditing({ ...editing, isDefault: val })}
                />
              </Form.Item>
              <Form.Item
                label={
                  editing.kind === 'doc'
                    ? 'Workspace ID (飞书 folder_token，可留空)'
                    : editing.provider === 'wecom'
                      ? 'Workspace ID (企微智能表格 docid)'
                      : editing.provider === 'dingtalk'
                        ? 'Workspace ID (钉钉多维表 baseId)'
                        : 'Workspace ID (飞书 app_token)'
                }
                required
              >
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, workspaceId: e.target.value })
                  }
                  value={editing.workspaceId}
                />
              </Form.Item>
              <Form.Item label="资源 ID (飞书多维表 table_id)" required>
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, resourceId: e.target.value })
                  }
                  value={editing.resourceId}
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
                label="字段映射 (JSON: 逻辑字段 → 平台字段)"
                required
                tooltip="普通字段值用字符串。Link 字段值用对象，声明 type/linkTableId/displayField 后可用显示值（如学校名）查询/写入。multiSelect 字段须用 {type:'multiSelect'} 让查询自动用 contains。敏感字段加 sensitive:true 在群消息中脱敏"
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    marginBottom: 4,
                  }}
                >
                  <Button
                    disabled={
                      !editing.workspaceId ||
                      !editing.resourceId ||
                      editing.provider !== 'feishu'
                    }
                    loading={fetchFields.isPending}
                    onClick={() =>
                      fetchFields.mutate({
                        workspaceId: editing.workspaceId,
                        tableId: editing.resourceId,
                      })
                    }
                    size="small"
                  >
                    从飞书拉取字段…
                  </Button>
                </div>
                <Input.TextArea
                  onChange={(e) =>
                    setEditing({ ...editing, fieldMappingStr: e.target.value })
                  }
                  placeholder={`{
  "项目名称": { "name": "项目名称", "type": "plain", "displayType": "text" },
  "上线日期": { "name": "上线日期", "type": "plain", "displayType": "date" },
  "预算": { "name": "预算", "type": "plain", "displayType": "number" },
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
              if (sel.type === 'plain') {
                // plain 一律写成对象并带上 displayType。
                // 以前无敏感标记时输出裸字符串，displayType 无处可放 ——
                // 于是日期/数字/文本三种语义在运行时只能靠值猜，
                // 文本列里的 "2026-05-11" 会被当日期写成时间戳。
                result[f.fieldName] = {
                  name: f.fieldName,
                  type: 'plain',
                  displayType: sel.displayType,
                  ...(sel.sensitive ? { sensitive: true } : {}),
                };
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
                      patchSelection(f, { selected: e.target.checked })
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
                    onChange={(val) => patchSelection(f, { type: val })}
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
                title: '取值语义',
                width: 120,
                render: (_, f: FetchedField) => {
                  const sel = pickerSelection[f.fieldName];
                  const type = sel?.type ?? f.suggestedType;
                  if (type !== 'plain') {
                    return <span style={{ color: '#bbb' }}>—</span>;
                  }
                  return (
                    <Select
                      onChange={(val: DisplayTypeOption) =>
                        patchSelection(f, { displayType: val })
                      }
                      options={[
                        { value: 'text', label: '文本' },
                        { value: 'number', label: '数字' },
                        { value: 'date', label: '日期' },
                      ]}
                      size="small"
                      style={{ width: '100%' }}
                      value={sel?.displayType ?? f.suggestedDisplayType}
                    />
                  );
                },
              },
              {
                title: 'link 子表 ID',
                width: 160,
                render: (_, f: FetchedField) =>
                  pickerSelection[f.fieldName]?.type === 'link' ? (
                    <Input
                      onChange={(e) =>
                        patchSelection(f, { linkTableId: e.target.value })
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
                        patchSelection(f, { displayField: e.target.value })
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
                      patchSelection(f, { sensitive: e.target.checked })
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
