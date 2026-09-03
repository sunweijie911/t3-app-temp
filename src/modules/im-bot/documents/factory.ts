import type { BotPlatform } from '../constants';
import type { DocumentContent, ResourceBinding } from '../core/types';
import { FeishuDocxAdapter } from './feishu-docx';
import type { DocumentAdapter, DocumentConfig } from './types';

/**
 * 钉钉在线文档 Adapter — 尚未实现。
 * 实现要点：钉钉文档走 `/v1.0/doc/workspaces/{workspaceId}/docs/{nodeId}`
 * 系列接口，正文读写用 dentries/blocks；鉴权用 access_token（非 sessionWebhook）。
 */
class DingtalkDocAdapter implements DocumentAdapter {
  readonly platform = 'dingtalk' as const;
  async readDocument(): Promise<DocumentContent> {
    throw new Error('钉钉文档适配器尚未实现');
  }
  async appendText(): Promise<DocumentContent> {
    throw new Error('钉钉文档适配器尚未实现');
  }
}

/**
 * 企微智能文档 Adapter — 尚未实现。
 * 实现要点：企微智能文档走 `wedoc/document/get`、`wedoc/document/batch_update`，
 * 文档 ID 是 docid；需要企业内部应用的 access_token。
 */
class WecomDocAdapter implements DocumentAdapter {
  readonly platform = 'wecom' as const;
  async readDocument(): Promise<DocumentContent> {
    throw new Error('企微文档适配器尚未实现');
  }
  async appendText(): Promise<DocumentContent> {
    throw new Error('企微文档适配器尚未实现');
  }
}

const adapters: Record<BotPlatform, DocumentAdapter> = {
  feishu: new FeishuDocxAdapter(),
  dingtalk: new DingtalkDocAdapter(),
  wecom: new WecomDocAdapter(),
};

export function getDocumentAdapter(platform: BotPlatform): DocumentAdapter {
  return adapters[platform];
}

/**
 * 把资源绑定转成文档 adapter 消费的配置。
 * 与表格侧的 tableConfigOf 对位：platform 取 binding.provider，
 * 即数据所在平台，与消息来源无关。
 */
export function documentConfigOf(binding: ResourceBinding): DocumentConfig {
  return {
    platform: binding.provider,
    workspaceId: binding.workspaceId,
    documentId: binding.resourceId,
  };
}
