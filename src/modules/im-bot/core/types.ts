import type { BotPlatform } from '../constants';

/** 统一消息格式 — 所有平台 Adapter 输出此结构 */
export interface UnifiedMessage {
  platform: BotPlatform;
  eventId: string;
  messageId: string;
  chatId: string;
  chatName?: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
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
}

/**
 * 多选字段映射声明 — 飞书 bitable 多选字段，filter 默认用 contains，
 * 写入需要 string[]。与普通文本字段在协议上有差异，需显式声明。
 */
export interface MultiSelectFieldMapping {
  name: string;
  type: 'multiSelect';
  sensitive?: boolean;
}

/**
 * 普通字段映射声明 — 等价于直接给字符串，但额外支持 sensitive 标记。
 */
export interface PlainFieldMapping {
  name: string;
  type: 'plain';
  sensitive?: boolean;
}

/** fieldMapping value 联合类型 */
export type FieldMappingValue =
  | string
  | LinkFieldMapping
  | MultiSelectFieldMapping
  | PlainFieldMapping;

/** 多维表格配置 — value 为 string 时按普通字段处理，为对象时按 type 分流 */
export interface SpreadsheetTableConfig {
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMapping: Record<string, FieldMappingValue>;
  /** 唯一键逻辑字段名，用于 CREATE 前查重转 UPDATE */
  uniqueKey?: string;
}

/** 有状态交互 */
export interface PendingAction {
  sceneId: string;
  type: 'confirm_delete' | 'select_record' | 'confirm_upsert';
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
