import type { ExecuteResult, ParsedIntent, SceneContext } from '../core/types';
import type { BotScene } from './types';

const DATE_MS_MIN = 946684800000; // 2000-01-01
const DATE_MS_MAX = 4102444800000; // 2100-01-01
const FIELD_DISPLAY_MAX_LEN = 200;
const REPLY_TOTAL_MAX_LEN = 20_000;

/**
 * 字段名启发式：含"密码/密钥/秘钥/password/secret/token/api_key/凭证/敏感"
 * 等关键字时，输出前自动脱敏。即使 admin 错把敏感字段配进 fieldMapping，
 * 也不会泄漏到群里。
 */
const SENSITIVE_KEY_PATTERN =
  /密码|密钥|秘钥|password|passwd|secret|token|api[_-]?key|凭证|敏感/i;

function maskSensitive(key: string, value: string): string {
  if (!value) return value;
  if (SENSITIVE_KEY_PATTERN.test(key)) return '***（已脱敏）';
  return value;
}

/**
 * 群消息总长兜底截断 — 主表字段多 / 子表汇总字段大时，
 * 累计可能超飞书 IM 文本上限（~30K），保留前缀 + 提示尾部。
 */
function clampReply(s: string): string {
  if (s.length <= REPLY_TOTAL_MAX_LEN) return s;
  return `${s.slice(0, REPLY_TOTAL_MAX_LEN)}\n\n…（消息过长已截断，详见多维表）`;
}

/**
 * 单字段展示截断，避免长文本（如发版步骤、备注）撑爆群消息且污染 LLM 上下文。
 * 仅用于面向用户的最终输出，不影响内部值传递。
 */
function truncateForDisplay(s: string): string {
  if (s.length <= FIELD_DISPLAY_MAX_LEN) return s;
  return `${s.slice(0, FIELD_DISPLAY_MAX_LEN)}…（已截断，共 ${s.length} 字，详见多维表）`;
}

/**
 * 内部递归版本：把飞书多维表格等平台返回的复杂字段值转为字符串，不做截断。
 * 给数组/对象内部展开使用。
 */
function fieldToStringRaw(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    if (v >= DATE_MS_MIN && v <= DATE_MS_MAX) {
      return new Date(v).toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    return String(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item != null && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj.text === 'string') return obj.text;
          if (typeof obj.name === 'string') return obj.name;
          return fieldToStringRaw(item);
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
      return fieldToStringRaw(obj.value);
    }
    return JSON.stringify(v);
  }
  return String(v);
}

/** 面向用户输出的字段转字符串：含长文本截断 */
function fieldToString(v: unknown): string {
  return truncateForDisplay(fieldToStringRaw(v));
}

/** 面向用户输出 + 敏感字段脱敏，按字段名启发式匹配 */
function maskedFieldToString(key: string, v: unknown): string {
  return maskSensitive(key, fieldToString(v));
}

function applyFieldVars(tpl: string, fields: Record<string, unknown>): string {
  return tpl
    .split('\n')
    .flatMap((line) => {
      let hasPlaceholder = false;
      let allEmpty = true;
      const substituted = line.replace(
        /\$\{fields\.([^}]+)\}/g,
        (_, key: string) => {
          hasPlaceholder = true;
          const val = maskedFieldToString(key, fields[key] ?? '');
          if (val) allEmpty = false;
          return val;
        },
      );
      // 行内所有占位符都为空时整行隐藏（兼容"标签：${fields.x} 元"带单位后缀的情况）
      if (hasPlaceholder && allEmpty) return [];
      return [substituted];
    })
    .join('\n');
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
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: 字面占位符，由 replaceAll 在 runtime 替换为上下文值
    return this.systemPrompt
      .replaceAll('${today}', ctx.today)
      .replaceAll('${senderName}', ctx.senderName)
      .replaceAll('${chatName}', ctx.chatName ?? '');
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end
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
    } catch (err) {
      console.warn(
        '[DbScene] parseResult JSON 解析失败:',
        err,
        '原始JSON:',
        json.slice(0, 500),
      );
      return null;
    }
  }

  formatReply(intent: ParsedIntent, result: ExecuteResult): string {
    if (!result.success) return `❌ 操作失败: ${result.error ?? '未知错误'}`;

    // 有自定义回复模板时使用模板
    if (this.replyTemplate) {
      return clampReply(this.applyReplyTemplate(intent, result));
    }

    // 通用默认格式
    if (intent.intent === 'CREATE' && result.record) {
      const entries = Object.entries(result.record.fields)
        .map(([k, v]) => [k, maskedFieldToString(k, v)] as const)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}：${v}`);
      return clampReply(`✅ 已录入${this.name}\n\n${entries.join('\n')}`);
    }

    if (intent.intent === 'QUERY' && result.records) {
      if (result.records.length === 0)
        return `📊 查询结果: 未找到匹配的${this.name}`;
      const DISPLAY_LIMIT = 10;
      const displayed = result.records.slice(0, DISPLAY_LIMIT);
      const items = displayed.map((r, i) => {
        const lines = Object.entries(r.fields)
          .map(([k, v]) => [k, maskedFieldToString(k, v)] as const)
          .filter(([, v]) => v !== '')
          .map(([k, v]) => `  ${k}：${v}`);
        const header =
          (result.records?.length ?? 0) > 1 ? `【第 ${i + 1} 条】\n` : '';
        return `${header}${lines.join('\n')}`;
      });
      const truncated =
        result.records.length > DISPLAY_LIMIT
          ? `\n…（共 ${result.records.length} 条，仅展示前 ${DISPLAY_LIMIT} 条）`
          : '';
      return clampReply(
        `📊 查询结果 (共 ${result.records.length} 条)\n\n${items.join('\n\n')}${truncated}`,
      );
    }

    if (intent.intent === 'UPDATE') return `✅ 已更新${this.name}`;
    if (intent.intent === 'DELETE') return `✅ 已删除${this.name}`;
    return '✅ 操作完成';
  }

  /**
   * 模板引擎：
   * - 全局变量：${intent} ${summary} ${count} ${sceneName}
   * - 单字段：${fields.xxx}（CREATE/UPDATE 取当条记录，QUERY 在 each 块内使用）
   * - 查询循环：<!--each-->...<!--/each--> 对每条记录展开，多条时自动加【第N条】序号
   * - 兼容旧变量：${fieldList}（输出所有字段的 key：value 列表）
   */
  private applyReplyTemplate(
    intent: ParsedIntent,
    result: ExecuteResult,
  ): string {
    if (!this.replyTemplate) return '✅ 操作完成';

    const records = result.records ?? (result.record ? [result.record] : []);
    const firstFields = records[0]?.fields ?? {};

    const fieldList = Object.entries(firstFields)
      .map(([k, v]) => [k, maskedFieldToString(k, v)] as const)
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}：${v}`)
      .join('\n');

    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: 字面占位符，runtime 替换
    let tpl = this.replyTemplate
      .replaceAll('${intent}', intent.intent)
      .replaceAll('${summary}', intent.summary)
      .replaceAll('${fieldList}', fieldList)
      .replaceAll('${count}', String(records.length))
      .replaceAll('${sceneName}', this.name);
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end

    // <!--each-->...<!--/each--> 循环块
    const eachMatch = tpl.match(/<!--each-->([\s\S]*?)<!--\/each-->/);
    if (eachMatch) {
      const rowTpl = eachMatch[1] ?? '';
      const rows = records.map((r, i) => {
        const prefix = records.length > 1 ? `【第 ${i + 1} 条】\n` : '';
        return prefix + applyFieldVars(rowTpl, r.fields);
      });
      const joined = rows.join('\n');
      tpl = tpl.replace(/<!--each-->[\s\S]*?<!--\/each-->/, () => joined);
    } else {
      // 无 each 块时直接对第一条记录展开（CREATE/UPDATE）
      tpl = applyFieldVars(tpl, firstFields);
    }

    return tpl.trim();
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
