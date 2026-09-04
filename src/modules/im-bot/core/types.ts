import type { BotPlatform } from '../constants';

/** 会话类型。p2p = 单聊（免 @），group = 群聊（要求 @机器人） */
export type ChatType = 'p2p' | 'group';

/** 统一消息格式 — 所有平台 Adapter 输出此结构 */
export interface UnifiedMessage {
  platform: BotPlatform;
  eventId: string;
  messageId: string;
  chatId: string;
  chatName?: string;
  chatType: ChatType;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  /**
   * 平台原始事件体，供 reply 时取平台专属上下文。
   *
   * 必须保留：飞书用 tenant token 主动发消息，不依赖回调内容；但
   * - 钉钉群机器人回复要用 body 里的 `sessionWebhook`（一次性、有时效）
   * - 企微智能机器人回复要用 body 里的 `webhook_url`（同样是一次性的）
   * 以前 parse() 把原始 body 丢掉，导致这两个平台的 reply() 根本写不出来。
   */
  raw?: unknown;
}

/**
 * 意图动词。
 *
 * CREATE/UPDATE/QUERY/DELETE 是表格语义（历史意图集，现有场景的
 * systemPrompt 只会产出这四种，必须保持兼容）；READ/APPEND 是文档语义。
 * 哪些动词在当前场景可用，由绑定资源的 kind 决定 —— 见 ACTIONS_BY_KIND。
 */
export const INTENT_VERBS = [
  'CREATE',
  'UPDATE',
  'QUERY',
  'DELETE',
  'READ',
  'APPEND',
  'UNKNOWN',
] as const;

export type IntentVerb = (typeof INTENT_VERBS)[number];

/**
 * 会改动数据的意图 —— 受场景的 writerIds 白名单约束。
 * QUERY / READ 是只读，不受限制。
 */
export const WRITE_INTENTS: readonly IntentVerb[] = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'APPEND',
];

export function isWriteIntent(intent: IntentVerb): boolean {
  return WRITE_INTENTS.includes(intent);
}

/** 各资源类型支持的意图动词 */
export const ACTIONS_BY_KIND: Record<ResourceKind, readonly IntentVerb[]> = {
  table: ['CREATE', 'UPDATE', 'QUERY', 'DELETE'],
  // QUERY 也接受：现有场景的 prompt 习惯用 QUERY 表达"查看"，
  // 对文档而言等价于 READ，不该因为动词选得不同就报错
  doc: ['READ', 'APPEND', 'QUERY'],
  file: [],
};

/** 意图解析结果 */
export interface ParsedIntent {
  intent: IntentVerb;
  /**
   * 目标资源别名。一个场景可绑多个资源时用它指定操作对象；
   * 省略则用场景的默认资源。
   */
  resource?: string;
  fields: Record<string, unknown>;
  /**
   * 过滤条件。普通字段 key→value；保留键 `_conjunction` 控制多条件合取
   * （'or' | 'and'，默认 and），用于支持「业务域=门户 OR 业务域=督导」类查询。
   */
  filters?: Record<string, unknown>;
  /**
   * 投影字段（仅 QUERY 生效）。非空时回复只渲染这几列 + 主标识，避免一次性丢出整行 20 字段。
   * 字段名使用 fieldMapping 的逻辑 key（与 filters 的 key 同名空间）。
   */
  projectFields?: string[];
  confidence: number;
  summary: string;
}

/** 文档内容 */
export interface DocumentContent {
  title: string;
  /** 纯文本正文 */
  text: string;
  /** 可点击的文档链接（回复里给用户跳转用） */
  url?: string;
}

/**
 * 执行结果。表格字段（record/records）与文档字段（doc）并存，
 * 由 formatReply 按 intent 分流渲染 —— 加新能力时在这里加字段，
 * 不用改 BotScene 接口签名。
 */
export interface ExecuteResult {
  success: boolean;
  /** 表格：单条写入/更新的结果 */
  record?: SpreadsheetRecord;
  /** 表格：查询结果 */
  records?: SpreadsheetRecord[];
  /** 文档：读取到的内容，或追加后的文档信息 */
  doc?: DocumentContent;
  /** 文档：本次追加进去的文本（用于回复里回显写了什么） */
  appendedText?: string;
  /**
   * true 表示"已挂起二次确认，等用户回复"，而不是执行失败。
   * error 字段此时承载给用户看的确认提示文案。
   * 审计日志据此记 pending 而非 error，避免污染错误率。
   */
  awaitingConfirmation?: boolean;
  /**
   * 本次被丢弃的字段名 —— LLM 产出了 fieldMapping 里没有的字段。
   * 不丢的话 adapter 会用原名透传给平台，飞书回 InvalidFieldName、整条写入失败；
   * 丢了但不说，用户会以为自己讲的内容都记下来了。所以要在回复里点名。
   */
  droppedFields?: string[];
  /**
   * QUERY 结果条数撞上了 adapter 的翻页硬上限，说明可能还有没取到的数据。
   * 上限各平台不同，由 adapter 的 queryHardLimit 声明 ——
   * 以前是在回复渲染里硬编码飞书的 1000，对钉钉/企微都是错的。
   */
  hitQueryLimit?: boolean;
  error?: string;
}

/** 场景上下文 */
export interface SceneContext {
  today: string;
  senderName: string;
  chatName?: string;
  /**
   * 场景当前绑定的资源（含字段清单）。由 dispatcher 从 ResourceBinding 派生，
   * 渲染进 system prompt。
   *
   * 以前 prompt 里的字段清单是管理员**手抄**的，多维表加一列、改个列名
   * 都不会同步：LLM 继续输出旧字段名，新字段用户说了也记不进去。
   */
  resources?: SceneResource[];
}

/** 字段在 prompt 里的描述 */
export interface SceneResourceField {
  /** 逻辑字段名 —— LLM 在 fields / filters 里必须使用这个名字 */
  key: string;
  /**
   * 取值约定提示。只在**确定**时给（多选/关联/显式声明了 displayType），
   * 其余留空 —— 硬猜一个"文本"反而会误导 LLM 给数字加引号。
   */
  hint?: string;
  /** true 时回复里会脱敏，写进 prompt 让 LLM 知道不必回显 */
  sensitive?: boolean;
  /**
   * 单选 / 多选字段的合法取值。
   *
   * 以前这份清单是管理员**手抄在场景 prompt 里**的（「支出分类：美妆产品 /
   * 进货 / …」），飞书里加一个选项就过期 —— LLM 挑一个不存在的值，
   * 写入要么失败要么写进脏数据。现在从字段映射派生，由字段选择器
   * 从平台的 property.options 拉取后落库。
   */
  options?: string[];
}

/** 场景可操作的一个资源 —— 由 ResourceBinding 派生，喂给 prompt */
export interface SceneResource {
  alias: string;
  kind: ResourceKind;
  isDefault: boolean;
  actions: readonly IntentVerb[];
  fields: SceneResourceField[];
  uniqueKey?: string;
}

/** 字段映射 → prompt 里的取值约定提示 */
function fieldHintOf(mapping: FieldMappingValue): string | undefined {
  if (typeof mapping === 'string') return undefined;
  switch (mapping.type) {
    case 'link':
      return `关联字段，直接给「${mapping.displayField}」的显示值`;
    case 'multiSelect':
      return '多选，可以给数组';
    case 'plain':
      if (mapping.displayType === 'date') return '日期，格式 YYYY-MM-DD';
      if (mapping.displayType === 'number') return '数字，不要加引号';
      return undefined;
    default:
      return undefined;
  }
}

/** 取字段声明里的合法取值清单（只有 plain / multiSelect 有这个概念） */
function fieldOptionsOf(mapping: FieldMappingValue): string[] | undefined {
  if (typeof mapping === 'string') return undefined;
  if (mapping.type !== 'plain' && mapping.type !== 'multiSelect') {
    return undefined;
  }
  return mapping.options?.length ? mapping.options : undefined;
}

/** 把资源绑定派生成 prompt 侧的资源描述 */
export function sceneResourceOf(binding: ResourceBinding): SceneResource {
  return {
    alias: binding.alias,
    kind: binding.kind,
    isDefault: binding.isDefault,
    actions: ACTIONS_BY_KIND[binding.kind],
    fields: Object.entries(binding.fieldMapping).map(([key, mapping]) => ({
      key,
      hint: fieldHintOf(mapping),
      sensitive: typeof mapping === 'object' && mapping.sensitive === true,
      options: fieldOptionsOf(mapping),
    })),
    uniqueKey: binding.uniqueKey,
  };
}

/** 统一记录结构 */
export interface SpreadsheetRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

/**
 * Link 字段映射声明 — 用于 fieldMapping 中需要按显示值反查 record_id 的字段
 * （如飞书 bitable 的 link/双向链接字段，写入需要 record_id 数组而非显示值）
 */
export interface LinkFieldMapping {
  /** 平台侧字段名 */
  name: string;
  type: 'link';
  /** 关联的子表 ID */
  linkTableId: string;
  /** 子表中作为显示值的字段名（用于按字符串反查 record_id） */
  displayField: string;
  /** true 时该字段在群消息回复中被脱敏 */
  sensitive?: boolean;
  /** 群消息回复时展示的字段名；未配置则用 fieldMapping 的 logicalKey */
  label?: string;
  /** 见 PlainFieldMapping.primary */
  primary?: boolean;
}

/**
 * 多选字段映射声明 — 飞书 bitable 多选字段，filter 默认用 contains，
 * 写入需要 string[]。与普通文本字段在协议上有差异，需显式声明。
 */
export interface MultiSelectFieldMapping {
  name: string;
  type: 'multiSelect';
  sensitive?: boolean;
  label?: string;
  /** 合法取值清单，见 SceneResourceField.options */
  options?: string[];
  /** 见 PlainFieldMapping.primary */
  primary?: boolean;
}

/**
 * 普通字段映射声明 — 等价于直接给字符串，但额外支持 sensitive 标记。
 */
export interface PlainFieldMapping {
  name: string;
  type: 'plain';
  sensitive?: boolean;
  label?: string;
  /**
   * 主标识字段：候选列表、删除确认、查询投影都优先展示它。
   *
   * 必须显式声明，不能靠"取 fieldMapping 的第一列"——**fieldMapping 存在
   * jsonb 里，Postgres 会按「键长度 + 字节序」重排键**，写进去的
   * `{商品名称, 支出分类, …}` 读回来是 `{利润, 备注, 日期, 月份, …}`。
   * 于是删除确认展示成「利润=-108 / 备注=… / 日期=… / 月份=1月」——
   * 用户看不到商品名称，根本判断不出要删的是哪条。
   */
  primary?: boolean;
  /**
   * 字段展示与写入类型：
   * - 'number'：原样输出数字（金额、数量、版本号等）
   * - 'date'：始终按日期格式化；写入时把 YYYY-MM-DD 转成毫秒时间戳
   * - 'text'：纯文本列。**写入时不做日期转换** —— 文本列里合法的
   *   "2026-05-11" 曾被无条件转成 1778472000000 写进平台
   * - 未设置：兼容旧配置的启发式（值像日期就转、毫秒值落在 2000~2100 年就按日期渲染），
   *   会误判大金额与文本日期，新配置由后台字段选择器显式写明
   */
  displayType?: 'number' | 'date' | 'text';
  /**
   * 单选字段的合法取值清单，见 SceneResourceField.options。
   * 只对 SingleSelect 这类有枚举的列有意义，普通文本列留空。
   */
  options?: string[];
}

/** fieldMapping value 联合类型 */
export type FieldMappingValue =
  | string
  | LinkFieldMapping
  | MultiSelectFieldMapping
  | PlainFieldMapping;

/** 资源类型。table 已实现；doc/file 是能力层预留 */
export type ResourceKind = 'table' | 'doc' | 'file';

/**
 * 场景绑定的一个数据资源。
 *
 * 关键点：`provider` 是**数据所在平台**，与消息来源的 `msg.platform` 无关。
 * 以前 dispatcher 用 `getTableConfig(sceneId, msg.platform)` 取配置，
 * 隐含假设「在哪个 IM 说话 = 数据在哪个平台」，表达不了跨平台访问。
 */
export interface ResourceBinding {
  /** 场景内唯一的资源别名，如「项目表」 */
  alias: string;
  kind: ResourceKind;
  provider: BotPlatform;
  workspaceId: string;
  resourceId: string;
  fieldMapping: Record<string, FieldMappingValue>;
  /** 唯一键逻辑字段名，用于 CREATE 前查重转 UPDATE */
  uniqueKey?: string;
  isDefault: boolean;
}

/** 多维表格配置 — value 为 string 时按普通字段处理，为对象时按 type 分流 */
export interface SpreadsheetTableConfig {
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMapping: Record<string, FieldMappingValue>;
  /** 唯一键逻辑字段名，用于 CREATE 前查重转 UPDATE */
  uniqueKey?: string;
}

/**
 * 把资源绑定转成表格 adapter 消费的配置。
 * `platform` 取 `binding.provider` —— 这一行就是「消息来源 ≠ 数据平台」的落点。
 */
export function tableConfigOf(
  binding: ResourceBinding,
): SpreadsheetTableConfig {
  return {
    platform: binding.provider,
    workspaceId: binding.workspaceId,
    tableId: binding.resourceId,
    fieldMapping: binding.fieldMapping,
    uniqueKey: binding.uniqueKey,
  };
}

/** 有状态交互 */
export interface PendingAction {
  sceneId: string;
  /**
   * 挂起时用的资源别名。确认阶段必须复用同一个绑定，
   * 否则重新解析可能落到另一个资源上（尤其一场景多资源之后）。
   */
  bindingAlias: string;
  type:
    | 'confirm_delete'
    | 'select_record'
    | 'confirm_upsert'
    | 'confirm_update';
  candidates: SpreadsheetRecord[];
  message: UnifiedMessage;
  updateFields?: Record<string, unknown>;
  expiresAt: number;
}

/** 审计事件 */
export interface BotEvent {
  platform: BotPlatform;
  eventId: string;
  chatId: string;
  chatName?: string;
  senderId: string;
  senderName: string;
  content: string;
  sceneId?: string;
  intent?: string;
  result: 'success' | 'error' | 'ignored' | 'pending';
  resultData?: unknown;
  errorMsg?: string;
  costMs: number;
  createdAt: Date;
}
