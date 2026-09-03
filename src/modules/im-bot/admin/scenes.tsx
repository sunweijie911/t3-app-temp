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
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
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

type SceneRow = {
  id: string;
  sceneId: string;
  name: string;
  description?: string | null;
  keywords?: string | null;
  isActive: boolean;
  sortOrder: number;
  systemPrompt?: string | null;
  fieldSchema?: unknown;
  replyTemplate?: string | null;
};

type EditingScene = {
  id?: string;
  sceneId: string;
  name: string;
  description: string;
  keywordTags: string[];
  systemPrompt: string;
  replyTemplate: string;
  isActive: boolean;
};

const emptyScene: EditingScene = {
  sceneId: '',
  name: '',
  description: '',
  keywordTags: [],
  systemPrompt: '',
  replyTemplate: '',
  isActive: true,
};

/** 从数据库存储的 keywords 字符串解析为标签数组 */
function parseKeywordTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      return Array.isArray(arr)
        ? arr.filter((s: unknown) => typeof s === 'string' && s)
        : [];
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ImBotScenesPage() {
  const { data: scenes, refetch } = api.imBot.admin.listScenes.useQuery();
  const [editing, setEditing] = useState<EditingScene | null>(null);
  const [localScenes, setLocalScenes] = useState<SceneRow[] | null>(null);

  useEffect(() => {
    setLocalScenes(null);
  }, []);

  const displayScenes = localScenes ?? scenes;
  const sortableIds = useMemo(
    () => displayScenes?.map((s) => s.id) ?? [],
    [displayScenes],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const upsertMutation = api.imBot.admin.upsertScene.useMutation({
    onSuccess: () => {
      toast.success('保存成功');
      void refetch();
      setEditing(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = api.imBot.admin.deleteScene.useMutation({
    onSuccess: () => {
      toast.success('已删除');
      void refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = api.imBot.admin.toggleScene.useMutation({
    onSuccess: () => void refetch(),
    onError: (err) => toast.error(err.message),
  });

  const reorderMutation = api.imBot.admin.reorderScenes.useMutation({
    onSuccess: () => void refetch(),
    onError: (err) => toast.error(err.message),
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !displayScenes) return;

    const fromIdx = displayScenes.findIndex((s) => s.id === active.id);
    const toIdx = displayScenes.findIndex((s) => s.id === over.id);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = arrayMove([...displayScenes], fromIdx, toIdx);
    setLocalScenes(reordered);
    reorderMutation.mutate({ ids: reordered.map((s) => s.id) });
  }

  const columns: ColumnsType<SceneRow> = [
    {
      title: '',
      width: 40,
      render: () => (
        <HolderOutlined style={{ cursor: 'grab', color: '#999' }} />
      ),
    },
    { title: '场景 ID', dataIndex: 'sceneId', width: 120 },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '关键词',
      dataIndex: 'keywords',
      width: 200,
      render: (val: string | null) => {
        if (!val) return '-';
        try {
          const arr = JSON.parse(val) as string[];
          return arr.map((kw) => <Tag key={kw}>{kw}</Tag>);
        } catch {
          return val;
        }
      },
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      render: (val: boolean, record: SceneRow) => (
        <Switch
          checked={val}
          onChange={(checked) =>
            toggleMutation.mutate({ id: record.id, isActive: checked })
          }
          size="small"
        />
      ),
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, record: SceneRow) => (
        <Space size="small">
          <Button
            onClick={() =>
              setEditing({
                id: record.id,
                sceneId: record.sceneId,
                name: record.name,
                description: record.description ?? '',
                keywordTags: parseKeywordTags(record.keywords),
                systemPrompt: record.systemPrompt ?? '',
                replyTemplate: record.replyTemplate ?? '',
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
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-bold text-2xl text-gray-900">场景管理</h1>
          <Button onClick={() => setEditing({ ...emptyScene })} type="primary">
            新增场景
          </Button>
        </div>

        <DndContext
          id="im-bot-scenes"
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
              dataSource={displayScenes as SceneRow[] | undefined}
              pagination={false}
              rowKey="id"
              size="small"
              style={{ background: '#fff', borderRadius: 12 }}
            />
          </SortableContext>
        </DndContext>

        <Modal
          confirmLoading={upsertMutation.isPending}
          onCancel={() => setEditing(null)}
          onOk={() => {
            if (!editing) return;
            upsertMutation.mutate({
              id: editing.id,
              sceneId: editing.sceneId,
              name: editing.name,
              description: editing.description,
              keywords: JSON.stringify(editing.keywordTags),
              systemPrompt: editing.systemPrompt,
              replyTemplate: editing.replyTemplate,
              isActive: editing.isActive,
            });
          }}
          open={!!editing}
          title={editing?.id ? '编辑场景' : '新增场景'}
          width={720}
        >
          {editing && (
            <Form layout="vertical">
              <Form.Item label="场景 ID" required>
                <Input
                  disabled={!!editing.id}
                  onChange={(e) =>
                    setEditing({ ...editing, sceneId: e.target.value })
                  }
                  placeholder="如 sales、tasks"
                  value={editing.sceneId}
                />
              </Form.Item>
              <Form.Item label="名称" required>
                <Input
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  value={editing.name}
                />
              </Form.Item>
              <Form.Item label="描述">
                <Input.TextArea
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                  rows={2}
                  value={editing.description}
                />
              </Form.Item>
              <Form.Item
                label="触发关键词"
                tooltip="输入关键词后按回车添加，消息包含任意关键词即可匹配到此场景"
              >
                <Select
                  mode="tags"
                  onChange={(tags: string[]) =>
                    setEditing({ ...editing, keywordTags: tags })
                  }
                  open={false}
                  placeholder="输入关键词后按回车添加"
                  style={{ width: '100%' }}
                  tokenSeparators={[',', '，']}
                  value={editing.keywordTags}
                />
              </Form.Item>
              <Form.Item
                label="System Prompt"
                required
                tooltip="发送给 LLM 的系统提示词。只需写业务规则 —— 字段清单由资源绑定自动生成并追加"
              >
                <Input.TextArea
                  onChange={(e) =>
                    setEditing({ ...editing, systemPrompt: e.target.value })
                  }
                  placeholder="只写业务规则与输出 JSON 格式；字段清单不用手写"
                  rows={10}
                  value={editing.systemPrompt}
                />
                <Typography.Text style={{ fontSize: 12 }} type="secondary">
                  <b>不需要在这里手写字段清单</b>
                  ：资源绑定里的字段名、类型、唯一键、可用 intent
                  会在每次调用时按当前配置自动追加到提示词末尾。手写反而会在改表后过期。
                  <br />
                  {/* biome-ignore-start lint/suspicious/noTemplateCurlyInString: 文档展示给用户的占位符语法 */}
                  支持模板变量：{'${today}'} 当前日期、{'${senderName}'}{' '}
                  发送者、{'${chatName}'} 群名
                  {/* biome-ignore-end lint/suspicious/noTemplateCurlyInString: end */}
                  <br />
                  输出 JSON 的 intent 取值按绑定资源类型区分：表格用{' '}
                  <code>CREATE / UPDATE / QUERY / DELETE</code>，文档用{' '}
                  <code>READ / APPEND</code>（APPEND 时把正文放在{' '}
                  <code>fields.content</code>）。
                  <br />
                  一个场景绑了多个资源时，用 <code>resource</code>{' '}
                  字段指定资源别名；省略则用默认资源。
                </Typography.Text>
              </Form.Item>
              <Form.Item
                label="回复模板（可选）"
                tooltip="自定义回复格式，留空使用默认格式"
              >
                <Input.TextArea
                  onChange={(e) =>
                    setEditing({ ...editing, replyTemplate: e.target.value })
                  }
                  placeholder="留空使用默认回复格式"
                  rows={3}
                  value={editing.replyTemplate}
                />
                <Typography.Text style={{ fontSize: 12 }} type="secondary">
                  {/* biome-ignore-start lint/suspicious/noTemplateCurlyInString: 文档展示给用户的占位符语法 */}
                  支持变量：{'${intent}'} 操作类型、{'${summary}'} 摘要、
                  {'${fieldList}'} 字段列表、{'${count}'} 记录数、
                  {'${sceneName}'} 场景名
                  {/* biome-ignore-end lint/suspicious/noTemplateCurlyInString: end */}
                </Typography.Text>
              </Form.Item>
            </Form>
          )}
        </Modal>
      </div>
    </main>
  );
}
