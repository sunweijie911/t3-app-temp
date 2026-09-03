import type { BotPlatform } from '../constants';
import type { DocumentContent } from '../core/types';

/** 文档资源定位 —— 由 ResourceBinding 派生，与表格的 SpreadsheetTableConfig 对位 */
export interface DocumentConfig {
  platform: BotPlatform;
  /** 所属空间（飞书是 folder_token，可为空） */
  workspaceId: string;
  /** 文档 ID：飞书 docx 的 document_id */
  documentId: string;
}

export interface DocumentAdapter {
  readonly platform: BotPlatform;
  /** 读取文档标题与纯文本正文 */
  readDocument(config: DocumentConfig): Promise<DocumentContent>;
  /**
   * 在文档末尾追加纯文本。多行文本按行拆成多个段落块。
   * @returns 追加后的文档信息（标题/链接），便于回复里给出跳转
   */
  appendText(config: DocumentConfig, text: string): Promise<DocumentContent>;
}
