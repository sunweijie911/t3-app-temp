import type { BotWriteMode } from '../constants';
import {
  clampReply,
  fieldMeta,
  fieldToString,
  maskSensitive,
  primaryKeyOf,
  renderFieldEntry,
  truncateForDisplay,
} from '../core/field-render';
import { renderResourceSchema } from '../core/schema-prompt';
import type {
  AggregateSpec,
  ExecuteResult,
  FieldMappingValue,
  ParsedIntent,
  SceneChatAccess,
  SceneContext,
  WriteDenialReason,
} from '../core/types';
import { AGGREGATE_OPS, INTENT_VERBS } from '../core/types';
import type { BotScene } from './types';

/**
 * 统计结果的数字格式化。
 *
 * 平均值这类除法会带一串浮点残留（26.612000000000023），直接 String()
 * 丢进群里很难看；整数保持原样不加小数点。
 */
function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return String(Number.parseFloat(v.toPrecision(12)));
}

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

/**
 * 只接受普通对象，其余（字符串 / 数组 / 数字）一律丢弃。
 *
 * fields 与 filters 下游全靠 `Object.entries()` 遍历，而 LLM 偶尔会把它们
 * 写成标量或数组。字符串会被拆成**逐字符的下标键**：
 * `fields: "督导2.0"` → `{0:'督',1:'导',2:'2',3:'.',4:'0'}`。
 * 后果实测过两种，都不是报错而是更坏的形式：
 * - 绑定没配 fieldMapping（代码显式支持的"整体透传"）时，这些下标键会被
 *   当成真实列名写进平台，用户收到的却是一句"✅ 已录入"
 * - filters 侧的下标键能骗过 UPDATE / DELETE 的判空守卫
 *   （`hasEffectiveFilters` 看到键 '0'、值 '全' 就认为用户指定了条件）
 *
 * 丢掉之后 fields 为空 → "没有解析出要写入的字段"，filters 为空 →
 * "删除操作需要指定筛选条件"，两条都是能照着改的提示。
 */
/**
 * 解析 LLM 给出的聚合请求。op 不在白名单里就整个丢掉 ——
 * 让 AGGREGATE 落到"没有聚合请求"的报错分支，比拿一个猜的算子去算钱要好。
 */
function asAggregate(v: unknown): AggregateSpec | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const op = typeof o.op === 'string' ? o.op.toLowerCase() : '';
  if (!(AGGREGATE_OPS as readonly string[]).includes(op)) return undefined;
  const field = typeof o.field === 'string' && o.field ? o.field : undefined;
  const groupBy =
    typeof o.groupBy === 'string' && o.groupBy ? o.groupBy : undefined;
  return { op: op as AggregateSpec['op'], field, groupBy };
}

function asFieldRecord(v: unknown): Record<string, unknown> | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

export interface DbSceneConfig {
  sceneId: string;
  name: string;
  description: string;
  keywords: string[];
  systemPrompt: string;
  replyTemplate?: string;
  /** 允许触发的会话及其读写权限；空 = 不限制会话 */
  allowedChats?: SceneChatAccess[];
  /** 写入模式。缺省 'open' */
  writeMode?: BotWriteMode;
  /** writeMode='whitelist' 时生效的用户白名单 */
  writerIds?: string[];
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
  private allowedChats: SceneChatAccess[];
  private writeMode: BotWriteMode;
  private writerIds: string[];

  constructor(config: DbSceneConfig) {
    this.id = config.sceneId;
    this.name = config.name;
    this.description = config.description ?? '';
    this.keywords = config.keywords;
    this.systemPrompt = config.systemPrompt;
    this.replyTemplate = config.replyTemplate;
    this.allowedChats = config.allowedChats ?? [];
    this.writeMode = config.writeMode ?? 'open';
    this.writerIds = config.writerIds ?? [];
  }

  /** 空名单 = 不限制会话。非空时只有名单内的会话能看到这个场景 */
  allowsChat(chatId: string): boolean {
    return this.allowedChats.length === 0
      ? true
      : this.allowedChats.some((c) => c.chatId === chatId);
  }

  /**
   * 写权限判定。会话维度与用户维度是**与**关系。
   *
   * 顺序刻意先判场景、再判会话、最后判用户 —— 拒绝原因的"作用范围"
   * 由大到小，用户看到的是最能解释现状的那一条：一个只读场景里，
   * 告诉用户"你不在白名单里"是误导（加了白名单也照样不能写）。
   */
  writeDenial(senderId: string, chatId: string): WriteDenialReason | null {
    if (this.writeMode === 'readonly') return 'scene_readonly';

    // 会话没被限制（空名单）时不存在会话级只读
    const chat = this.allowedChats.find((c) => c.chatId === chatId);
    if (chat && !chat.canWrite) return 'chat_readonly';

    if (this.writeMode === 'whitelist' && !this.writerIds.includes(senderId)) {
      return 'user_not_writer';
    }
    return null;
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
      const fields = asFieldRecord(obj.fields);
      const filters = asFieldRecord(obj.filters);
      if (obj.fields !== undefined && !fields) {
        console.warn(
          '[DbScene] fields 不是对象，已丢弃:',
          JSON.stringify(obj.fields).slice(0, 200),
        );
      }
      if (obj.filters !== undefined && !filters) {
        console.warn(
          '[DbScene] filters 不是对象，已丢弃:',
          JSON.stringify(obj.filters).slice(0, 200),
        );
      }
      return {
        intent: intent as ParsedIntent['intent'],
        resource: resource || undefined,
        fields: fields ?? {},
        filters,
        aggregate: asAggregate(obj.aggregate),
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

    // ── 文档能力 ───────────────────────────────────────────
    // 必须排在 replyTemplate 之前：模板的变量全是表格取向的
    // （${fields.xxx} / ${count} / each 块），文档结果里 records 为空，
    // 套模板的结果是正文全丢、${count} 渲染成 0 —— 一场景同时绑表和
    // 文档时（这正是多资源的典型用法）文档读取直接不可用。
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

    // ── 聚合能力 ───────────────────────────────────────────
    // 同样排在 replyTemplate 之前：模板的变量是明细取向的
    // （${fields.xxx} / each 块），聚合结果里没有 records，套模板会全渲染成空
    if (result.aggregate) {
      return clampReply(this.formatAggregate(result));
    }

    // 有自定义回复模板时使用模板（表格结果专用）
    if (this.replyTemplate) {
      return clampReply(this.applyReplyTemplate(intent, result, fieldMapping));
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

      // 拉取撞上 adapter 的翻页硬上限，说明真实匹配可能更多、被静默截断了。
      //
      // 这里**不能**把 records.length 当成"上限"报出来：截断由 adapter 上报，
      // 而钉钉/企微的截断发生在内存过滤之前，过滤后可能只剩 3 条 ——
      // 会渲染成"已达单次查询上限 3 条"这种自相矛盾的话。上限值各平台不同、
      // 也没必要让用户知道，说清"结果可能不全 + 怎么办"就够了。
      const limitHint = result.hitQueryLimit
        ? '\n\n⚠️ 数据量已达单次拉取上限，结果可能不完整，请缩窄筛选条件'
        : '';

      // 投影模式：LLM 标记了 projectFields → 只渲染主标识 + 指定列，
      // 避免对大表（20 字段）查询时一次性刷屏
      const project = intent.projectFields ?? [];
      if (project.length > 0) {
        const DISPLAY_LIMIT = 20; // 投影模式更紧凑，可多显示几条
        const displayed = result.records.slice(0, DISPLAY_LIMIT);
        // 主标识：优先取显式声明 primary 的字段。
        // 不能"取记录第一个非空字段"——fieldMapping 存 jsonb，键序被
        // Postgres 重排过，实测会把公式列「利润」当成标识，渲染出
        // 「-108 → 商品名称：…」这种前后颠倒的行。
        const primary = primaryKeyOf(fieldMapping);
        const lines = displayed.map((r) => {
          const labelKey =
            primary && !project.includes(primary) && r.fields[primary]
              ? primary
              : // 退化路径：跳过数字/日期列，它们几乎不可能是名称类标识
                Object.keys(r.fields).find((k) => {
                  if (project.includes(k)) return false;
                  const v = r.fields[k];
                  if (v == null || v === '') return false;
                  const { displayType } = fieldMeta(k, fieldMapping);
                  return displayType !== 'number' && displayType !== 'date';
                });
          const labelStr = labelKey
            ? renderFieldEntry(labelKey, r.fields[labelKey], fieldMapping)
                .display
            : '';
          const cols = project
            .map((f) => renderFieldEntry(f, r.fields[f] ?? '', fieldMapping))
            .filter((e) => e.display !== '')
            .map((e) => `${e.label}：${e.display}`)
            .join('  ');
          return labelStr ? `${labelStr} → ${cols || '（该字段为空）'}` : cols;
        });

        // 单条单字段：最干净的一句话回复。
        // limitHint 必须带上 —— 这条路径以前直接 return，把截断警告丢了，
        // 而"单值答案"恰恰是最容易被当成权威结论的形态（"本月总额是多少"）：
        // 拉取被截断时给出的是一个静默不完整的数字。
        if (result.records.length === 1 && project.length === 1) {
          return clampReply(`📊 ${lines[0]}${limitHint}`);
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

  /** 聚合结果渲染 */
  private formatAggregate(result: ExecuteResult): string {
    const agg = result.aggregate;
    if (!agg) return '✅ 操作完成';
    const OP_LABELS: Record<string, string> = {
      sum: '合计',
      count: '条数',
      avg: '平均',
      min: '最小',
      max: '最大',
    };
    const opLabel = OP_LABELS[agg.op] ?? agg.op;
    const subject = agg.op === 'count' ? '记录' : (agg.field ?? '');

    // 截断对聚合是**致命**的：拉取不全意味着算出来的数字直接是错的，
    // 而它看上去和正确答案一模一样。所以这里的措辞比 QUERY 侧重得多，
    // 且放在最前面 —— 放末尾容易被当成免责声明忽略掉。
    const warning = result.hitQueryLimit
      ? '⚠️ 数据量超过单次拉取上限，**下面的数字是不完整的**，请缩小范围（如按月/按分类）后重新统计\n\n'
      : '';
    const skipped = agg.skipped
      ? `\n（有 ${agg.skipped} 条记录的「${agg.field}」为空或不是数字，未计入）`
      : '';

    if (agg.groups) {
      if (agg.groups.length === 0) {
        return `${warning}📊 没有符合条件的${this.name}`;
      }
      const GROUP_LIMIT = 20;
      const shown = agg.groups.slice(0, GROUP_LIMIT);
      const lines = shown.map(
        (g, i) =>
          `${i + 1}. ${g.key}：${formatNumber(g.value)}（${g.count} 条）`,
      );
      const rest =
        agg.groups.length > shown.length
          ? `\n…（共 ${agg.groups.length} 组，仅展示前 ${GROUP_LIMIT} 组）`
          : '';
      const total =
        agg.op === 'sum' || agg.op === 'count'
          ? `\n\n总${opLabel}：${formatNumber(agg.groups.reduce((a, g) => a + g.value, 0))}`
          : '';
      return `${warning}📊 按「${agg.groupBy}」${opLabel}${subject ? `「${subject}」` : ''}\n${lines.join('\n')}${rest}${total}${skipped}`;
    }

    if (agg.value === undefined) {
      return `${warning}📊 没有符合条件的${this.name}`;
    }
    return `${warning}📊 ${subject ? `「${subject}」` : ''}${opLabel}：${formatNumber(agg.value)}（共 ${agg.recordCount} 条记录）${skipped}`;
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
