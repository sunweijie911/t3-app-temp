import { feishuTokenManager } from '../auth/feishu-token';
import type { DocumentContent } from '../core/types';
import type { DocumentAdapter, DocumentConfig } from './types';

/** 单次追加的文本总长上限，避免一条群消息把整篇文档灌进去 */
const APPEND_MAX_LEN = 20_000;
/** 飞书单次创建子块的数量上限（官方限制 50） */
const APPEND_BLOCK_LIMIT = 50;
/** 读取正文的返回上限，超出截断（群里也展示不下） */
const READ_MAX_LEN = 50_000;

async function feishuDocxApi(path: string, method: string, body?: unknown) {
  const token = await feishuTokenManager.getToken();
  const res = await fetch(`https://open.feishu.cn/open-apis/docx/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(
      `飞书 Docx API HTTP 错误: ${res.status} ${res.statusText} path=${path}`,
    );
  }
  const data = (await res.json()) as {
    code: number;
    data?: unknown;
    msg?: string;
  };
  if (data.code !== 0) {
    // 与 bitable adapter 一致：不打印 body 原文，避免用户写入的内容落进日志
    console.error('[FeishuDocx] API 错误', {
      path,
      code: data.code,
      msg: data.msg,
    });
    throw new Error(`飞书 Docx API 错误: ${data.msg ?? data.code}`);
  }
  return data.data;
}

export function documentUrl(documentId: string): string {
  return `https://feishu.cn/docx/${documentId}`;
}

/**
 * 从 raw_content 里剥掉开头重复的标题。
 *
 * 实测：`raw_content` 把文档标题当作正文第一行返回。而回复模板已经单独
 * 渲染了《标题》，不剥掉的话群消息里标题会连着出现两次。
 */
export function stripLeadingTitle(text: string, title: string): string {
  const t = title.trim();
  if (!t) return text;
  const nl = text.indexOf('\n');
  const firstLine = (nl === -1 ? text : text.slice(0, nl)).trim();
  if (firstLine !== t) return text;
  return nl === -1 ? '' : text.slice(nl + 1);
}

/**
 * 把纯文本拆成飞书 docx 的文本块（block_type 2 = 文本段落）。
 * 按行拆分：一行一个段落，空行跳过（飞书空文本块会渲染成多余空段）。
 */
export function textToBlocks(text: string): Array<{
  block_type: number;
  text: { elements: Array<{ text_run: { content: string } }>; style: object };
}> {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      block_type: 2,
      text: { elements: [{ text_run: { content: line } }], style: {} },
    }));
}

export class FeishuDocxAdapter implements DocumentAdapter {
  readonly platform = 'feishu' as const;

  async readDocument(config: DocumentConfig): Promise<DocumentContent> {
    const [meta, raw] = await Promise.all([
      feishuDocxApi(`/documents/${config.documentId}`, 'GET') as Promise<{
        document?: { title?: string };
      }>,
      feishuDocxApi(
        `/documents/${config.documentId}/raw_content?lang=0`,
        'GET',
      ) as Promise<{ content?: string }>,
    ]);

    const title = meta.document?.title ?? '(无标题)';
    // raw_content 会把标题当正文第一行返回，剥掉避免回复里标题出现两次
    const text = stripLeadingTitle(raw.content ?? '', title);
    return {
      title,
      text:
        text.length > READ_MAX_LEN
          ? `${text.slice(0, READ_MAX_LEN)}\n…（正文过长已截断）`
          : text,
      url: documentUrl(config.documentId),
    };
  }

  async appendText(
    config: DocumentConfig,
    text: string,
  ): Promise<DocumentContent> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('追加内容为空');
    if (trimmed.length > APPEND_MAX_LEN) {
      throw new Error(
        `追加内容 ${trimmed.length} 字，超过单次上限 ${APPEND_MAX_LEN} 字`,
      );
    }
    const blocks = textToBlocks(trimmed);
    if (blocks.length === 0) throw new Error('追加内容为空');
    if (blocks.length > APPEND_BLOCK_LIMIT) {
      throw new Error(
        `追加内容有 ${blocks.length} 个段落，超过飞书单次上限 ${APPEND_BLOCK_LIMIT} 段，请拆分后重试`,
      );
    }

    // block_id 传 document_id 表示挂到文档根节点下；index=-1 追加到末尾
    await feishuDocxApi(
      `/documents/${config.documentId}/blocks/${config.documentId}/children`,
      'POST',
      { children: blocks, index: -1 },
    );

    const meta = (await feishuDocxApi(
      `/documents/${config.documentId}`,
      'GET',
    )) as { document?: { title?: string } };

    return {
      title: meta.document?.title ?? '(无标题)',
      text: trimmed,
      url: documentUrl(config.documentId),
    };
  }
}
