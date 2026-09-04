import type { ChannelAdapter } from '../channels/types';
import {
  CONFIDENCE_THRESHOLD,
  DESTRUCTIVE_CONCURRENCY,
  MAX_CANDIDATE_DISPLAY,
  MAX_DESTRUCTIVE_BATCH,
  MAX_LLM_ATTEMPTS,
  RATE_LIMIT_MAX,
} from '../constants';
import { documentConfigOf, getDocumentAdapter } from '../documents/factory';
import type { BotScene } from '../scenes/types';
import { getSpreadsheetAdapter } from '../spreadsheets/factory';
import type { SpreadsheetAdapter } from '../spreadsheets/types';
import { MemoryDedupStore } from './dedup';
import {
  DEFAULT_REPLY_BUDGET_BYTES,
  fieldToStringRaw,
  fitCountByBytes,
  renderRecordSummary,
  utf8ByteLength,
} from './field-render';
import { chatCompletion, extractJson, type RetryContext } from './llm';
import { MemoryPendingActionStore } from './pending-action';
import { MemoryRateLimitStore } from './rate-limit';
import { SceneRegistry } from './scene-registry';
import type { DedupStore, PendingActionStore, RateLimitStore } from './stores';
import { pendingKeyOf } from './stores';
import type {
  AggregateOp,
  AggregateResult,
  AggregateSpec,
  BotEvent,
  ExecuteResult,
  FieldMappingValue,
  ParsedIntent,
  PendingAction,
  ResourceBinding,
  SceneContext,
  SceneResource,
  SpreadsheetRecord,
  SpreadsheetTableConfig,
  UnifiedMessage,
  WriteDenialReason,
} from './types';
import {
  ACTIONS_BY_KIND,
  isWriteIntent,
  sceneResourceOf,
  tableConfigOf,
} from './types';

interface DispatcherConfig {
  /**
   * 解析场景绑定的资源。`alias` 省略时返回该场景的默认资源。
   *
   * 注意签名里**没有 platform** —— 数据在哪个平台由绑定自己的 provider 决定，
   * 与消息来自哪个 IM 无关。以前是 getTableConfig(sceneId, msg.platform)。
   */
  getBinding: (sceneId: string, alias?: string) => ResourceBinding | null;
  /**
   * 列出场景的**全部**绑定，用于把字段清单注入 prompt。
   * 省略时退化为只用默认资源 —— 单资源场景行为不变。
   */
  listBindings?: (sceneId: string) => ResourceBinding[];
  /**
   * 审计事件回调。允许返回 Promise —— dispatcher 会 await：
   * 整个 process 跑在 Next 的 after() 里，游离的 fire-and-forget 写库
   * 会在 after 回调 resolve 时被冻结掉，serverless 上表现为日志随机丢失。
   */
  onEvent?: (event: BotEvent) => void | Promise<void>;
  /**
   * 幂等与待确认状态的存储。默认是进程内实现，**只适合单实例和测试**；
   * 多实例部署必须注入 DB 实现，否则平台重试会重复写数据、
   * 用户的"确认删除"可能落到查不到 pending 的实例上。
   */
  dedupStore?: DedupStore;
  pendingStore?: PendingActionStore;
  /**
   * 限流存储。默认进程内实现，多实例下实际放行量是配额 × 实例数，
   * 生产环境注入 DbRateLimitStore。
   */
  rateLimitStore?: RateLimitStore;
}

/** 该筛选项是否构成一个真正的条件 */
function isEffectiveFilter(key: string, value: unknown): boolean {
  // `_` 开头是协议保留键（如 _conjunction），下游 queryRecords 会跳过，
  // 不能算作用户指定的筛选条件
  if (key.startsWith('_')) return false;
  // 空数组同理无效：展开成 0 个条件后在飞书侧等于「没有这个筛选项」，
  // 在内存过滤侧等于「命中任一（无候选）」= 空集。留着它会让
  // UPDATE/DELETE 的判空守卫误以为有条件，却拿不到任何真实约束。
  if (Array.isArray(value)) return value.length > 0;
  // 值为空/通配也算无效：LLM 经常拿空串占位，下发后会生成 `is ['']` 条件
  return value != null && value !== '' && value !== '*';
}

/**
 * 剔除无效筛选项，保留协议保留键。
 *
 * 只做判空是不够的：无效项仍留在传给 adapter 的对象里，
 * `{状态: '', 项目名称: 'X'}` 会真的下发 `状态 is [''] AND 项目名称 is ['X']`，
 * 结果恒为空 —— 用户看到"未找到匹配记录"，而记录明明存在。
 */
function stripIneffectiveFilters(
  filters: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key.startsWith('_') || isEffectiveFilter(key, value)) out[key] = value;
  }
  return out;
}

/**
 * 是否还剩下有效筛选键。用于 UPDATE/DELETE 的空值守卫 ——
 * 防止 `{_conjunction:'or'}` 这类只有保留键的 filters 绕过判空命中全表。
 */
function hasEffectiveFilters(
  filters: Record<string, unknown> | null | undefined,
): boolean {
  if (!filters) return false;
  return Object.entries(filters).some(([k, v]) => isEffectiveFilter(k, v));
}

/**
 * fieldMapping 里表示「操作人」的约定逻辑键，按顺序取第一个命中的。
 *
 * 以前只认字面的 `operator`，而 admin 的字段选择器生成的逻辑键
 * 就是平台字段名本身（中文居多），于是这条注入实际上从不触发 ——
 * 表里明明有「录入人」列，机器人却从来不写。
 */
const OPERATOR_FIELD_KEYS = [
  'operator',
  '操作人',
  '录入人',
  '提交人',
  '填写人',
  '记录人',
] as const;

function resolveOperatorKey(
  fieldMapping: Record<string, FieldMappingValue>,
): string | null {
  return OPERATOR_FIELD_KEYS.find((k) => k in fieldMapping) ?? null;
}

/**
 * 按 fieldMapping 白名单切分 LLM 产出的字段。
 *
 * LLM 幻觉出一个表里没有的字段时，adapter 会用原名把它透传给平台
 * （`fieldMapping[key] ?? key`），飞书直接回 InvalidFieldName —— **整条写入失败**，
 * 用户只看到一句笼统的报错。写入侧丢掉未知字段并回显，比整条失败可用得多。
 *
 * 绑定没配 fieldMapping 时整体透传，否则等于把这条绑定的写入全禁掉。
 *
 * @param keepReserved `_` 开头的保留键（如 `_conjunction`）是否原样带过。
 *   **只有 filters 桶该开**：写入侧带过去的话，三个 adapter 都会把它当平台
 *   列名下发，飞书回 InvalidFieldName、整条写入失败 —— 正是这个守卫要防的
 *   那类失败。写入侧直接静默丢弃，也不计入 unknownKeys（协议键不是用户
 *   说的字段，报「已忽略未配置的字段：_conjunction」只会让人困惑）。
 */
function splitByMapping(
  input: Record<string, unknown>,
  fieldMapping: Record<string, FieldMappingValue>,
  keepReserved = false,
): { known: Record<string, unknown>; unknownKeys: string[] } {
  const known: Record<string, unknown> = {};
  const unknownKeys: string[] = [];
  const hasMapping = Object.keys(fieldMapping).length > 0;
  for (const [k, v] of Object.entries(input)) {
    if (k.startsWith('_')) {
      if (keepReserved) known[k] = v;
      continue;
    }
    if (!hasMapping || k in fieldMapping) {
      known[k] = v;
      continue;
    }
    unknownKeys.push(k);
  }
  return { known, unknownKeys };
}

/**
 * 筛选值 → 它会生成的操作符（审计用，与 adapter 的实际映射保持大意一致）。
 */
function operatorOf(value: unknown): string {
  if (Array.isArray(value)) return 'contains[]';
  if (value !== null && typeof value === 'object') {
    const op = (value as { op?: unknown }).op;
    return typeof op === 'string' ? op : 'is';
  }
  return 'is';
}

/**
 * 审计日志里的**请求**摘要 —— LLM 到底解析出了什么。
 *
 * 只记结果不记请求的话排障会卡死：一条 QUERY 回了 99 条，从日志看不出是
 * `物流单号 isEmpty` 真的命中了全表，还是 filters 被解析成空导致的全表扫描。
 * confidence 同理，以前只在"置信度不足"时以 errorMsg 出现，通过的那些看不到。
 *
 * 只记「键 + 操作符」，不记筛选值与写入值：值本来就在 content 列里（用户原话），
 * 再存一份等于把同样内容多落一遍，还绕过了 sensitive 标记。
 * `_` 开头的协议保留键记值本身（'or' / 'and' 不是用户数据）。
 */
function summarizeRequest(parsed: ParsedIntent): Record<string, unknown> {
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.filters ?? {})) {
    filters[key] = key.startsWith('_') ? String(value) : operatorOf(value);
  }
  const fieldKeys = Object.keys(parsed.fields);
  return {
    confidence: parsed.confidence,
    ...(parsed.resource ? { resource: parsed.resource } : {}),
    filters,
    ...(fieldKeys.length > 0 ? { fieldKeys } : {}),
    ...(parsed.projectFields?.length
      ? { projectFields: parsed.projectFields }
      : {}),
    // 聚合请求必须留痕。实测踩过：「这个月毛利合计」记成了一条 success，
    // 而「毛利」根本不是表里的字段 —— 从日志完全看不出它到底算了哪一列。
    // 偏偏这个能力的核心风险就是「错的数字和对的数字长得一模一样」，
    // 缺了 op / field / groupBy，事后没有任何办法核查一个金额。
    ...(parsed.aggregate
      ? {
          aggregate: {
            op: parsed.aggregate.op,
            ...(parsed.aggregate.field
              ? { field: parsed.aggregate.field }
              : {}),
            ...(parsed.aggregate.groupBy
              ? { groupBy: parsed.aggregate.groupBy }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * 审计日志里的执行结果摘要。
 *
 * 以前直接把整个 ExecuteResult 塞进 jsonb：一次 QUERY 能带上千条记录的
 * **字段原文**进库，既撑爆日志表，也等于把数据明文落了一份 ——
 * 脱敏只作用于 IM 回复层，日志表里没有那道关。
 * 排查需要的是「做了什么、影响了几条」，不是记录内容本身。
 */
function summarizeResult(result: ExecuteResult): Record<string, unknown> {
  const MAX_LOGGED_IDS = 50;
  return {
    success: result.success,
    ...(result.awaitingConfirmation ? { awaitingConfirmation: true } : {}),
    ...(result.record ? { recordId: result.record.recordId } : {}),
    ...(result.records
      ? {
          recordCount: result.records.length,
          recordIds: result.records
            .slice(0, MAX_LOGGED_IDS)
            .map((r) => r.recordId),
        }
      : {}),
    ...(result.doc
      ? { docTitle: result.doc.title, docTextLength: result.doc.text.length }
      : {}),
    ...(result.appendedText
      ? { appendedLength: result.appendedText.length }
      : {}),
    ...(result.droppedFields?.length
      ? { droppedFields: result.droppedFields }
      : {}),
    // 算出来的值本身要记 —— 不记就无法回答"上周那个 12345 是怎么来的"。
    // 但**不记分组的键名**：按敏感字段分组时，键名就是该字段的值，
    // 而脱敏只作用于 IM 回复层，日志表里没有那道关。只留组数。
    ...(result.aggregate
      ? {
          aggregate: {
            op: result.aggregate.op,
            ...(result.aggregate.field
              ? { field: result.aggregate.field }
              : {}),
            ...(result.aggregate.groupBy
              ? { groupBy: result.aggregate.groupBy }
              : {}),
            recordCount: result.aggregate.recordCount,
            ...(result.aggregate.value !== undefined
              ? { value: result.aggregate.value }
              : {}),
            ...(result.aggregate.groups
              ? { groupCount: result.aggregate.groups.length }
              : {}),
            ...(result.aggregate.skipped
              ? { skipped: result.aggregate.skipped }
              : {}),
          },
        }
      : {}),
    // 确认提示里带的是已脱敏的候选摘要，仍然只留个头部够定位就行
    ...(result.error ? { error: result.error.slice(0, 200) } : {}),
  };
}

/**
 * 候选列表尾注的字节预留。
 *
 * 覆盖两段：`renderCandidateList` 自己的「共 N 条，仅列出前 M 条」（约 60 字节），
 * 以及调用方在其后追加的未列出警告（DELETE 那句最长，约 130 字节）。
 * 都是条数确定之后才拼出来的，只能按上界预估。
 */
const CANDIDATE_NOTE_RESERVE_BYTES = 220;

/**
 * 渲染候选记录列表（UPDATE 多条命中 / DELETE 确认）。
 * 必须走 renderRecordSummary —— 以前这里直接 JSON.stringify(r.fields)，
 * 既绕过 sensitive/字段名脱敏，也不做长度截断。
 */
function renderCandidateList(
  records: SpreadsheetRecord[],
  fieldMapping?: Record<string, FieldMappingValue>,
  budgetBytes: number = DEFAULT_REPLY_BUDGET_BYTES,
  /** 列表之外的提示文案（确认语、变更字段…）占掉的字节 */
  overheadBytes = 0,
): { text: string; shownCount: number } {
  const lines = records
    .slice(0, MAX_CANDIDATE_DISPLAY)
    .map((r, i) => `${i + 1}. ${renderRecordSummary(r.fields, fieldMapping)}`);
  // 候选列表尤其不能被 clampReplyBytes 从中间截断：用户要照着它选序号 /
  // 判断该不该确认删除，半行摘要没法判断。企微 2048 字节下 10 条摘要
  // 常常就超了，所以条数按预算收。
  //
  // 除了调用方传进来的 overhead，还要给两段"事后才拼出来"的文字留位置：
  // 本函数尾部的「共 N 条，仅列出前 M 条」，以及调用方在列表之后追加的
  // 那句「另有 N 条未列出，确认后将一并删除」。它们只在**条数定下来之后**
  // 才存在，不预留的话正好把最关键的一段挤出预算 —— 被 clampReplyBytes
  // 从尾部砍掉的恰恰是「回复"确认删除"执行，回复"取消"放弃」这行指令。
  const shownCount = Math.min(
    lines.length,
    fitCountByBytes(
      lines,
      budgetBytes,
      overheadBytes + CANDIDATE_NOTE_RESERVE_BYTES,
    ),
  );
  const shown = lines.slice(0, shownCount);
  const rest =
    records.length > shownCount
      ? `\n…（共 ${records.length} 条，仅列出前 ${shownCount} 条）`
      : '';
  return { text: shown.join('\n') + rest, shownCount };
}

/**
 * 待确认交互的处理结果。
 *
 * - `handled: false` —— 输入不是确认/取消/序号，调用方提示后**保留** pending
 * - `errorMsg` —— 已执行但执行出错（如批量删除部分失败）。审计日志据此记
 *   error：以前无论结果统一记 success，用户看到"已删除 0/1 条"而统计面板
 *   显示成功，错误率把真正失败的破坏性操作漏掉了
 */
interface PendingOutcome {
  handled: boolean;
  errorMsg?: string;
  /**
   * 实际执行的动作与影响范围，用于审计。
   *
   * 以前这条路径只记 `{sceneId, result}`：一次"确认删除"在日志里只剩一个
   * success，改了/删了哪条记录、改了哪些字段全都没有 —— 偏偏破坏性写操作
   * 才是最需要留痕的地方。
   */
  intent?: ParsedIntent['intent'];
  resultData?: Record<string, unknown>;
}

/**
 * 重试的判据只有一条：**失败是因为「模型把名字/形状写错了」，还是因为
 * 「用户根本没说」？**
 *
 * 前者可以重试 —— 正确答案就在 prompt 的字段清单里，把错误摆给它看就能改对。
 * 后者绝不能重试 —— 缺的信息不在模型手上，再问一遍只会让它**编**一个出来。
 * 而这些 filters / fields 紧接着要喂给 UPDATE / DELETE：编出来的筛选条件
 * 意味着去改一条用户从没指定过的记录。
 *
 * 这条界线是被测试逼出来的：一开始把「需要指定筛选条件」也算成可重试，
 * 于是「改一下项目的 node 版本」（没说哪个项目）会驱使模型自己挑一个项目名。
 */
const RETRYABLE_ERROR_PATTERNS: readonly RegExp[] = [
  // 平台协议层拒绝了这个形状（今天线上那三条就是 InvalidFilter）
  /InvalidFilter|InvalidFieldName|FieldNameNotFound|InvalidRequestParam/i,
  // 字段名不在 fieldMapping 白名单里 —— 错误文案自带「可用字段：…」，
  // 模型照着改就行。CREATE/UPDATE 的"没有可写入/可更新的内容"也走这条
  /不是「.*」里的字段/,
  /没法按它查/,
  // 区间/多值与外层连接词冲突（"无法与「或」条件混用" / "无法与其它「且」条件混用"）
  /无法与/,
  // 动词与资源类型不匹配（可用动词已在文案里列出）
  /不支持「.*」操作/,
  // resource 别名指错了，而场景下确实有别的资源可选
  /下找不到名为/,
];

/**
 * **绝不重试**，优先级高于上面的可重试判定。
 *
 * 前两组是"用户没说"，重试等于让模型替用户做决定：
 * - 「需要指定筛选条件」：没说要改/删哪条 → 重试会让它凭空挑一条
 * - 「没有解析出要…」：没说要写什么值 → 重试会让它编一个值
 *
 * 后面几组是"重试也没用"：
 * - 「未找到匹配记录」是合法的空结果，不是错误。重试只会诱导模型放宽
 *   筛选条件，而放宽 = 放大 UPDATE / DELETE 的影响面
 * - 「超过单次可操作上限」同理：模型为了让请求跑通会自己编一个更窄的
 *   条件，那是用户根本没说过的约束
 * - 配置类问题（没绑资源、适配器未实现）改 JSON 改不出来
 * - 网络 / 超时 / 鉴权不是模型的错，重试只是把延迟翻倍
 */
const NEVER_RETRY_ERROR_PATTERNS: readonly RegExp[] = [
  /需要指定筛选条件/,
  /没有解析出要/,
  // 用户没说统计哪一列。重试会让模型挑一列去算钱，而算错列的结果
  // 看上去和正确答案一模一样，没人能发现。
  // （目前不在 RETRYABLE 里所以本来也不会重试，但要写明是刻意的）
  /需要指定统计哪个字段/,
  /未找到匹配记录/,
  /超过单次(可操作|删除)上限/,
  /未配置数据资源绑定/,
  /暂不支持任何操作/,
  /尚未实现/,
  /timeout|aborted|ETIMEDOUT|ECONNRESET|fetch failed/i,
  /HTTP 错误|凭证缺失|未配置/,
];

/** 这条执行失败值不值得让 LLM 改一版重来 */
function isRetryableFailure(error: string | undefined): boolean {
  if (!error) return false;
  if (NEVER_RETRY_ERROR_PATTERNS.some((re) => re.test(error))) return false;
  return RETRYABLE_ERROR_PATTERNS.some((re) => re.test(error));
}

/**
 * 把平台读回的值转成可参与统计的数字。
 *
 * 平台侧同一列可能给数字、给字符串（"108"）、给带千分位或货币符号的文本，
 * 也可能是空。返回 null 表示"这条跳过"，由调用方计数并回显 ——
 * 空值和脏数据会让总和悄悄偏小，不说的话用户不会怀疑这个数字。
 */
function toNumeric(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,\s¥$￥]/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 一组数字上的聚合。空组返回 null（调用方据此显示"无数据"） */
function reduceNumbers(op: AggregateOp, values: number[]): number | null {
  if (op === 'count') return values.length;
  if (values.length === 0) return null;
  switch (op) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return null;
  }
}

/**
 * 在已拉取的记录上做聚合。
 *
 * 刻意放在内存里做，而不是下推给平台：三家平台的聚合能力差异极大
 * （飞书有部分统计、钉钉/企微基本没有），下推会让同一个问题在不同
 * provider 上给出不同答案 —— 而"金额算错"是这套系统里最不能接受的错。
 * 记录集本身已被 MAX_DESTRUCTIVE_BATCH 之外的翻页上限约束住，规模可控。
 */
function aggregateRecords(
  records: SpreadsheetRecord[],
  spec: AggregateSpec,
): AggregateResult {
  const { op, field, groupBy } = spec;
  let skipped = 0;

  /** 取一条记录参与统计的数值；count 只关心"这条算不算" */
  const numericOf = (r: SpreadsheetRecord): number | null => {
    if (op === 'count') return 1;
    if (!field) return null;
    const n = toNumeric(r.fields[field]);
    if (n === null) skipped++;
    return n;
  };

  if (!groupBy) {
    const values = records
      .map(numericOf)
      .filter((n): n is number => n !== null);
    return {
      op,
      field,
      recordCount: records.length,
      value: reduceNumbers(op, values) ?? undefined,
      ...(skipped > 0 ? { skipped } : {}),
    };
  }

  const buckets = new Map<string, number[]>();
  for (const r of records) {
    // 分组键统一成字符串；空值单独归到「(空)」而不是丢掉 ——
    // 「哪个分类花得最多」时"没填分类"本身就是一个有意义的答案
    const raw = r.fields[groupBy];
    const key = fieldToStringRaw(raw) || '(空)';
    const n = numericOf(r);
    if (n === null) continue;
    const list = buckets.get(key);
    if (list) list.push(n);
    else buckets.set(key, [n]);
  }

  const groups = [...buckets.entries()]
    .map(([key, values]) => ({
      key,
      value: reduceNumbers(op, values) ?? 0,
      count: values.length,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    op,
    field,
    groupBy,
    recordCount: records.length,
    groups,
    ...(skipped > 0 ? { skipped } : {}),
  };
}

/**
 * 拒绝原因 → 给用户看的文案。
 *
 * 三种原因的处置方式完全不同，不能糊成一句"你没有写入权限"：
 * 只读场景要改场景配置、只读会话要改那个群的配置、不在白名单要申请加名单。
 * 说错了会让用户去找错的人。
 */
function writeDenialMessage(
  reason: WriteDenialReason,
  sceneName: string,
): string {
  switch (reason) {
    case 'scene_readonly':
      return `🔒 「${sceneName}」目前是只读的，只能查询，不能新增/修改/删除。\n如需开放写入请联系管理员`;
    case 'chat_readonly':
      return `🔒 本群对「${sceneName}」只有查询权限，不能新增/修改/删除。\n如需在本群写入请联系管理员`;
    case 'user_not_writer':
      return `🔒 你没有「${sceneName}」的写入权限，可以查询但不能新增/修改/删除。\n如需权限请联系管理员`;
    default:
      return `🔒 没有「${sceneName}」的写入权限`;
  }
}

/** 拒绝原因 → 审计日志里的 errorMsg。要能一眼看出是哪个维度拦的 */
const WRITE_DENIAL_LOG: Record<WriteDenialReason, string> = {
  scene_readonly: '场景为只读模式',
  chat_readonly: '该会话为只读',
  user_not_writer: '用户不在可写白名单',
};

/**
 * 一次「解析 → 校验 → 执行」的去向。
 *
 * `stop` 与 `retry` 都带齐了用户可见文案与审计字段 —— 重试次数用光时
 * 直接拿 retry 上的这几个字段当 stop 用，不用再算一遍。
 */
type AttemptOutcome =
  /** 拿到可渲染的结果（含挂起二次确认） */
  | { kind: 'done'; parsed: ParsedIntent; result: ExecuteResult }
  /** 确定不该重试 */
  | {
      kind: 'stop';
      parsed?: ParsedIntent;
      reply: string;
      errorMsg?: string;
      logResult: BotEvent['result'];
    }
  /** LLM 改一版有机会修好 */
  | {
      kind: 'retry';
      parsed?: ParsedIntent;
      /** 上一次的原始输出，作为 assistant 轮次放回对话 */
      rawOutput: string;
      /** 失败原因，喂给纠正指令 */
      reason: string;
      reply: string;
      errorMsg?: string;
      logResult: BotEvent['result'];
    };

/**
 * 拉取撞上翻页上限时，附在 UPDATE / DELETE 提示后面的说明。
 * 命中集本身可能不全，破坏性操作必须让用户知道。
 */
const TRUNCATED_MATCH_HINT =
  '\n⚠️ 数据量已达单次拉取上限，可能还有未列出的匹配记录，建议缩窄条件后再操作';

/** 带并发上限地跑完一批任务，返回与输入同序的 settled 结果 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () =>
    (async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        const task = tasks[i];
        if (!task) continue;
        try {
          results[i] = { status: 'fulfilled', value: await task() };
        } catch (reason) {
          results[i] = { status: 'rejected', reason };
        }
      }
    })(),
  );
  await Promise.all(workers);
  return results;
}

export class Dispatcher {
  readonly registry = new SceneRegistry();
  private dedup: DedupStore;
  private pending: PendingActionStore;
  private rateLimit: RateLimitStore;
  private config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    this.config = config;
    this.dedup = config.dedupStore ?? new MemoryDedupStore();
    this.pending = config.pendingStore ?? new MemoryPendingActionStore();
    this.rateLimit = config.rateLimitStore ?? new MemoryRateLimitStore();
  }

  async process(
    msg: UnifiedMessage,
    channelAdapter: ChannelAdapter,
  ): Promise<void> {
    const startTime = Date.now();
    const logEvent = async (partial: Partial<BotEvent>) => {
      const event: BotEvent = {
        platform: msg.platform,
        eventId: msg.eventId,
        chatId: msg.chatId,
        chatName: msg.chatName,
        senderId: msg.senderId,
        senderName: msg.senderName,
        content: msg.content,
        costMs: Date.now() - startTime,
        result: 'success',
        createdAt: new Date(),
        ...partial,
      };
      // 审计写库失败绝不能打断用户流程，也不能被外层 catch 当成业务错误再记一次
      try {
        await this.config.onEvent?.(event);
      } catch (err) {
        console.error('[Dispatcher] 审计事件回调失败:', err);
      }
    };

    try {
      // 1. 幂等占坑（PendingAction 之前先做，否则平台重试同一 eventId 时
      //    pendingAction 已被处理删除，会走到正常场景匹配链白白消耗 LLM token）。
      //    claim 是原子的：抢不到说明这条事件已被处理过。
      const claimed = await this.dedup.claim(msg.platform, msg.eventId);
      if (!claimed) {
        await logEvent({ result: 'ignored' });
        return;
      }

      // 2. PendingAction
      const pendingKey = pendingKeyOf(msg);
      const pendingAction = await this.pending.get(pendingKey);
      if (pendingAction) {
        const outcome = await this.handlePendingAction(
          msg,
          pendingAction,
          channelAdapter,
        );
        if (outcome.handled) {
          await logEvent({
            sceneId: pendingAction.sceneId,
            intent: outcome.intent,
            result: outcome.errorMsg ? 'error' : 'success',
            errorMsg: outcome.errorMsg,
            resultData: {
              pendingType: pendingAction.type,
              ...outcome.resultData,
            },
          });
          return;
        }
        // 无法识别的输入：提示用户并保留 PendingAction，不走正常流程。
        //
        // 这条路径也要过限流闸门。它不花 LLM，所以位置在幂等之后、正常
        // 限流点之前是对的；但它**会回一条消息**，而 pending 的 TTL 有 60 秒
        // —— 不拦的话有人在等待态里刷屏，机器人就陪着刷 60 秒。
        // 超限时静默保留 pending：把人卡在等待态里出不来才是更糟的结果。
        const promptHits = await this.rateLimit.hit(pendingKey);
        if (promptHits > RATE_LIMIT_MAX) {
          await logEvent({
            sceneId: pendingAction.sceneId,
            result: 'ignored',
            errorMsg: `待确认提示触发限流（本窗口第 ${promptHits} 条）`,
          });
          return;
        }
        const promptByType: Record<PendingAction['type'], string> = {
          confirm_delete: '请回复"确认删除"执行，或回复"取消"放弃',
          confirm_update: '请回复"确认更新"执行，或回复"取消"放弃',
          confirm_upsert:
            '请回复"确认更新"合并到现有记录，"强制新建"创建新记录，或"取消"放弃',
          select_record: `请回复序号(1~${Math.min(
            pendingAction.selectableCount ?? MAX_CANDIDATE_DISPLAY,
            pendingAction.candidates.length,
          )})选择一条，或回复"全部"更新全部 ${pendingAction.candidates.length} 条，或回复"取消"放弃`,
        };
        await channelAdapter.reply(msg, promptByType[pendingAction.type]);
        await logEvent({ sceneId: pendingAction.sceneId, result: 'ignored' });
        return;
      }

      // 2.5 限流。
      //
      // 位置是刻意的：
      // - 在**幂等占坑之后** —— 平台重试同一个 eventId 不该消耗用户配额
      // - 在**待确认处理之后** —— "确认删除"这类回复不走 LLM，几乎不花钱，
      //   而把人卡在等待态里出不来是更糟的结果
      // - 在**场景匹配之前** —— 匹配本身就可能调一次 LLM，闸门必须在它前面
      const hits = await this.rateLimit.hit(pendingKey);
      if (hits > RATE_LIMIT_MAX) {
        // 只在**刚**超限那一次回提示，之后沉默：有人刷屏时每条都回
        // 等于把流量翻倍，还会被平台按频率限速
        if (hits === RATE_LIMIT_MAX + 1) {
          await channelAdapter.reply(
            msg,
            `⏳ 消息太频繁了，请稍后再试（每分钟最多 ${RATE_LIMIT_MAX} 条）`,
          );
        }
        await logEvent({
          result: 'ignored',
          errorMsg: `触发限流（本窗口第 ${hits} 条）`,
        });
        return;
      }

      // 3. 场景匹配：关键词优先，未命中再问 LLM
      let scene = this.registry.matchByKeyword(msg.content, msg.chatId);
      /** LLM 分类调用本身失败的原因（区别于"LLM 说没有匹配场景"） */
      let matchFailure: string | undefined;
      if (!scene) {
        try {
          scene = await this.registry.matchByLLM(msg.content, msg.chatId);
        } catch (err) {
          matchFailure = err instanceof Error ? err.message : String(err);
          console.error('[Dispatcher] 场景 LLM 匹配失败:', matchFailure);
        }
      }
      if (!scene) {
        // LLM 没调通时必须说实话：回 help 文本会让用户以为是自己没说清楚，
        // 审计日志也会记成 ignored，把服务故障伪装成正常的"未匹配"
        await channelAdapter.reply(
          msg,
          matchFailure
            ? '⚠️ 语义识别服务暂时不可用，请稍后再试'
            : this.getHelpText(msg.chatId),
        );
        await logEvent({
          result: matchFailure ? 'error' : 'ignored',
          errorMsg: matchFailure,
        });
        return;
      }

      // 4. LLM 意图解析
      const ctx: SceneContext = {
        today: new Date().toISOString().slice(0, 10),
        senderName: msg.senderName,
        chatName: msg.chatName,
        // 字段清单从绑定实时派生，不再依赖管理员在 prompt 里手抄
        resources: this.resourcesOf(scene.id),
      };
      const systemPrompt = scene.getSystemPrompt(ctx);
      // systemPrompt 来自 admin 配置可能含业务敏感规则；LLM 原始输出可能含用户内容回显，
      // 仅在非 production 输出便于调试，避免日志采集系统留存
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Dispatcher] 场景:', scene.id, '消息:', msg.content);
        console.log(
          '[Dispatcher] System Prompt (前200字):',
          systemPrompt.slice(0, 200),
        );
      }
      // 5~7. 解析 → 校验 → 执行，失败且可纠正时让 LLM 改一版重来。
      //
      // 开环单次调用是机器人不稳定的主因：本地用 CLI 时报错会被读到、
      // 改个参数重试就过了；机器人这边直接把错误抛给用户。今天线上那三条
      // InvalidFilter 就是这么堵死的 —— 同一个模型缺陷，一边自愈一边卡住。
      // 注意 attemptOnce 内部对「不该重试」的失败会返回 stop（见
      // NEVER_RETRY_ERROR_PATTERNS：放宽筛选条件会放大 UPDATE/DELETE 影响面）。
      // 目标平台的单条消息字节预算。展示条数（查询结果、候选列表、分组）
      // 都按它推导 —— 企微只有 2048 字节，按飞书的 10 条渲染必然被
      // clampReplyBytes 从某条记录的中间砍断。
      const budgetBytes = channelAdapter.maxReplyBytes;
      let outcome = await this.attemptOnce(
        scene,
        msg,
        systemPrompt,
        budgetBytes,
      );
      let attempts = 1;
      const retryReasons: string[] = [];
      while (outcome.kind === 'retry' && attempts < MAX_LLM_ATTEMPTS) {
        retryReasons.push(outcome.reason);
        console.warn(
          `[Dispatcher] 第 ${attempts} 次解析失败，让 LLM 纠正后重试:`,
          outcome.reason.slice(0, 200),
        );
        outcome = await this.attemptOnce(
          scene,
          msg,
          systemPrompt,
          budgetBytes,
          {
            previousOutput: outcome.rawOutput,
            error: outcome.reason,
          },
        );
        attempts++;
      }
      /** 重试留痕：几次、为什么重的。不记就看不出"这条是重试后才成的" */
      const retryTrace =
        retryReasons.length > 0
          ? { attempts, retriedFrom: retryReasons.map((r) => r.slice(0, 200)) }
          : {};

      if (outcome.kind !== 'done') {
        // retry 用光了次数也走这里：把最后一次的用户可见文案发出去
        await channelAdapter.reply(msg, outcome.reply);
        await logEvent({
          sceneId: scene.id,
          intent: outcome.parsed?.intent,
          result: outcome.logResult,
          errorMsg: outcome.errorMsg,
          resultData: {
            ...(outcome.parsed
              ? { request: summarizeRequest(outcome.parsed) }
              : {}),
            ...retryTrace,
          },
        });
        return;
      }

      const { parsed, result } = outcome;

      // 8. 回复（fieldMapping 用于渲染时取 label / displayType；缺失时退化为 logicalKey）
      const binding = this.config.getBinding(scene.id, parsed.resource);
      // 投影字段同样要过 fieldMapping 白名单。写入侧丢弃并点名、筛选侧直接
      // 拒绝，唯独 projectFields 以前直接拿去渲染 —— 幻觉字段会渲染成
      // 「A → （该字段为空）」，用户会以为表里有这列且没值。
      // 这里按写入侧处理：丢掉 + 点名（投影错了只是看不到数据，不像筛选
      // 错了会放大影响面，不必整条拒绝）。全部无效时退回整行渲染。
      const badProjection = this.pruneProjectFields(
        parsed,
        binding?.fieldMapping,
      );
      const reply = scene.formatReply(
        parsed,
        result,
        binding?.fieldMapping,
        budgetBytes,
      );
      // 被丢弃的字段必须点名：否则用户以为自己说的内容都记下来了
      const notices = [
        result.droppedFields?.length
          ? `⚠️ 已忽略未配置的字段：${result.droppedFields.join('、')}`
          : '',
        // 措辞要跟实际渲染一致：还有有效投影字段时是"忽略无效的那几个"，
        // 全都无效时才退回整行展示
        badProjection.length > 0
          ? `⚠️ 「${badProjection.join('、')}」不是该资源里的字段，${
              parsed.projectFields ? '已忽略' : '已按全部字段展示'
            }`
          : '',
      ].filter(Boolean);
      const dropped = notices.length > 0 ? `\n\n${notices.join('\n')}` : '';
      await channelAdapter.reply(msg, reply + dropped);
      await logEvent({
        sceneId: scene.id,
        intent: parsed.intent,
        // 挂起二次确认是设计正路，记 pending —— 记 error 会让统计面板的
        // 错误率变得毫无意义（每次 DELETE / 单条 UPDATE 都会计一次）
        result: result.success
          ? 'success'
          : result.awaitingConfirmation
            ? 'pending'
            : 'error',
        resultData: {
          ...summarizeResult(result),
          request: summarizeRequest(parsed),
          ...retryTrace,
        },
      });
    } catch (err) {
      console.error('[Dispatcher] 处理失败:', err);
      await channelAdapter
        .reply(msg, '⚠️ 服务暂时繁忙，请稍后再试')
        .catch((replyErr) => {
          console.error(
            '[Dispatcher] 兜底回复也失败，用户可能未收到任何消息:',
            replyErr,
          );
        });
      await logEvent({
        result: 'error',
        errorMsg: err instanceof Error ? err.message : '未知错误',
      });
    }
  }

  /**
   * 查询记录并取回「拉取是否被截断」。
   *
   * 不能在这里用「返回条数 >= queryHardLimit」判截断：钉钉/企微没有服务端
   * filter，截断发生在**内存过滤之前**，拉满 5000 行、过滤后剩 1 条时这个
   * 判据恒为 false，用户拿到的是静默不完整的答案。所以由 adapter 上报。
   * adapter 没实现 queryRecordsWithMeta（如测试替身）时退化为旧判据。
   */
  private async query(
    adapter: SpreadsheetAdapter,
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<{ records: SpreadsheetRecord[]; truncated: boolean }> {
    if (adapter.queryRecordsWithMeta) {
      return adapter.queryRecordsWithMeta(config, filters);
    }
    const records = await adapter.queryRecords(config, filters);
    return { records, truncated: records.length >= adapter.queryHardLimit };
  }

  /**
   * 跑一次「解析 → 校验 → 执行」。
   *
   * 抽出来是为了让重试循环只有三种去向，不用在 process 里铺开一堆早退：
   * - done  ：拿到可渲染的结果（含挂起二次确认，那是设计正路）
   * - stop  ：确定不该重试，直接把 reply 发给用户
   * - retry ：LLM 改一版有机会修好，带上原始输出与原因给下一轮
   */
  private async attemptOnce(
    scene: BotScene,
    msg: UnifiedMessage,
    systemPrompt: string,
    budgetBytes: number,
    retry?: RetryContext,
  ): Promise<AttemptOutcome> {
    const llmOutput = await chatCompletion(systemPrompt, msg.content, retry);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Dispatcher] LLM 原始输出:', llmOutput.slice(0, 500));
    }

    const malformed = (what: string): AttemptOutcome => ({
      kind: 'retry',
      rawOutput: llmOutput,
      reason: `${what}。你必须只输出一个 JSON 对象。`,
      reply: '🤔 无法理解您的消息，请用更明确的描述再试一次',
      errorMsg: what,
      logResult: 'error',
    });

    const jsonStr = extractJson(llmOutput);
    if (!jsonStr) return malformed('JSON 提取失败');

    const parsed = scene.parseResult(jsonStr);
    if (!parsed) return malformed('parseResult 失败');

    // 置信度不足与 UNKNOWN 都**不重试**：那是真实的歧义，不是格式错误。
    // 再问一遍模型只会让它为了"给个答案"而抬高置信度，该做的是问用户。
    //
    // UNKNOWN 必须判在置信度闸门**之前**。防注入守词明确要求模型在无法
    // 识别时返回 {"intent":"UNKNOWN","confidence":0} —— 这是系统自己设计的
    // 正路，而 0 < 阈值 会先命中置信度分支把它记成 error。实测一轮 53 条
    // 事件里 25 个 error 有 21 个是这么来的，错误率统计直接失去意义
    // （真实错误率 4/53）。与当初把 pending 从 error 里拆出来是同一件事。
    if (parsed.intent === 'UNKNOWN') {
      return {
        kind: 'stop',
        parsed,
        reply: `🤔 暂时不知道您想做什么：${parsed.summary || '没拿到具体操作'}\n\n可以试试：\n• 查询：「${scene.name} ...的 xxx」\n• 新增：「新增/记录 ...」\n• 更新：「把 ... 改成 ...」\n• 删除：「删除 ...」`,
        errorMsg: 'UNKNOWN 意图',
        logResult: 'ignored',
      };
    }

    if (parsed.confidence < CONFIDENCE_THRESHOLD) {
      return {
        kind: 'stop',
        parsed,
        reply: `🤔 不太确定您的意图，解析结果：${parsed.summary}\n\n请用更明确的描述再试一次`,
        errorMsg: '置信度不足',
        logResult: 'error',
      };
    }

    // 写权限：拦在真正落库前，且不消耗额外的平台调用。不重试 —— 换个
    // JSON 写法也不会让没权限的人有权限
    if (isWriteIntent(parsed.intent)) {
      const denial = scene.writeDenial(msg.senderId, msg.chatId);
      if (denial) {
        return {
          kind: 'stop',
          parsed,
          reply: writeDenialMessage(denial, scene.name),
          errorMsg: WRITE_DENIAL_LOG[denial],
          logResult: 'ignored',
        };
      }
    }

    const result = await this.execute(scene, parsed, msg, budgetBytes);

    // 成功、以及挂起二次确认（设计正路）都算 done。
    // awaitingConfirmation 尤其不能重试：pending 已经写进存储了，
    // 再来一轮会挂出第二条待确认，把用户的"确认删除"指向错的候选集。
    if (result.success || result.awaitingConfirmation) {
      return { kind: 'done', parsed, result };
    }

    if (isRetryableFailure(result.error)) {
      return {
        kind: 'retry',
        parsed,
        rawOutput: llmOutput,
        reason: result.error ?? '执行失败',
        reply: scene.formatReply(
          parsed,
          result,
          this.config.getBinding(scene.id, parsed.resource)?.fieldMapping,
          budgetBytes,
        ),
        errorMsg: result.error,
        logResult: 'error',
      };
    }

    return {
      kind: 'stop',
      parsed,
      reply: scene.formatReply(
        parsed,
        result,
        this.config.getBinding(scene.id, parsed.resource)?.fieldMapping,
        budgetBytes,
      ),
      errorMsg: result.error,
      logResult: 'error',
    };
  }

  /**
   * 按 fieldMapping 白名单裁剪 QUERY 的投影字段，返回被丢掉的那些。
   *
   * 直接改 `parsed.projectFields` —— 它是本次请求的解析结果，dispatcher
   * 自己拥有，紧接着就交给 formatReply 渲染；另存一份反而要在
   * ExecuteResult 与 formatReply 的签名上都开一个只为它服务的口子。
   *
   * 一个都不剩时置为 undefined，退回整行渲染：投影全错时给用户看全部字段，
   * 比回一句"（该字段为空）"有用。
   */
  private pruneProjectFields(
    parsed: ParsedIntent,
    fieldMapping?: Record<string, FieldMappingValue>,
  ): string[] {
    const requested = parsed.projectFields;
    // 没配 fieldMapping 的绑定整体透传（与 splitByMapping 一致），不做裁剪
    if (!requested?.length || !fieldMapping) return [];
    if (Object.keys(fieldMapping).length === 0) return [];
    const known = requested.filter((f) => f in fieldMapping);
    const unknown = requested.filter((f) => !(f in fieldMapping));
    parsed.projectFields = known.length > 0 ? known : undefined;
    return unknown;
  }

  /** 场景绑定的资源描述，喂给 prompt。listBindings 缺省时退化为默认资源 */
  private resourcesOf(sceneId: string): SceneResource[] {
    const bindings = this.config.listBindings
      ? this.config.listBindings(sceneId)
      : [this.config.getBinding(sceneId)].filter(
          (b): b is ResourceBinding => b !== null,
        );
    return bindings.map(sceneResourceOf);
  }

  /**
   * 能力分发：按绑定资源的 kind 路由到对应能力层，再按 intent 执行动作。
   * 加新能力（文件、日历…）只需要在这里加一个 kind 分支 + 一个 adapter，
   * 不用改 BotScene 接口或 core 类型。
   */
  private async execute(
    scene: BotScene,
    parsed: ParsedIntent,
    msg: UnifiedMessage,
    budgetBytes: number,
  ): Promise<ExecuteResult> {
    const binding = this.config.getBinding(scene.id, parsed.resource);
    if (!binding) {
      return {
        success: false,
        error: parsed.resource
          ? `场景 "${scene.name}" 下找不到名为「${parsed.resource}」的资源`
          : `场景 "${scene.name}" 未配置数据资源绑定`,
      };
    }

    // 动词与资源类型不匹配时给出可操作的提示，而不是打到不支持的 adapter
    const allowed = ACTIONS_BY_KIND[binding.kind];
    if (!allowed.includes(parsed.intent)) {
      return {
        success: false,
        error:
          allowed.length === 0
            ? `资源「${binding.alias}」是 ${binding.kind} 类型，暂不支持任何操作`
            : `「${binding.alias}」是 ${binding.kind} 类型资源，不支持「${parsed.intent}」操作（可用：${allowed.join(' / ')}）`,
      };
    }

    // adapter 抛出的错必须在这里收住：往上会被 process 的兜底 catch 压成
    // 一句"服务暂时繁忙"，而这些消息本来就是写给用户看的 ——
    // 「区间条件不能与『或』混用，请拆成两次查询」「关联记录要先去子表创建」
    // 「钉钉/企微文档适配器尚未实现」，压掉之后用户完全不知道该怎么改。
    try {
      if (binding.kind === 'doc') {
        return await this.executeDoc(binding, parsed);
      }
      return await this.executeTable(binding, scene, parsed, msg, budgetBytes);
    } catch (err) {
      console.error('[Dispatcher] 能力层执行失败:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : '执行失败',
      };
    }
  }

  /** 文档能力：读取 / 追加 */
  private async executeDoc(
    binding: ResourceBinding,
    parsed: ParsedIntent,
  ): Promise<ExecuteResult> {
    const adapter = getDocumentAdapter(binding.provider);
    const config = documentConfigOf(binding);

    // QUERY 与 READ 同义：现有场景的 prompt 习惯用 QUERY 表达"查看"
    if (parsed.intent === 'READ' || parsed.intent === 'QUERY') {
      const doc = await adapter.readDocument(config);
      return { success: true, doc };
    }

    // APPEND：正文优先取 fields.content / fields.text，退回 summary
    const raw =
      parsed.fields.content ?? parsed.fields.text ?? parsed.fields.正文;
    const text = typeof raw === 'string' ? raw : '';
    if (!text.trim()) {
      return {
        success: false,
        error: '没有解析出要写入文档的内容，请把要记录的正文说清楚',
      };
    }
    const doc = await adapter.appendText(config, text);
    return { success: true, doc, appendedText: text.trim() };
  }

  /** 表格能力：CRUD */
  private async executeTable(
    binding: ResourceBinding,
    scene: BotScene,
    parsed: ParsedIntent,
    msg: UnifiedMessage,
    budgetBytes: number = DEFAULT_REPLY_BUDGET_BYTES,
  ): Promise<ExecuteResult> {
    const tableConfig = tableConfigOf(binding);

    // adapter 按**数据所在平台**选，而不是消息来源平台 —— 这是跨平台访问的落点
    const adapter = getSpreadsheetAdapter(binding.provider);

    // 未知字段守卫。写入侧丢掉并回显，筛选侧直接拒绝 ——
    // 筛选条件被悄悄丢掉会让查询范围变宽（DELETE/UPDATE 上就是放大影响面），
    // 宁可报一句能照着改的错，也不能静默给出更大的结果集。
    const mapping = tableConfig.fieldMapping;
    const { known: fields, unknownKeys: droppedFields } = splitByMapping(
      parsed.fields,
      mapping,
    );
    const { known: rawFilters, unknownKeys: badFilterKeys } = splitByMapping(
      parsed.filters ?? {},
      mapping,
      // filters 需要 _conjunction 这类保留键
      true,
    );
    // 未知键的拒绝先于剔除：字段名写错就该报错，哪怕它的值恰好是空的
    const filters = stripIneffectiveFilters(rawFilters);
    if (badFilterKeys.length > 0) {
      const available = Object.keys(mapping).join('、');
      return {
        success: false,
        error: `筛选条件里的「${badFilterKeys.join('、')}」不是「${binding.alias}」里的字段，没法按它查。可用字段：${available}`,
      };
    }

    switch (parsed.intent) {
      case 'CREATE': {
        // 仅当 fieldMapping 显式声明了操作人字段时才注入发送者
        // (避免对没有"录入人"字段的表写入未知字段触发 InvalidField 错误)
        const operatorKey = resolveOperatorKey(mapping);
        const createFields = operatorKey
          ? { ...fields, [operatorKey]: msg.senderName }
          : fields;
        if (Object.keys(createFields).length === 0) {
          return {
            success: false,
            error:
              droppedFields.length > 0
                ? `「${droppedFields.join('、')}」不是「${binding.alias}」里的字段，没有可写入的内容。可用字段：${Object.keys(mapping).join('、')}`
                : '没有解析出要写入的字段，请把要记录的内容说清楚',
          };
        }

        // 唯一键查重：命中已有记录时挂起 PendingAction，等用户确认转 UPDATE
        const uniqueKey = tableConfig.uniqueKey;
        const uniqueValue = uniqueKey ? createFields[uniqueKey] : undefined;
        if (uniqueKey && uniqueValue != null && uniqueValue !== '') {
          // 走 this.query 而不是裸 queryRecords：钉钉/企微的唯一键过滤发生在
          // **内存里**，拉取被翻页上限截断时命中集可能不全 —— existing 为空
          // 就直接新建，静默造出一条重复记录，而查重恰恰是为了防这件事。
          const { records: existing, truncated } = await this.query(
            adapter,
            tableConfig,
            { [uniqueKey]: uniqueValue },
          );
          if (existing.length === 0 && truncated) {
            return {
              success: false,
              error: `数据量已达单次拉取上限，无法确认「${uniqueKey}=${String(uniqueValue)}」是否已存在。为避免重复录入，请先在表里确认后再操作`,
            };
          }
          if (existing.length > 0) {
            await this.pending.set(pendingKeyOf(msg), {
              sceneId: scene.id,
              bindingAlias: binding.alias,
              type: 'confirm_upsert',
              candidates: existing,
              message: msg,
              updateFields: createFields,
            });
            return {
              success: false,
              awaitingConfirmation: true,
              error: `已存在 ${existing.length} 条「${uniqueKey}=${String(uniqueValue)}」的记录。回复"确认更新"将合并到第 1 条；回复"取消"放弃；回复"强制新建"仍按新记录创建`,
            };
          }
        }

        const record = await adapter.createRecord(tableConfig, createFields);
        return {
          success: true,
          droppedFields,
          record: {
            ...record,
            fields: { ...createFields, ...record.fields },
          },
        };
      }

      case 'QUERY': {
        const { records, truncated } = await this.query(
          adapter,
          tableConfig,
          filters,
        );
        return {
          success: true,
          records,
          droppedFields,
          hitQueryLimit: truncated,
        };
      }

      case 'AGGREGATE': {
        const spec = parsed.aggregate;
        if (!spec) {
          return {
            success: false,
            error:
              '没有解析出要统计什么，请说清楚统计哪个字段（例如「本月支出金额合计」）',
          };
        }
        // 统计字段与分组字段同样要过白名单。这里必须**拒绝**而不是丢弃：
        // 字段猜错时算出来的是一个看着很正常的数字，用户没有任何办法
        // 发现它统计错了列 —— 比查询范围变宽更难察觉。
        const hasMapping = Object.keys(mapping).length > 0;
        const badKeys = [spec.field, spec.groupBy].filter(
          (k): k is string => !!k && hasMapping && !(k in mapping),
        );
        if (badKeys.length > 0) {
          return {
            success: false,
            error: `「${badKeys.join('、')}」不是「${binding.alias}」里的字段，没法按它统计。可用字段：${Object.keys(mapping).join('、')}`,
          };
        }
        if (spec.op !== 'count' && !spec.field) {
          return {
            success: false,
            error: `${spec.op} 需要指定统计哪个字段。可用字段：${Object.keys(mapping).join('、')}`,
          };
        }

        const { records, truncated } = await this.query(
          adapter,
          tableConfig,
          filters,
        );
        return {
          success: true,
          aggregate: aggregateRecords(records, spec),
          droppedFields,
          // 对聚合来说截断不是"结果可能不全"，而是**算出来的数字是错的**。
          // 渲染层据此换一句更重的措辞。
          hitQueryLimit: truncated,
        };
      }

      case 'UPDATE': {
        // 仅统计有效筛选键（排除以 _ 开头的保留键，如 _conjunction），
        // 否则 LLM 返回 {"_conjunction":"or"} 会绕过空判断，
        // 下游 queryRecords 跳过保留键后 filter 为空 → 命中全表 → 全表挂入待更新。
        if (!hasEffectiveFilters(filters)) {
          return { success: false, error: '更新操作需要指定筛选条件' };
        }
        // 没有变更字段的 UPDATE 不能往下走：会挂出一条"变更字段：（空）"的
        // 确认提示，用户确认后再对平台发一次空 fields 的写请求
        if (Object.keys(fields).length === 0) {
          return {
            success: false,
            error:
              droppedFields.length > 0
                ? `「${droppedFields.join('、')}」不是「${binding.alias}」里的字段，没有可更新的内容。可用字段：${Object.keys(mapping).join('、')}`
                : '没有解析出要更新成什么，请把要改的字段和新值说清楚（例如「把 X 的状态改成已完成」）',
          };
        }
        const { records, truncated } = await this.query(
          adapter,
          tableConfig,
          filters,
        );
        const limitWarning = truncated ? TRUNCATED_MATCH_HINT : '';
        if (records.length === 0)
          return { success: false, error: `未找到匹配记录${limitWarning}` };
        if (records.length === 1) {
          // 单条命中也走二次确认，避免 LLM 被 prompt 注入直接覆盖记录
          // （与 DELETE 的 confirm_delete 流程对齐）
          const target = records[0];
          if (target) {
            await this.pending.set(pendingKeyOf(msg), {
              sceneId: scene.id,
              bindingAlias: binding.alias,
              type: 'confirm_update',
              candidates: [target],
              message: msg,
              updateFields: fields,
            });
            const changes = Object.entries(fields)
              .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
              .join('\n');
            return {
              success: false,
              awaitingConfirmation: true,
              error: `确认更新 1 条记录？\n变更字段：\n${changes}${limitWarning}\n\n回复"确认更新"执行，回复"取消"放弃`,
            };
          }
        }
        if (records.length > MAX_DESTRUCTIVE_BATCH) {
          return {
            success: false,
            error: `匹配到 ${records.length} 条记录，超过单次可操作上限 ${MAX_DESTRUCTIVE_BATCH} 条。请补充更精确的筛选条件后重试`,
          };
        }
        const changes = Object.entries(fields)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join('、');
        const prompt = `找到 ${records.length} 条匹配记录，请回复序号选择其中一条，或回复「全部」把这 ${records.length} 条都改成 ${changes}：\n`;
        const candidateList = renderCandidateList(
          records,
          tableConfig.fieldMapping,
          budgetBytes,
          utf8ByteLength(prompt + limitWarning),
        );
        // candidates 存**全部**命中记录（此处已确保 ≤ MAX_DESTRUCTIVE_BATCH，
        // 所以有界），「全部更新」才有完整的目标集；序号只能选到**展示出来**
        // 的那些，由 selectableCount 单独约束 —— 存全量而只列前 10 条时，
        // 用户回一个 15 就会更新一条自己从没见过的记录。
        // 上界取渲染时**实际列出**的条数：预算不够时列表会更短，两者必须同源。
        await this.pending.set(pendingKeyOf(msg), {
          sceneId: scene.id,
          bindingAlias: binding.alias,
          type: 'select_record',
          candidates: records,
          selectableCount: candidateList.shownCount,
          message: msg,
          updateFields: fields,
        });
        // 没列全时要说清「怎么够到没列出来的那些」——「全部」是全量的，
        // 但按序号只能选到列出来的这几条
        const unlisted =
          records.length > candidateList.shownCount
            ? `\n（未列出的 ${records.length - candidateList.shownCount} 条无法按序号选中，「全部」仍会全部更新；要逐条选请缩窄筛选条件）`
            : '';
        return {
          success: false,
          awaitingConfirmation: true,
          error: `${prompt}${candidateList.text}${unlisted}${limitWarning}`,
        };
      }

      case 'DELETE': {
        // 同 UPDATE：排除保留键后再判空，防止保留键绕过守卫导致全表删除放大。
        if (!hasEffectiveFilters(filters)) {
          return { success: false, error: '删除操作需要指定筛选条件' };
        }
        const { records, truncated } = await this.query(
          adapter,
          tableConfig,
          filters,
        );
        const limitWarning = truncated ? TRUNCATED_MATCH_HINT : '';
        if (records.length === 0)
          return { success: false, error: `未找到匹配记录${limitWarning}` };
        // 删除无法回滚：超过上限直接拒绝，不给"一句确认删掉上千条"的机会
        if (records.length > MAX_DESTRUCTIVE_BATCH) {
          return {
            success: false,
            error: `匹配到 ${records.length} 条记录，超过单次删除上限 ${MAX_DESTRUCTIVE_BATCH} 条。删除不可回滚，请补充更精确的筛选条件后重试`,
          };
        }
        await this.pending.set(pendingKeyOf(msg), {
          sceneId: scene.id,
          bindingAlias: binding.alias,
          type: 'confirm_delete',
          candidates: records,
          message: msg,
        });
        const head = `确认删除以下 ${records.length} 条记录？\n`;
        const tail = `${limitWarning}\n\n回复"确认删除"执行，回复"取消"放弃`;
        const list = renderCandidateList(
          records,
          tableConfig.fieldMapping,
          budgetBytes,
          utf8ByteLength(head + tail),
        );
        // 删除不可回滚，所以「确认将删除但没列出来」这件事必须说穿。
        // 以前列表尾部只有一句「如需选择更后面的记录请缩窄筛选条件」——
        // 那是给 select_record 写的，在删除语境里读起来像"还能再选"，
        // 而实际上一句"确认删除"会把没列出来的那些一并删掉。
        const unlisted =
          records.length > list.shownCount
            ? `\n⚠️ 另有 ${records.length - list.shownCount} 条未列出，确认后将**一并删除**；要逐条核对请缩窄筛选条件`
            : '';
        return {
          success: false,
          awaitingConfirmation: true,
          error: `${head}${list.text}${unlisted}${tail}`,
        };
      }

      default:
        return { success: false, error: '无法识别的操作意图' };
    }
  }

  /**
   * 批量更新 select_record 的全部候选。
   *
   * 与 confirm_delete 的批量删除同构：并发受闸门约束（飞书写接口 QPS 约 20，
   * 一次性 Promise.all 全量发出会大面积 429），逐条汇总成功/失败 ——
   * 串行 await 中途抛错会让一半改了一半没改，而用户只看到"服务繁忙"。
   */
  private async updateAll(
    msg: UnifiedMessage,
    action: PendingAction,
    channelAdapter: ChannelAdapter,
    adapterOf: () => SpreadsheetAdapter,
  ): Promise<PendingOutcome> {
    await this.pending.delete(pendingKeyOf(msg));
    const binding = this.config.getBinding(action.sceneId, action.bindingAlias);
    if (!binding) {
      await channelAdapter.reply(
        msg,
        '⚠️ 表格配置已变更，刚才的操作已作废，请重新发送指令',
      );
      return { handled: true, resultData: { aborted: '资源绑定已变更' } };
    }
    const tableConfig = tableConfigOf(binding);
    const adapter = adapterOf();
    const fields = action.updateFields ?? {};

    const results = await runWithConcurrency(
      action.candidates.map(
        (record) => () =>
          adapter.updateRecord(tableConfig, record.recordId, fields),
      ),
      DESTRUCTIVE_CONCURRENCY,
    );
    const failed = results.filter((r) => r.status === 'rejected');
    const okCount = results.length - failed.length;
    const updatedIds = action.candidates
      .filter((_, i) => results[i]?.status === 'fulfilled')
      .map((r) => r.recordId);
    const resultData = {
      updatedAll: true,
      updated: okCount,
      recordIds: updatedIds.slice(0, 50),
      fieldKeys: Object.keys(fields),
    };

    if (failed.length === 0) {
      await channelAdapter.reply(msg, `✅ 已更新 ${okCount} 条记录`);
      return { handled: true, intent: 'UPDATE', resultData };
    }
    const firstErr =
      failed[0]?.status === 'rejected'
        ? String((failed[0] as PromiseRejectedResult).reason)
        : '';
    console.error('[Dispatcher] 批量更新部分失败:', failed);
    await channelAdapter.reply(
      msg,
      `⚠️ 已更新 ${okCount}/${results.length} 条，${failed.length} 条失败${firstErr ? `（首条原因：${firstErr.slice(0, 100)}）` : ''}`,
    );
    return {
      handled: true,
      intent: 'UPDATE',
      errorMsg: `批量更新 ${failed.length}/${results.length} 条失败：${firstErr.slice(0, 200)}`,
      resultData: { ...resultData, failed: failed.length },
    };
  }

  /**
   * 执行「用户已确认」的单条写操作，并把结果回到群里。
   *
   * 必须由这里收住 adapter 异常。三条确认路径（confirm_update /
   * confirm_upsert / select_record）以前都是裸 await：
   * - pending 在写之前就删了，抛错后用户的确认已被消耗
   * - 异常逃出 handlePendingAction，被 process 的兜底 catch 压成一句
   *   "服务暂时繁忙，请稍后再试" —— 用户以为是临时抖动，其实更新根本没生效
   * - 审计日志因此走的是外层 catch 那条，**丢掉了 sceneId / intent /
   *   pendingType**，偏偏破坏性写操作才是最需要留痕的地方
   *
   * confirm_delete 走 runWithConcurrency 时早就把失败汇总成了精确文案，
   * 这里补齐另外三条，让四条路径的失败表现一致。
   */
  private async runConfirmedWrite(
    msg: UnifiedMessage,
    channelAdapter: ChannelAdapter,
    intent: 'CREATE' | 'UPDATE',
    resultData: Record<string, unknown>,
    write: () => Promise<SpreadsheetRecord>,
    render: (record: SpreadsheetRecord) => string,
  ): Promise<PendingOutcome> {
    let record: SpreadsheetRecord;
    try {
      record = await write();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error('[Dispatcher] 确认后的写操作失败:', err);
      await channelAdapter.reply(
        msg,
        `⚠️ ${intent === 'CREATE' ? '新建' : '更新'}失败：${reason.slice(0, 200)}\n刚才的确认已失效，请重新发送指令`,
      );
      return {
        handled: true,
        intent,
        errorMsg: reason.slice(0, 200),
        resultData: { ...resultData, failed: true },
      };
    }
    await channelAdapter.reply(msg, render(record));
    // 写成功后补上落库的 recordId；调用方显式给了就以它为准
    // （UPDATE 侧记的是命中的目标记录，与返回值同一条）
    return {
      handled: true,
      intent,
      resultData: { recordId: record.recordId, ...resultData },
    };
  }

  private async handlePendingAction(
    msg: UnifiedMessage,
    action: PendingAction,
    channelAdapter: ChannelAdapter,
  ): Promise<PendingOutcome> {
    const content = msg.content.trim();

    // 精确匹配避免误吞业务消息（如"算了一下今天的销售额"被当成取消）
    if (['取消', '算了', '不用了'].includes(content)) {
      await this.pending.delete(pendingKeyOf(msg));
      await channelAdapter.reply(msg, '已取消操作');
      return { handled: true, resultData: { aborted: '用户取消' } };
    }

    // 复用挂起时记录的 alias，确认阶段不会漂到别的资源上
    const binding = this.config.getBinding(action.sceneId, action.bindingAlias);
    if (!binding || binding.kind !== 'table') {
      // 表格映射在 PendingAction 窗口内被管理员删除：主动清掉 pending 并提示，
      // 避免用户卡在等待态直到 TTL 超时（60s 内所有消息都被拦截）
      await this.pending.delete(pendingKeyOf(msg));
      await channelAdapter.reply(
        msg,
        '⚠️ 表格配置已变更，刚才的操作已作废，请重新发送指令',
      );
      return { handled: true, resultData: { aborted: '资源绑定已变更' } };
    }
    const tableConfig = tableConfigOf(binding);
    const adapter = getSpreadsheetAdapter(binding.provider);
    const scene = this.registry.getById(action.sceneId);

    // 挂起的四种交互全是写操作。挂起时已校验过写权限，这里再查一次
    // 是为了覆盖 TTL 窗口内被管理员撤权的情形。
    //
    // 场景取不到（被停用/删除/改了 sceneId）时必须一并作废：写成
    // `if (scene && !scene.allowsWrite(...))` 会让整段校验被短路 ——
    // 场景刚被停用，60s 窗口内的"确认删除"照样把记录删掉。
    if (!scene) {
      await this.pending.delete(pendingKeyOf(msg));
      await channelAdapter.reply(
        msg,
        '⚠️ 场景配置已变更，刚才的操作已作废，请重新发送指令',
      );
      return { handled: true, resultData: { aborted: '场景已停用或删除' } };
    }
    const denial = scene.writeDenial(msg.senderId, msg.chatId);
    if (denial) {
      await this.pending.delete(pendingKeyOf(msg));
      await channelAdapter.reply(
        msg,
        `🔒 写入权限已变更，刚才的操作已作废\n${writeDenialMessage(denial, scene.name)}`,
      );
      return {
        handled: true,
        resultData: { aborted: WRITE_DENIAL_LOG[denial] },
      };
    }

    if (action.type === 'confirm_delete' && content.includes('确认删除')) {
      await this.pending.delete(pendingKeyOf(msg));
      // 并发删除并汇总成功/失败：串行 await 中途抛错会让已删的记录无法回滚、
      // 未删的记录留在表里、用户却只能看到兜底的"服务繁忙"。
      // 并发度受闸门限制，避免打满平台写接口 QPS 后大面积 429。
      const results = await runWithConcurrency(
        action.candidates.map(
          (record) => () => adapter.deleteRecord(tableConfig, record.recordId),
        ),
        DESTRUCTIVE_CONCURRENCY,
      );
      const failed = results.filter((r) => r.status === 'rejected');
      const okCount = results.length - failed.length;
      const deletedIds = action.candidates
        .filter((_, i) => results[i]?.status === 'fulfilled')
        .map((r) => r.recordId);
      if (failed.length === 0) {
        await channelAdapter.reply(msg, `✅ 已删除 ${okCount} 条记录`);
        return {
          handled: true,
          intent: 'DELETE',
          resultData: { deleted: okCount, recordIds: deletedIds },
        };
      }
      const firstErr =
        failed[0]?.status === 'rejected'
          ? String((failed[0] as PromiseRejectedResult).reason)
          : '';
      console.error('[Dispatcher] 批量删除部分失败:', failed);
      await channelAdapter.reply(
        msg,
        `⚠️ 已删除 ${okCount}/${results.length} 条，${failed.length} 条失败${firstErr ? `（首条原因：${firstErr.slice(0, 100)}）` : ''}`,
      );
      return {
        handled: true,
        intent: 'DELETE',
        errorMsg: `批量删除 ${failed.length}/${results.length} 条失败：${firstErr.slice(0, 200)}`,
        resultData: {
          deleted: okCount,
          failed: failed.length,
          recordIds: deletedIds,
        },
      };
    }

    if (action.type === 'confirm_update') {
      // 与 confirm_delete 对齐：单条 UPDATE 必须显式"确认更新"才执行
      if (content.includes('确认更新')) {
        await this.pending.delete(pendingKeyOf(msg));
        const target = action.candidates[0];
        if (!target) return { handled: false };
        return this.runConfirmedWrite(
          msg,
          channelAdapter,
          'UPDATE',
          {
            recordId: target.recordId,
            fieldKeys: Object.keys(action.updateFields ?? {}),
          },
          () =>
            adapter.updateRecord(
              tableConfig,
              target.recordId,
              action.updateFields ?? {},
            ),
          (updated) =>
            scene.formatReply(
              {
                intent: 'UPDATE',
                fields: action.updateFields ?? {},
                confidence: 1,
                summary: '更新记录',
              },
              { success: true, record: updated },
              tableConfig.fieldMapping,
              channelAdapter.maxReplyBytes,
            ),
        );
      }
      return { handled: false };
    }

    if (action.type === 'confirm_upsert') {
      // 仅匹配精确确认词组，避免吞掉用户的正常业务消息
      // （如"等下，把今天进度更新到表里" 会包含"更新"二字）
      if (
        content.includes('确认更新') ||
        content.includes('确认合并') ||
        content === '合并'
      ) {
        await this.pending.delete(pendingKeyOf(msg));
        const target = action.candidates[0];
        if (!target) return { handled: false };
        return this.runConfirmedWrite(
          msg,
          channelAdapter,
          'UPDATE',
          {
            merged: true,
            recordId: target.recordId,
            fieldKeys: Object.keys(action.updateFields ?? {}),
          },
          () =>
            adapter.updateRecord(
              tableConfig,
              target.recordId,
              action.updateFields ?? {},
            ),
          (updated) =>
            scene.formatReply(
              {
                intent: 'UPDATE',
                fields: action.updateFields ?? {},
                confidence: 1,
                summary: '已合并到现有记录',
              },
              { success: true, record: updated },
              tableConfig.fieldMapping,
              channelAdapter.maxReplyBytes,
            ),
        );
      }
      if (content.includes('强制新建') || content.includes('新建一条')) {
        await this.pending.delete(pendingKeyOf(msg));
        return this.runConfirmedWrite(
          msg,
          channelAdapter,
          'CREATE',
          {
            forced: true,
            fieldKeys: Object.keys(action.updateFields ?? {}),
          },
          () => adapter.createRecord(tableConfig, action.updateFields ?? {}),
          (record) =>
            scene.formatReply(
              {
                intent: 'CREATE',
                fields: action.updateFields ?? {},
                confidence: 1,
                summary: '强制新建',
              },
              { success: true, record },
              tableConfig.fieldMapping,
              channelAdapter.maxReplyBytes,
            ),
        );
      }
      return { handled: false };
    }

    if (action.type === 'select_record') {
      // 「全部」：把命中的每一条都改掉。以前只能一条条点序号 ——
      // DELETE 早就支持批量，UPDATE 不支持是个没有理由的不对称，
      // 「把 9 月所有已发货改成已收货」这种需求根本没法做。
      // 精确匹配词组，避免吞掉正常业务消息。
      if (['全部', '全部更新', '都改', '都更新'].includes(content)) {
        return this.updateAll(msg, action, channelAdapter, () =>
          getSpreadsheetAdapter(binding.provider),
        );
      }

      // 整条消息必须**只**是一个序号（允许「第2条」这类写法）。
      // 以前直接 Number.parseInt(content)：宽松解析会截取前缀数字，
      // 于是待选状态下一句正常业务消息「2条记录都改成完成」被当成
      // "选第 2 条"，静默更新了用户根本没选的那条记录。
      const picked = /^第?(\d+)\s*条?$/.exec(content);
      if (!picked?.[1]) return { handled: false };
      const num = Number.parseInt(picked[1], 10);
      // 上界是**展示出来的**条数，不是候选总数。
      //
      // 缺省值刻意取保守的那一侧：曾经写成 `?? candidates.length`，
      // 而 selectableCount 又漏了持久化 —— 内存存储一切正常、测试全绿，
      // 走 DB 的生产环境读回 undefined 后上界变成候选总数，用户回一个 15
      // 就能更新一条自己从没见过的记录。字段丢失时应该更严，不是更松。
      const maxPick = Math.min(
        action.selectableCount ?? MAX_CANDIDATE_DISPLAY,
        action.candidates.length,
      );
      if (num < 1 || num > maxPick) return { handled: false };
      await this.pending.delete(pendingKeyOf(msg));
      // biome-ignore lint/style/noNonNullAssertion: num 已校验在 [1, candidates.length] 范围内
      const target = action.candidates[num - 1]!;
      return this.runConfirmedWrite(
        msg,
        channelAdapter,
        'UPDATE',
        {
          picked: num,
          candidateCount: action.candidates.length,
          recordId: target.recordId,
          fieldKeys: Object.keys(action.updateFields ?? {}),
        },
        () =>
          adapter.updateRecord(
            tableConfig,
            target.recordId,
            action.updateFields ?? {},
          ),
        (updated) =>
          scene.formatReply(
            {
              intent: 'UPDATE',
              fields: action.updateFields ?? {},
              confidence: 1,
              summary: '更新记录',
            },
            { success: true, record: updated },
            tableConfig.fieldMapping,
            channelAdapter.maxReplyBytes,
          ),
      );
    }

    return { handled: false };
  }

  private getHelpText(chatId?: string): string {
    const scenes = this.registry.scenesForChat(chatId);
    if (scenes.length === 0) return '🤖 当前没有可用的业务场景';
    const list = scenes.map((s) => `• ${s.name}: ${s.description}`).join('\n');
    return `🤖 我可以帮你处理以下业务：\n\n${list}\n\n直接 @我 发送消息即可！`;
  }
}
