import type { ExecuteResult, ParsedIntent, SceneContext } from '../core/types';
import type { BotScene } from './types';

/** 将飞书多维表格等平台返回的复杂字段值转为可读字符串 */
function fieldToString(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return String(v);
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item != null && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
          if (typeof obj.name === 'string') return obj.name;
          return fieldToString(item);
        }
        return String(item);
      })
      .filter(Boolean)
      .join(' ');
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // 飞书 URL/富文本字段: {text: "...", link?: "..."}
    if (typeof obj.text === 'string') return obj.text;
    // 飞书类型包装字段: {type: N, value: [...]}
    if ('value' in obj && Array.isArray(obj.value)) {
      return fieldToString(obj.value);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

export interface DbSceneConfig {
  sceneId: string;
  name: string;
  description: string;
  keywords: string[];
  systemPrompt: string;
  replyTemplate?: string;
}

/**
 * 通用数据库驱动场景 — 所有行为由数据库配置字段驱动，
 * 不含任何硬编码业务逻辑。
 */
export class DatabaseDrivenScene implements BotScene {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  private keywords: string[];
  private systemPrompt: string;
  private replyTemplate?: string;

  constructor(config: DbSceneConfig) {
    this.id = config.sceneId;
    this.name = config.name;
    this.description = config.description ?? '';
    this.keywords = config.keywords;
    this.systemPrompt = config.systemPrompt;
    this.replyTemplate = config.replyTemplate;
  }

  match(content: string): number {
    if (this.keywords.length === 0) return 0;
    const matched = this.keywords.filter((kw) => content.includes(kw));
    return matched.length > 0 ? matched.length / this.keywords.length : 0;
  }

  getSystemPrompt(ctx: SceneContext): string {
    return this.systemPrompt
      .replaceAll('${today}', ctx.today)
      .replaceAll('${senderName}', ctx.senderName)
      .replaceAll('${chatName}', ctx.chatName ?? '');
  }

  parseResult(json: string): ParsedIntent | null {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      const intent = obj.intent as string;
      if (!['CREATE', 'UPDATE', 'QUERY', 'DELETE', 'UNKNOWN'].includes(intent))
        return null;
      return {
        intent: intent as ParsedIntent['intent'],
        fields: (obj.fields as Record<string, unknown>) ?? {},
        filters: (obj.filters as Record<string, unknown>) ?? undefined,
        confidence: Number(obj.confidence) || 0,
        summary: String(obj.summary ?? ''),
      };
    } catch {
      return null;
    }
  }

  formatReply(intent: ParsedIntent, result: ExecuteResult): string {
    if (!result.success) return `❌ 操作失败: ${result.error ?? '未知错误'}`;

    // 有自定义回复模板时使用模板
    if (this.replyTemplate) {
      return this.applyReplyTemplate(intent, result);
    }

    // 通用默认格式
    if (intent.intent === 'CREATE' && result.record) {
      const entries = Object.entries(result.record.fields)
        .map(([k, v]) => [k, fieldToString(v)] as const)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}：${v}`);
      return `✅ 已录入${this.name}\n\n${entries.join('\n')}`;
    }

    if (intent.intent === 'QUERY' && result.records) {
      if (result.records.length === 0)
        return `📊 查询结果: 未找到匹配的${this.name}`;
      const DISPLAY_LIMIT = 10;
      const displayed = result.records.slice(0, DISPLAY_LIMIT);
      const items = displayed.map((r, i) => {
        const lines = Object.entries(r.fields)
          .map(([k, v]) => [k, fieldToString(v)] as const)
          .map(([k, v]) => `  ${k}：${v || '—'}`);
        const header =
          (result.records?.length ?? 0) > 1 ? `【第 ${i + 1} 条】\n` : '';
        return `${header}${lines.join('\n')}`;
      });
      const truncated =
        result.records.length > DISPLAY_LIMIT
          ? `\n…（共 ${result.records.length} 条，仅展示前 ${DISPLAY_LIMIT} 条）`
          : '';
      return `📊 查询结果 (共 ${result.records.length} 条)\n\n${items.join('\n\n')}${truncated}`;
    }

    if (intent.intent === 'UPDATE') return `✅ 已更新${this.name}`;
    if (intent.intent === 'DELETE') return `✅ 已删除${this.name}`;
    return '✅ 操作完成';
  }

  /**
   * 简易模板引擎：支持 ${intent}、${summary}、${fieldList}、${count} 变量
   */
  private applyReplyTemplate(
    intent: ParsedIntent,
    result: ExecuteResult,
  ): string {
    const fields = result.record?.fields ?? result.records?.[0]?.fields ?? {};
    const fieldList = Object.entries(fields)
      .map(([k, v]) => [k, fieldToString(v)] as const)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}：${v}`)
      .join('\n');

    if (!this.replyTemplate) return '✅ 操作完成';
    return this.replyTemplate
      .replaceAll('${intent}', intent.intent)
      .replaceAll('${summary}', intent.summary)
      .replaceAll('${fieldList}', fieldList)
      .replaceAll('${count}', String(result.records?.length ?? 1))
      .replaceAll('${sceneName}', this.name);
  }
}

/** 从数据库记录的 keywords 字段（JSON 字符串或逗号分隔）解析为数组 */
export function parseKeywords(raw: string | null | undefined): string[] {
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
  // 兼容逗号分隔格式
  return trimmed
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
