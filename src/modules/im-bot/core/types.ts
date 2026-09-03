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
   * - 企微要用回调里的 `AgentID` / `ToUserName`
   * 以前 parse() 把原始 body 丢掉，导致这两个平台的 reply() 根本写不出来。
   */
  raw?: unknown;
}

/** 意图解析结果 */
export interface ParsedIntent {
  intent: 'CREATE' | 'UPDATE' | 'QUERY' | 'DELETE' | 'UNKNOWN';
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

/** 执行结果 */
export interface ExecuteResult {
  success: boolean;
  record?: SpreadsheetRecord;
  records?: SpreadsheetRecord[];
  error?: string;
}

/** 场景上下文 */
export interface SceneContext {
  today: string;
  senderName: string;
  chatName?: string;
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
   * 数字字段展示类型：
   * - 'number'：原样输出数字（金额、数量、版本号等）
   * - 'date'：始终按日期格式化
   * - 未设置：按毫秒值是否落在 2000~2100 年自动判定（兼容旧行为，但会误判大金额）
   */
  displayType?: 'number' | 'date';
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
  result: 'success' | 'error' | 'ignored';
  resultData?: unknown;
  errorMsg?: string;
  costMs: number;
  createdAt: Date;
}
