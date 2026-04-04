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
  filters?: Record<string, unknown>;
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

/** 多维表格配置 */
export interface SpreadsheetTableConfig {
  platform: BotPlatform;
  workspaceId: string;
  tableId: string;
  fieldMapping: Record<string, string>;
}

/** 有状态交互 */
export interface PendingAction {
  sceneId: string;
  type: 'confirm_delete' | 'select_record';
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
