import {
  clampReply,
  fieldMeta,
  fieldToString,
  maskSensitive,
  renderFieldEntry,
  truncateForDisplay,
} from '../core/field-render';
import { renderResourceSchema } from '../core/schema-prompt';
import type {
  ExecuteResult,
  FieldMappingValue,
  ParsedIntent,
  SceneContext,
} from '../core/types';
import { INTENT_VERBS } from '../core/types';
import type { BotScene } from './types';

function applyFieldVars(
  tpl: string,
  fields: Record<string, unknown>,
  fieldMapping?: Record<string, FieldMappingValue>,
): string {
  return tpl
    .split('\n')
    .flatMap((line) => {
      let hasPlaceholder = false;
      let allEmpty = true;
      const substituted = line.replace(
        /\$\{fields\.([^}]+)\}/g,
        (_, key: string) => {
          hasPlaceholder = true;
          const { sensitive, displayType } = fieldMeta(key, fieldMapping);
          const val = maskSensitive(
            key,
            fieldToString(fields[key] ?? '', displayType),
            sensitive,
          );
          if (val) allEmpty = false;
          return val;
        },
      );
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

  /**
   * 关键词命中打分。用「命中个数」而非「命中率」：
   * 以前是 matched.length / keywords.length，配了 10 个关键词的场景命中 1 个只有 0.1，
   * 反而输给只配 1 个关键词的场景 —— 关键词配得越全越难被选中，跨场景比较不公平。
   */
  match(content: string): number {
    if (this.keywords.length === 0) return 0;
    return this.keywords.filter((kw) => content.includes(kw)).length;
  }

  getSystemPrompt(ctx: SceneContext): string {
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: 字面占位符，由 replaceAll 在 runtime 替换为上下文值
    const base = this.systemPrompt
      .replaceAll('${today}', ctx.today)
      .replaceAll('${senderName}', ctx.senderName)
      .replaceAll('${chatName}', ctx.chatName ?? '');
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end

    // 字段清单由绑定自动生成并追加，管理员的 prompt 只需要写业务规则。
    // 没有 resources（老调用方、未配绑定）时行为与之前完全一致
    const schema = renderResourceSchema(ctx.resources ?? []);
    return schema ? `${base}\n\n${schema}` : base;
  }

  parseResult(json: string): ParsedIntent | null {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      const intent = obj.intent as string;
      if (!(INTENT_VERBS as readonly string[]).includes(intent)) return null;
      const rawProject = obj.projectFields;
      const projectFields = Array.isArray(rawProject)
        ? (rawProject as unknown[]).filter(
            (s): s is string => typeof s === 'string' && s.length > 0,
          )
        : undefined;
      const resource =
        typeof obj.resource === 'string' ? obj.resource : undefined;
      return {
        intent: intent as ParsedIntent['intent'],
        resource: resource || undefined,
        fields: (obj.fields as Record<string, unknown>) ?? {},
        filters: (obj.filters as Record<string, unknown>) ?? undefined,
        projectFields:
          projectFields && projectFields.length > 0 ? projectFields : undefined,
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

  formatReply(
    intent: ParsedIntent,
    result: ExecuteResult,
    fieldMapping?: Record<string, FieldMappingValue>,
  ): string {
    // 失败分支同样要 clamp：dispatcher 的候选列表 / 确认提示走的就是 result.error，
    // 不截断会拼出超长文本，导致 IM 侧发送失败、用户一条回复都收不到
    if (!result.success) {
      // 二次确认不是失败：DELETE 确认、单条 UPDATE 确认、uniqueKey 撞车、
      // 多条命中选序号四条路径都走 success=false + error 承载提示文案，
      // 统一加「❌ 操作失败」前缀会把设计正路显示成报错，用户以为操作没成功。
      // （审计日志侧已按 awaitingConfirmation 记 pending，这里补上用户可见的一半）
      if (result.awaitingConfirmation) {
        return clampReply(`⏳ ${result.error ?? '请确认后继续'}`);
      }
      return clampReply(`❌ 操作失败: ${result.error ?? '未知错误'}`);
    }

    // 有自定义回复模板时使用模板
    if (this.replyTemplate) {
      return clampReply(this.applyReplyTemplate(intent, result, fieldMapping));
    }

    // ── 文档能力 ───────────────────────────────────────────
    if (result.doc) {
      const { title, text, url } = result.doc;
      const link = url ? `\n🔗 ${url}` : '';
      if (intent.intent === 'APPEND') {
        const written = truncateForDisplay(result.appendedText ?? text);
        return clampReply(`✅ 已写入《${title}》\n\n${written}${link}`);
      }
      // READ / QUERY：正文可能很长，按群消息上限截断
      const body = text.trim() || '(文档为空)';
      return clampReply(`📄 《${title}》\n\n${body}${link}`);
    }

    // 通用默认格式
    if (intent.intent === 'CREATE' && result.record) {
      const entries = Object.entries(result.record.fields)
        .map(([k, v]) => renderFieldEntry(k, v, fieldMapping))
        .filter((e) => e.display !== '')
        .map((e) => `${e.label}：${e.display}`);
      return clampReply(`✅ 已录入${this.name}\n\n${entries.join('\n')}`);
    }

    if (intent.intent === 'QUERY' && result.records) {
      if (result.records.length === 0)
        return `📊 查询结果: 未找到匹配的${this.name}`;

      // 命中 adapter 的翻页硬上限说明真实匹配可能更多、被静默截断了，
      // 提示用户缩窄条件。上限各平台不同，由 adapter 声明后经 ExecuteResult 传过来
      const limitHint = result.hitQueryLimit
        ? `\n\n⚠️ 已达单次查询上限 ${result.records.length} 条，可能还有未展示的数据，请缩窄筛选条件`
        : '';

      // 投影模式：LLM 标记了 projectFields → 只渲染主标识 + 指定列，
      // 避免对大表（20 字段）查询时一次性刷屏
      const project = intent.projectFields ?? [];
      if (project.length > 0) {
        const DISPLAY_LIMIT = 20; // 投影模式更紧凑，可多显示几条
        const displayed = result.records.slice(0, DISPLAY_LIMIT);
        const lines = displayed.map((r) => {
          // 主标识：取记录第一个非空字段（fieldMapping 第一列通常是名称类）
          const labelEntry = Object.entries(r.fields).find(
            ([k, v]) => !project.includes(k) && v != null && v !== '',
          );
          const labelStr = labelEntry
            ? renderFieldEntry(labelEntry[0], labelEntry[1], fieldMapping)
                .display
            : '';
          const cols = project
            .map((f) => renderFieldEntry(f, r.fields[f] ?? '', fieldMapping))
            .filter((e) => e.display !== '')
            .map((e) => `${e.label}：${e.display}`)
            .join('  ');
          return labelStr ? `${labelStr} → ${cols || '（该字段为空）'}` : cols;
        });

        // 单条单字段：最干净的一句话回复
        if (result.records.length === 1 && project.length === 1) {
          return clampReply(`📊 ${lines[0]}`);
        }
        // 多条：列表
        const truncated =
          result.records.length > DISPLAY_LIMIT
            ? `\n…（共 ${result.records.length} 条，仅展示前 ${DISPLAY_LIMIT} 条）`
            : '';
        const numbered =
          result.records.length > 1
            ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
            : lines.join('\n');
        return clampReply(
          `📊 共 ${result.records.length} 条\n${numbered}${truncated}${limitHint}`,
        );
      }

      const DISPLAY_LIMIT = 10;
      const displayed = result.records.slice(0, DISPLAY_LIMIT);
      const items = displayed.map((r, i) => {
        const lines = Object.entries(r.fields)
          .map(([k, v]) => renderFieldEntry(k, v, fieldMapping))
          .filter((e) => e.display !== '')
          .map((e) => `  ${e.label}：${e.display}`);
        const header =
          (result.records?.length ?? 0) > 1 ? `【第 ${i + 1} 条】\n` : '';
        return `${header}${lines.join('\n')}`;
      });
      const truncated =
        result.records.length > DISPLAY_LIMIT
          ? `\n…（共 ${result.records.length} 条，仅展示前 ${DISPLAY_LIMIT} 条）`
          : '';
      return clampReply(
        `📊 查询结果 (共 ${result.records.length} 条)\n\n${items.join('\n\n')}${truncated}${limitHint}`,
      );
    }

    if (intent.intent === 'UPDATE') {
      // 复用 CREATE 的字段渲染，让用户看清楚更新后的实际值
      if (result.record) {
        const entries = Object.entries(result.record.fields)
          .map(([k, v]) => renderFieldEntry(k, v, fieldMapping))
          .filter((e) => e.display !== '')
          .map((e) => `${e.label}：${e.display}`);
        if (entries.length > 0) {
          return clampReply(`✅ 已更新${this.name}\n\n${entries.join('\n')}`);
        }
      }
      return `✅ 已更新${this.name}`;
    }
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
    fieldMapping?: Record<string, FieldMappingValue>,
  ): string {
    if (!this.replyTemplate) return '✅ 操作完成';

    const records = result.records ?? (result.record ? [result.record] : []);
    const firstFields = records[0]?.fields ?? {};

    const fieldList = Object.entries(firstFields)
      .map(([k, v]) => renderFieldEntry(k, v, fieldMapping))
      .filter((e) => e.display !== '')
      .map((e) => `${e.label}：${e.display}`)
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
        return prefix + applyFieldVars(rowTpl, r.fields, fieldMapping);
      });
      const joined = rows.join('\n');
      tpl = tpl.replace(/<!--each-->[\s\S]*?<!--\/each-->/, () => joined);
    } else {
      // 无 each 块时直接对第一条记录展开（CREATE/UPDATE）
      tpl = applyFieldVars(tpl, firstFields, fieldMapping);
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
