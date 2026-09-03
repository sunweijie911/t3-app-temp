import type { ChannelAdapter } from '../channels/types';
import {
  CONFIDENCE_THRESHOLD,
  DESTRUCTIVE_CONCURRENCY,
  MAX_CANDIDATE_DISPLAY,
  MAX_DESTRUCTIVE_BATCH,
} from '../constants';
import { documentConfigOf, getDocumentAdapter } from '../documents/factory';
import type { BotScene } from '../scenes/types';
import { getSpreadsheetAdapter } from '../spreadsheets/factory';
import type { SpreadsheetAdapter } from '../spreadsheets/types';
import { MemoryDedupStore } from './dedup';
import { renderRecordSummary } from './field-render';
import { chatCompletion, extractJson } from './llm';
import { MemoryPendingActionStore } from './pending-action';
import { SceneRegistry } from './scene-registry';
import type { DedupStore, PendingActionStore } from './stores';
import { pendingKeyOf } from './stores';
import type {
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
}

/** 该筛选项是否构成一个真正的条件 */
function isEffectiveFilter(key: string, value: unknown): boolean {
  // `_` 开头是协议保留键（如 _conjunction），下游 queryRecords 会跳过，
  // 不能算作用户指定的筛选条件
  if (key.startsWith('_')) return false;
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
    // 确认提示里带的是已脱敏的候选摘要，仍然只留个头部够定位就行
    ...(result.error ? { error: result.error.slice(0, 200) } : {}),
  };
}

/**
 * 渲染候选记录列表（UPDATE 多条命中 / DELETE 确认）。
 * 必须走 renderRecordSummary —— 以前这里直接 JSON.stringify(r.fields)，
 * 既绕过 sensitive/字段名脱敏，也不做长度截断。
 */
function renderCandidateList(
  records: SpreadsheetRecord[],
  fieldMapping?: Record<string, FieldMappingValue>,
): string {
  const shown = records.slice(0, MAX_CANDIDATE_DISPLAY);
  const lines = shown.map(
    (r, i) => `${i + 1}. ${renderRecordSummary(r.fields, fieldMapping)}`,
  );
  const rest =
    records.length > shown.length
      ? `\n…（共 ${records.length} 条，仅列出前 ${shown.length} 条；如需选择更后面的记录请缩窄筛选条件）`
      : '';
  return lines.join('\n') + rest;
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
}

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
  private config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    this.config = config;
    this.dedup = config.dedupStore ?? new MemoryDedupStore();
    this.pending = config.pendingStore ?? new MemoryPendingActionStore();
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
            result: outcome.errorMsg ? 'error' : 'success',
            errorMsg: outcome.errorMsg,
          });
          return;
        }
        // 无法识别的输入：提示用户并保留 PendingAction，不走正常流程
        const promptByType: Record<PendingAction['type'], string> = {
          confirm_delete: '请回复"确认删除"执行，或回复"取消"放弃',
          confirm_update: '请回复"确认更新"执行，或回复"取消"放弃',
          confirm_upsert:
            '请回复"确认更新"合并到现有记录，"强制新建"创建新记录，或"取消"放弃',
          select_record: `请回复序号(1~${pendingAction.candidates.length})选择，或回复"取消"放弃`,
        };
        await channelAdapter.reply(msg, promptByType[pendingAction.type]);
        await logEvent({ sceneId: pendingAction.sceneId, result: 'ignored' });
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
      const llmOutput = await chatCompletion(systemPrompt, msg.content);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Dispatcher] LLM 原始输出:', llmOutput.slice(0, 500));
      }

      // 5. JSON 提取 + 校验
      const jsonStr = extractJson(llmOutput);
      if (!jsonStr) {
        await channelAdapter.reply(
          msg,
          '🤔 无法理解您的消息，请用更明确的描述再试一次',
        );
        await logEvent({
          sceneId: scene.id,
          result: 'error',
          errorMsg: 'JSON 提取失败',
        });
        return;
      }

      const parsed = scene.parseResult(jsonStr);
      if (!parsed) {
        await channelAdapter.reply(
          msg,
          '🤔 无法理解您的消息，请用更明确的描述再试一次',
        );
        await logEvent({
          sceneId: scene.id,
          result: 'error',
          errorMsg: 'parseResult 失败',
        });
        return;
      }

      // 6. 置信度
      if (parsed.confidence < CONFIDENCE_THRESHOLD) {
        await channelAdapter.reply(
          msg,
          `🤔 不太确定您的意图，解析结果：${parsed.summary}\n\n请用更明确的描述再试一次`,
        );
        await logEvent({
          sceneId: scene.id,
          intent: parsed.intent,
          result: 'error',
          errorMsg: '置信度不足',
        });
        return;
      }

      // 6.5 UNKNOWN 意图：高置信但 LLM 也没拿准 → 给引导而非走到 executeCrud 落 default 错误
      if (parsed.intent === 'UNKNOWN') {
        await channelAdapter.reply(
          msg,
          `🤔 暂时不知道您想做什么：${parsed.summary || '没拿到具体操作'}\n\n可以试试：\n• 查询：「${scene.name} ...的 xxx」\n• 新增：「新增/记录 ...」\n• 更新：「把 ... 改成 ...」\n• 删除：「删除 ...」`,
        );
        await logEvent({
          sceneId: scene.id,
          intent: parsed.intent,
          result: 'ignored',
          errorMsg: 'UNKNOWN 意图',
        });
        return;
      }

      // 6.6 写权限：只拦改动数据的意图，查询不受限。
      //     放在 execute 之前 —— 拦在真正落库前，且不消耗额外的平台调用
      if (isWriteIntent(parsed.intent) && !scene.allowsWrite(msg.senderId)) {
        await channelAdapter.reply(
          msg,
          `🔒 你没有「${scene.name}」的写入权限，可以查询但不能新增/修改/删除。\n如需权限请联系管理员`,
        );
        await logEvent({
          sceneId: scene.id,
          intent: parsed.intent,
          result: 'ignored',
          errorMsg: '无写入权限',
        });
        return;
      }

      // 7. 执行 CRUD
      const result = await this.execute(scene, parsed, msg);

      // 8. 回复（fieldMapping 用于渲染时取 label / displayType；缺失时退化为 logicalKey）
      const binding = this.config.getBinding(scene.id, parsed.resource);
      const reply = scene.formatReply(parsed, result, binding?.fieldMapping);
      // 被丢弃的字段必须点名：否则用户以为自己说的内容都记下来了
      const dropped = result.droppedFields?.length
        ? `\n\n⚠️ 已忽略未配置的字段：${result.droppedFields.join('、')}`
        : '';
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
        resultData: summarizeResult(result),
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
      return await this.executeTable(binding, scene, parsed, msg);
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
          const existing = await adapter.queryRecords(tableConfig, {
            [uniqueKey]: uniqueValue,
          });
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
        // 只把**展示出来的**候选存进 pending：序号校验的上界是 candidates.length，
        // 存全量而只列前 10 条时，用户可以回一个 15 去更新一条自己从没见过的记录
        const selectable = records.slice(0, MAX_CANDIDATE_DISPLAY);
        await this.pending.set(pendingKeyOf(msg), {
          sceneId: scene.id,
          bindingAlias: binding.alias,
          type: 'select_record',
          candidates: selectable,
          message: msg,
          updateFields: fields,
        });
        return {
          success: false,
          awaitingConfirmation: true,
          error: `找到 ${records.length} 条匹配记录，请回复序号选择：\n${renderCandidateList(records, tableConfig.fieldMapping)}${limitWarning}`,
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
        return {
          success: false,
          awaitingConfirmation: true,
          error: `确认删除以下 ${records.length} 条记录？\n${renderCandidateList(records, tableConfig.fieldMapping)}${limitWarning}\n\n回复"确认删除"执行，回复"取消"放弃`,
        };
      }

      default:
        return { success: false, error: '无法识别的操作意图' };
    }
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
      return { handled: true };
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
      return { handled: true };
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
      return { handled: true };
    }
    if (!scene.allowsWrite(msg.senderId)) {
      await this.pending.delete(pendingKeyOf(msg));
      await channelAdapter.reply(
        msg,
        '🔒 你的写入权限已变更，刚才的操作已作废',
      );
      return { handled: true };
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
      if (failed.length === 0) {
        await channelAdapter.reply(msg, `✅ 已删除 ${okCount} 条记录`);
      } else {
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
          errorMsg: `批量删除 ${failed.length}/${results.length} 条失败：${firstErr.slice(0, 200)}`,
        };
      }
      return { handled: true };
    }

    if (action.type === 'confirm_update') {
      // 与 confirm_delete 对齐：单条 UPDATE 必须显式"确认更新"才执行
      if (content.includes('确认更新')) {
        await this.pending.delete(pendingKeyOf(msg));
        const target = action.candidates[0];
        if (!target) return { handled: false };
        const updated = await adapter.updateRecord(
          tableConfig,
          target.recordId,
          action.updateFields ?? {},
        );
        const reply = scene.formatReply(
          {
            intent: 'UPDATE',
            fields: action.updateFields ?? {},
            confidence: 1,
            summary: '更新记录',
          },
          { success: true, record: updated },
          tableConfig.fieldMapping,
        );
        await channelAdapter.reply(msg, reply);
        return { handled: true };
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
        const updated = await adapter.updateRecord(
          tableConfig,
          target.recordId,
          action.updateFields ?? {},
        );
        const reply = scene.formatReply(
          {
            intent: 'UPDATE',
            fields: action.updateFields ?? {},
            confidence: 1,
            summary: '已合并到现有记录',
          },
          { success: true, record: updated },
          tableConfig.fieldMapping,
        );
        await channelAdapter.reply(msg, reply);
        return { handled: true };
      }
      if (content.includes('强制新建') || content.includes('新建一条')) {
        await this.pending.delete(pendingKeyOf(msg));
        const record = await adapter.createRecord(
          tableConfig,
          action.updateFields ?? {},
        );
        const reply = scene.formatReply(
          {
            intent: 'CREATE',
            fields: action.updateFields ?? {},
            confidence: 1,
            summary: '强制新建',
          },
          { success: true, record },
          tableConfig.fieldMapping,
        );
        await channelAdapter.reply(msg, reply);
        return { handled: true };
      }
      return { handled: false };
    }

    if (action.type === 'select_record') {
      // 整条消息必须**只**是一个序号（允许「第2条」这类写法）。
      // 以前直接 Number.parseInt(content)：宽松解析会截取前缀数字，
      // 于是待选状态下一句正常业务消息「2条记录都改成完成」被当成
      // "选第 2 条"，静默更新了用户根本没选的那条记录。
      const picked = /^第?(\d+)\s*条?$/.exec(content);
      if (!picked?.[1]) return { handled: false };
      const num = Number.parseInt(picked[1], 10);
      if (num < 1 || num > action.candidates.length) return { handled: false };
      await this.pending.delete(pendingKeyOf(msg));
      // biome-ignore lint/style/noNonNullAssertion: num 已校验在 [1, candidates.length] 范围内
      const target = action.candidates[num - 1]!;
      const updated = await adapter.updateRecord(
        tableConfig,
        target.recordId,
        action.updateFields ?? {},
      );
      const reply = scene.formatReply(
        {
          intent: 'UPDATE',
          fields: action.updateFields ?? {},
          confidence: 1,
          summary: '更新记录',
        },
        { success: true, record: updated },
        tableConfig.fieldMapping,
      );
      await channelAdapter.reply(msg, reply);
      return { handled: true };
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
