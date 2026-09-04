'use client';

import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
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

/** checkResourceBindingDrift 返回的一行 */
type DriftRow = {
  id: string;
  sceneId: string;
  alias: string;
  skipped: string | null;
  missingOnPlatform: Array<{ logicalKey: string; platformName: string }>;
  newOnPlatform: string[];
  staleOptions: Array<{ logicalKey: string; stored: string[]; live: string[] }>;
};

type FetchedField = {
  fieldId: string;
  fieldName: string;
  uiType: string;
  suggestedType: 'plain' | 'link' | 'multiSelect';
  suggestedDisplayType: DisplayTypeOption;
  /** 平台侧拉回来的合法取值（单选/多选列才有） */
  options?: string[] | null;
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
    /**
     * 主标识：候选列表 / 删除确认 / 查询投影优先展示它。
     * 全表只能有一个。必须显式选，不能靠"第一列" —— fieldMapping 存 jsonb，
     * 键序会被 Postgres 重排。
     */
    primary: boolean;
    /**
     * 群消息里展示用的友好名。平台侧没有这个概念，纯粹是人工配的 ——
     * 所以重新拉取字段时只能从已有配置里带过来，推断不出来。
     */
    label?: string;
    /** 已配过的逻辑键；生成 JSON 时沿用它做 key，见 ExistingEntry.logicalKey */
    logicalKey?: string;
    linkTableId?: string;
    displayField?: string;
  }
>;

/** 从已有 fieldMapping JSON 里读出「平台列名 → 已配置项」 */
export type ExistingEntry = {
  /**
   * 原来的逻辑键。
   *
   * 逻辑键才是**其它配置引用这一列的名字**：绑定的 uniqueKey、回复模板里的
   * `${fields.月份}`、场景 prompt 里的字段名，引用的都是它，而不是平台列名。
   * 生成 JSON 时如果按平台列名重新起键（`{"统计月份": …}`），uniqueKey 会指向
   * 一个不存在的键 —— dispatcher 取 `createFields[uniqueKey]` 得到 undefined，
   * **CREATE 查重整段被跳过**，重复记录一条条静默写进去，而保存时不会有任何报错。
   */
  logicalKey: string;
  type: 'plain' | 'link' | 'multiSelect';
  displayType?: DisplayTypeOption;
  sensitive?: boolean;
  primary?: boolean;
  label?: string;
  linkTableId?: string;
  displayField?: string;
};

/**
 * 按**平台列名**索引（不是逻辑键）：字段选择器认的是平台列名，
 * 而逻辑键可以和平台列名不同（`{ "月份": { name: "统计月份" } }`）。
 * 解析失败时返回空表 —— 退化成"覆盖式生成"的旧行为，而不是报错卡住。
 */
export function readExistingMapping(json?: string): Map<string, ExistingEntry> {
  const out = new Map<string, ExistingEntry>();
  if (!json?.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  for (const [logicalKey, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (typeof value === 'string') {
      // 裸字符串映射：除了逻辑键，没有别的可保留的配置
      out.set(value, { logicalKey, type: 'plain' });
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.name !== 'string') continue;
    out.set(v.name, {
      logicalKey,
      type: v.type === 'link' || v.type === 'multiSelect' ? v.type : 'plain',
      displayType:
        v.displayType === 'date' ||
        v.displayType === 'number' ||
        v.displayType === 'text'
          ? v.displayType
          : undefined,
      sensitive: v.sensitive === true,
      primary: v.primary === true,
      label: typeof v.label === 'string' ? v.label : undefined,
      linkTableId:
        typeof v.linkTableId === 'string' ? v.linkTableId : undefined,
      displayField:
        typeof v.displayField === 'string' ? v.displayField : undefined,
    });
  }
  return out;
}

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
  /**
   * 启用开关。以前 UI 根本不传这个字段，而后端 zod 的默认值是 true 且
   * 会写进 update set —— 于是在库里手动停用的绑定，管理员一点「编辑保存」
   * 就被重新启用了，而且界面上完全看不出来。
   */
  isActive: boolean;
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
          primary: cur?.primary ?? false,
          label: cur?.label,
          logicalKey: cur?.logicalKey,
          linkTableId: cur?.linkTableId,
          displayField: cur?.displayField,
          ...patch,
        },
      };
    });
  };

  /** 主标识全表唯一，选中一个就要清掉其它 */
  const setPrimary = (fieldName: string) => {
    setPickerSelection((prev) => {
      const next: FieldPickerSelection = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k] = { ...v, primary: k === fieldName };
      }
      return next;
    });
  };
  const fetchFields = api.imBot.admin.fetchTableFields.useMutation({
    onSuccess: (fields) => {
      setPickerFields(fields);
      // 已有配置按平台列名索引。**重新拉取必须是合并而不是覆盖** ——
      // 最常见的重拉动机恰恰是"补上平台新增的选项/列"，而自动推断在几类列
      // 上必然不如管理员手工确认的准：
      // - 公式列（飞书 ui_type=Formula）算出来的是数字，推断只能给 text
      // - 关联列的 linkTableId / displayField 根本推断不出来
      // - label（群里展示用的友好名）平台侧压根没有这个概念
      // 覆盖式生成会把这些一次性冲掉，而且冲掉了不会有任何提示。
      const existing = readExistingMapping(editing?.fieldMappingStr);
      const hasExisting = existing.size > 0;

      const init: FieldPickerSelection = {};
      // 已配过主标识就沿用；没有才退回"第一个文本列"的启发式
      const keptPrimary = fields.find(
        (f) => existing.get(f.fieldName)?.primary === true,
      )?.fieldName;
      const defaultPrimary =
        keptPrimary ??
        fields.find(
          (f) =>
            f.suggestedType === 'plain' && f.suggestedDisplayType === 'text',
        )?.fieldName;

      for (const f of fields) {
        const prev = existing.get(f.fieldName);
        init[f.fieldName] = {
          // 已有配置时，"选中"沿用原来纳管了哪些列 —— 管理员可能刻意
          // 排除了某些列（比如敏感列），重拉不该把它们悄悄加回来
          selected: hasExisting ? !!prev : true,
          type: prev?.type ?? f.suggestedType,
          sensitive: prev?.sensitive ?? SENSITIVE_KEY_PATTERN.test(f.fieldName),
          displayType: prev?.displayType ?? f.suggestedDisplayType,
          primary: f.fieldName === defaultPrimary,
          label: prev?.label,
          // 沿用原来的逻辑键：uniqueKey / 回复模板 / prompt 都按它引用这一列
          logicalKey: prev?.logicalKey,
          linkTableId: prev?.linkTableId,
          displayField: prev?.displayField,
        };
      }
      setPickerSelection(init);
      setPickerOpen(true);
      const added = fields.filter(
        (f) => hasExisting && !existing.has(f.fieldName),
      );
      if (added.length > 0) {
        toast.info(
          `平台上有 ${added.length} 个新列未纳管：${added
            .map((f) => f.fieldName)
            .join('、')}（需要的话请勾选）`,
        );
      }
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

  /**
   * 字段漂移检测。
   *
   * 为什么需要：prompt 里的字段清单是从 fieldMapping 自动派生的，但
   * fieldMapping 本身只在点「从飞书拉取字段」时更新。飞书那边加列 / 改列名 /
   * 加选项都不会同步过来，而三种都是**静默**的 —— 加列是"用户说了记不进去"，
   * 改列名是写入报 InvalidFieldName，加选项是 LLM 挑一个不存在的值。
   */
  const [driftReport, setDriftReport] = useState<DriftRow[] | null>(null);
  const checkDrift = api.imBot.admin.checkResourceBindingDrift.useMutation({
    onSuccess: (rows) => {
      setDriftReport(rows);
      const dirty = rows.filter(
        (r) =>
          r.missingOnPlatform.length > 0 ||
          r.newOnPlatform.length > 0 ||
          r.staleOptions.length > 0,
      );
      if (dirty.length === 0) {
        toast.success('所有绑定与飞书上的字段一致');
      } else {
        toast.warning(`${dirty.length} 个绑定与飞书字段不一致，见下方明细`);
      }
    },
    onError: (err) => toast.error(`检测失败：${err.message}`),
  });

  const deleteMutation = api.imBot.admin.deleteResourceBinding.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  /** 当前编辑中的 fieldMapping 已经纳管了哪些平台列 —— 用来标出"新列" */
  const managedNames = new Set(
    readExistingMapping(editing?.fieldMappingStr).keys(),
  );

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
          {!record.isActive && <Tag color="red">已停用</Tag>}
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
                isActive: record.isActive,
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
                isActive: true,
              })
            }
            type="primary"
          >
            新增绑定
          </Button>
          <Button
            loading={checkDrift.isPending}
            onClick={() => checkDrift.mutate({})}
          >
            检查字段漂移
          </Button>
        </div>

        {driftReport && (
          <div style={{ marginBottom: 12 }}>
            {driftReport.map((r) => {
              const clean =
                !r.skipped &&
                r.missingOnPlatform.length === 0 &&
                r.newOnPlatform.length === 0 &&
                r.staleOptions.length === 0;
              if (clean) return null;
              return (
                <Alert
                  description={
                    <div style={{ fontSize: 12 }}>
                      {r.skipped && <div>{r.skipped}</div>}
                      {r.missingOnPlatform.length > 0 && (
                        <div>
                          ❌ 映射里有、飞书上已没有（写入会报
                          InvalidFieldName）：
                          {r.missingOnPlatform
                            .map((m) => `${m.logicalKey}→${m.platformName}`)
                            .join('、')}
                        </div>
                      )}
                      {r.newOnPlatform.length > 0 && (
                        <div>
                          ➕ 飞书上有、映射里没有（机器人完全不知道这些列）：
                          {r.newOnPlatform.join('、')}
                        </div>
                      )}
                      {r.staleOptions.length > 0 && (
                        <div>
                          🔄 单选取值已变（prompt 里的合法值过期，LLM
                          会挑到不存在的值）：
                          {r.staleOptions
                            .map(
                              (o) =>
                                `${o.logicalKey}（存的 ${o.stored.join('/') || '空'} → 现在 ${o.live.join('/')}）`,
                            )
                            .join('；')}
                        </div>
                      )}
                      <div style={{ marginTop: 4, color: '#888' }}>
                        修复方式：编辑该绑定 → 重新「拉取字段」→ 生成 JSON →
                        保存
                      </div>
                    </div>
                  }
                  key={r.id}
                  message={`${r.sceneId} / ${r.alias}`}
                  showIcon
                  style={{ marginBottom: 8 }}
                  type={r.skipped ? 'info' : 'warning'}
                />
              );
            })}
          </div>
        )}

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
              isActive: editing.isActive,
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
                label="启用"
                tooltip="停用后机器人加载不到这条绑定，场景会退回「未配置数据资源绑定」"
              >
                <Switch
                  checked={editing.isActive}
                  onChange={(val) => setEditing({ ...editing, isActive: val })}
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
                      editing.kind !== 'table'
                    }
                    loading={fetchFields.isPending}
                    onClick={() =>
                      fetchFields.mutate({
                        provider: editing.provider,
                        workspaceId: editing.workspaceId,
                        tableId: editing.resourceId,
                      })
                    }
                    size="small"
                  >
                    从{PLATFORM_LABELS[editing.provider]}拉取字段…
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
            // 主标识必须选且只能选一个：缺了就退回代码里反复警告的启发式
            // （fieldMapping 存 jsonb，键序被 Postgres 重排，"第一列是名称类"
            // 不成立），删除确认会渲染成「利润=-108 / 月份=1月」这种认不出
            // 是哪条的摘要。服务端也会拦，这里先给一句人话。
            const chosenPrimaries = pickerFields.filter(
              (f) =>
                pickerSelection[f.fieldName]?.selected &&
                pickerSelection[f.fieldName]?.primary,
            );
            if (editing.kind === 'table' && chosenPrimaries.length !== 1) {
              toast.error(
                chosenPrimaries.length === 0
                  ? '请勾选一个字段作为主标识（候选列表与删除确认靠它认记录）'
                  : '主标识只能有一个',
              );
              return;
            }
            const result: Record<string, unknown> = {};
            for (const f of pickerFields) {
              const sel = pickerSelection[f.fieldName];
              if (!sel?.selected) continue;
              // key 用**逻辑键**：已配过的沿用原名，新列才拿平台列名当逻辑键。
              // 按平台列名重新起键会让 uniqueKey / ${fields.xxx} 指向不存在的
              // 字段，而且保存时不报错 —— 见 ExistingEntry.logicalKey
              const key = sel.logicalKey ?? f.fieldName;
              if (sel.type === 'plain') {
                // plain 一律写成对象并带上 displayType。
                // 以前无敏感标记时输出裸字符串，displayType 无处可放 ——
                // 于是日期/数字/文本三种语义在运行时只能靠值猜，
                // 文本列里的 "2026-05-11" 会被当日期写成时间戳。
                result[key] = {
                  name: f.fieldName,
                  type: 'plain',
                  displayType: sel.displayType,
                  ...(sel.label ? { label: sel.label } : {}),
                  ...(sel.sensitive ? { sensitive: true } : {}),
                  ...(sel.primary ? { primary: true } : {}),
                  // 单选列的合法取值一并落库，注入 prompt 后 LLM 不会再自造
                  ...(f.options?.length ? { options: f.options } : {}),
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
                result[key] = {
                  name: f.fieldName,
                  type: 'link',
                  linkTableId: sel.linkTableId,
                  displayField: sel.displayField,
                  ...(sel.label ? { label: sel.label } : {}),
                  ...(sel.sensitive ? { sensitive: true } : {}),
                  ...(sel.primary ? { primary: true } : {}),
                };
                continue;
              }
              result[key] = {
                name: f.fieldName,
                type: sel.type,
                ...(sel.label ? { label: sel.label } : {}),
                ...(sel.sensitive ? { sensitive: true } : {}),
                ...(sel.primary ? { primary: true } : {}),
                // multiSelect 同理
                ...(f.options?.length ? { options: f.options } : {}),
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
            <br />
            「主标识」选一个能一眼认出记录的列（通常是名称类）：删除确认和候选列表会优先展示它。
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
              {
                title: '字段名',
                dataIndex: 'fieldName',
                width: 180,
                render: (v: string) => (
                  <Space size={4}>
                    <span>{v}</span>
                    {!managedNames.has(v) && managedNames.size > 0 && (
                      <Tag color="blue">新列</Tag>
                    )}
                  </Space>
                ),
              },
              {
                title: 'UI 类型',
                dataIndex: 'uiType',
                width: 110,
                render: (v: string) => <Tag>{v || '—'}</Tag>,
              },
              {
                // 单选/多选列的合法取值会一并落库并注入 prompt，LLM 因此
                // 不会再自造一个不存在的选项值。有没有拉到，这里要看得见。
                title: '平台可选值',
                width: 150,
                render: (_, f: FetchedField) =>
                  f.options?.length ? (
                    <Tooltip title={f.options.join(' / ')}>
                      <Tag color="green">{f.options.length} 个</Tag>
                    </Tooltip>
                  ) : (
                    <span style={{ color: '#bbb' }}>—</span>
                  ),
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
                title: '主标识',
                width: 70,
                render: (_, f: FetchedField) => (
                  <Radio
                    checked={pickerSelection[f.fieldName]?.primary ?? false}
                    onChange={() => setPrimary(f.fieldName)}
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
