import type { ChannelAdapter } from '../channels/types';
import {
  CONFIDENCE_THRESHOLD,
  DESTRUCTIVE_CONCURRENCY,
  MAX_CANDIDATE_DISPLAY,
  MAX_DESTRUCTIVE_BATCH,
} from '../constants';
import type { BotScene } from '../scenes/types';
import { getSpreadsheetAdapter } from '../spreadsheets/factory';
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
  SpreadsheetRecord,
  UnifiedMessage,
} from './types';
import { tableConfigOf } from './types';

interface DispatcherConfig {
  /**
   * 解析场景绑定的资源。`alias` 省略时返回该场景的默认资源。
   *
   * 注意签名里**没有 platform** —— 数据在哪个平台由绑定自己的 provider 决定，
   * 与消息来自哪个 IM 无关。以前是 getTableConfig(sceneId, msg.platform)。
   */
  getBinding: (sceneId: string, alias?: string) => ResourceBinding | null;
  onEvent?: (event: BotEvent) => void;
  /**
   * 幂等与待确认状态的存储。默认是进程内实现，**只适合单实例和测试**；
   * 多实例部署必须注入 DB 实现，否则平台重试会重复写数据、
   * 用户的"确认删除"可能落到查不到 pending 的实例上。
   */
  dedupStore?: DedupStore;
  pendingStore?: PendingActionStore;
}

/**
 * 判断 filters 是否含有「有效」筛选键。
 * 排除以 _ 开头的保留键（如 _conjunction），这些键会被下游 queryRecords 跳过，
 * 不能作为筛选条件。用于 UPDATE/DELETE 前的空值守卫，防止保留键绕过判空导致全表命中。
 */
function hasEffectiveFilters(
  filters: Record<string, unknown> | null | undefined,
): boolean {
  if (!filters) return false;
  return Object.entries(filters).some(
    // 值为空也算无效：LLM 返回 {"状态": ""} 时下游会生成 `is ['']` 条件，
    // 匹配范围不可控，不能当成"用户指定了筛选条件"
    ([key, value]) =>
      !key.startsWith('_') && value != null && value !== '' && value !== '*',
  );
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
    const logEvent = (partial: Partial<BotEvent>) => {
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
      this.config.onEvent?.(event);
    };

    try {
      // 1. 幂等占坑（PendingAction 之前先做，否则平台重试同一 eventId 时
      //    pendingAction 已被处理删除，会走到正常场景匹配链白白消耗 LLM token）。
      //    claim 是原子的：抢不到说明这条事件已被处理过。
      const claimed = await this.dedup.claim(msg.platform, msg.eventId);
      if (!claimed) {
        logEvent({ result: 'ignored' });
        return;
      }

      // 2. PendingAction
      const pendingKey = pendingKeyOf(msg);
      const pendingAction = await this.pending.get(pendingKey);
      if (pendingAction) {
        const handled = await this.handlePendingAction(
          msg,
          pendingAction,
          channelAdapter,
        );
        if (handled) {
          logEvent({ sceneId: pendingAction.sceneId, result: 'success' });
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
        logEvent({ sceneId: pendingAction.sceneId, result: 'ignored' });
        return;
      }

      // 3. 场景匹配
      let scene = this.registry.matchByKeyword(msg.content);
      if (!scene) {
        scene = await this.registry.matchByLLM(msg.content);
      }
      if (!scene) {
        await channelAdapter.reply(msg, this.getHelpText());
        logEvent({ result: 'ignored' });
        return;
      }

      // 4. LLM 意图解析
      const ctx = {
        today: new Date().toISOString().slice(0, 10),
        senderName: msg.senderName,
        chatName: msg.chatName,
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
        logEvent({
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
        logEvent({
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
        logEvent({
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
        logEvent({
          sceneId: scene.id,
          intent: parsed.intent,
          result: 'ignored',
          errorMsg: 'UNKNOWN 意图',
        });
        return;
      }

      // 7. 执行 CRUD
      const result = await this.executeCrud(scene, parsed, msg);

      // 8. 回复（fieldMapping 用于渲染时取 label / displayType；缺失时退化为 logicalKey）
      const binding = this.config.getBinding(scene.id);
      const reply = scene.formatReply(parsed, result, binding?.fieldMapping);
      await channelAdapter.reply(msg, reply);
      logEvent({
        sceneId: scene.id,
        intent: parsed.intent,
        result: result.success ? 'success' : 'error',
        resultData: result,
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
      logEvent({
        result: 'error',
        errorMsg: err instanceof Error ? err.message : '未知错误',
      });
    }
  }

  private async executeCrud(
    scene: BotScene,
    parsed: ParsedIntent,
    msg: UnifiedMessage,
  ): Promise<ExecuteResult> {
    const binding = this.config.getBinding(scene.id);
    if (!binding) {
      return {
        success: false,
        error: `场景 "${scene.name}" 未配置数据资源绑定`,
      };
    }
    if (binding.kind !== 'table') {
      return {
        success: false,
        error: `场景 "${scene.name}" 绑定的资源「${binding.alias}」是 ${binding.kind} 类型，当前只支持表格`,
      };
    }
    const tableConfig = tableConfigOf(binding);

    // adapter 按**数据所在平台**选，而不是消息来源平台 —— 这是跨平台访问的落点
    const adapter = getSpreadsheetAdapter(binding.provider);

    switch (parsed.intent) {
      case 'CREATE': {
        // 仅当 fieldMapping 显式声明 operator 字段时才注入操作人
        // (避免对没有"录入人"字段的飞书表写入未知字段触发 InvalidField 错误)
        const fields = tableConfig.fieldMapping.operator
          ? { ...parsed.fields, operator: msg.senderName }
          : parsed.fields;

        // 唯一键查重：命中已有记录时挂起 PendingAction，等用户确认转 UPDATE
        const uniqueKey = tableConfig.uniqueKey;
        const uniqueValue = uniqueKey ? fields[uniqueKey] : undefined;
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
              updateFields: fields,
            });
            return {
              success: false,
              error: `已存在 ${existing.length} 条「${uniqueKey}=${String(uniqueValue)}」的记录。回复"确认更新"将合并到第 1 条；回复"取消"放弃；回复"强制新建"仍按新记录创建`,
            };
          }
        }

        const record = await adapter.createRecord(tableConfig, fields);
        return {
          success: true,
          record: { ...record, fields: { ...fields, ...record.fields } },
        };
      }

      case 'QUERY': {
        const records = await adapter.queryRecords(
          tableConfig,
          parsed.filters ?? {},
        );
        return { success: true, records };
      }

      case 'UPDATE': {
        // 仅统计有效筛选键（排除以 _ 开头的保留键，如 _conjunction），
        // 否则 LLM 返回 {"_conjunction":"or"} 会绕过空判断，
        // 下游 queryRecords 跳过保留键后 filter 为空 → 命中全表 → 全表挂入待更新。
        if (!parsed.filters || !hasEffectiveFilters(parsed.filters)) {
          return { success: false, error: '更新操作需要指定筛选条件' };
        }
        const records = await adapter.queryRecords(tableConfig, parsed.filters);
        if (records.length === 0)
          return { success: false, error: '未找到匹配记录' };
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
              updateFields: parsed.fields,
            });
            const changes = Object.entries(parsed.fields)
              .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
              .join('\n');
            return {
              success: false,
              error: `确认更新 1 条记录？\n变更字段：\n${changes}\n\n回复"确认更新"执行，回复"取消"放弃`,
            };
          }
        }
        if (records.length > MAX_DESTRUCTIVE_BATCH) {
          return {
            success: false,
            error: `匹配到 ${records.length} 条记录，超过单次可操作上限 ${MAX_DESTRUCTIVE_BATCH} 条。请补充更精确的筛选条件后重试`,
          };
        }
        await this.pending.set(pendingKeyOf(msg), {
          sceneId: scene.id,
          bindingAlias: binding.alias,
          type: 'select_record',
          candidates: records,
          message: msg,
          updateFields: parsed.fields,
        });
        return {
          success: false,
          error: `找到 ${records.length} 条匹配记录，请回复序号选择：\n${renderCandidateList(records, tableConfig.fieldMapping)}`,
        };
      }

      case 'DELETE': {
        // 同 UPDATE：排除保留键后再判空，防止保留键绕过守卫导致全表删除放大。
        if (!parsed.filters || !hasEffectiveFilters(parsed.filters)) {
          return { success: false, error: '删除操作需要指定筛选条件' };
        }
        const records = await adapter.queryRecords(tableConfig, parsed.filters);
        if (records.length === 0)
          return { success: false, error: '未找到匹配记录' };
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
          error: `确认删除以下 ${records.length} 条记录？\n${renderCandidateList(records, tableConfig.fieldMapping)}\n\n回复"确认删除"执行，回复"取消"放弃`,
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
  ): Promise<boolean> {
    const content = msg.content.trim();

    // 精确匹配避免误吞业务消息（如"算了一下今天的销售额"被当成取消）
    if (['取消', '算了', '不用了'].includes(content)) {
      await this.pending.delete(pendingKeyOf(msg));
      await channelAdapter.reply(msg, '已取消操作');
      return true;
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
      return true;
    }
    const tableConfig = tableConfigOf(binding);
    const adapter = getSpreadsheetAdapter(binding.provider);
    const scene = this.registry.getById(action.sceneId);

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
      }
      return true;
    }

    if (action.type === 'confirm_update') {
      // 与 confirm_delete 对齐：单条 UPDATE 必须显式"确认更新"才执行
      if (content.includes('确认更新')) {
        await this.pending.delete(pendingKeyOf(msg));
        const target = action.candidates[0];
        if (!target) return false;
        const updated = await adapter.updateRecord(
          tableConfig,
          target.recordId,
          action.updateFields ?? {},
        );
        const reply =
          scene?.formatReply(
            {
              intent: 'UPDATE',
              fields: action.updateFields ?? {},
              confidence: 1,
              summary: '更新记录',
            },
            { success: true, record: updated },
            tableConfig.fieldMapping,
          ) ?? '✅ 已更新记录';
        await channelAdapter.reply(msg, reply);
        return true;
      }
      return false;
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
        if (!target) return false;
        const updated = await adapter.updateRecord(
          tableConfig,
          target.recordId,
          action.updateFields ?? {},
        );
        const reply =
          scene?.formatReply(
            {
              intent: 'UPDATE',
              fields: action.updateFields ?? {},
              confidence: 1,
              summary: '已合并到现有记录',
            },
            { success: true, record: updated },
            tableConfig.fieldMapping,
          ) ?? '✅ 已更新记录';
        await channelAdapter.reply(msg, reply);
        return true;
      }
      if (content.includes('强制新建') || content.includes('新建一条')) {
        await this.pending.delete(pendingKeyOf(msg));
        const record = await adapter.createRecord(
          tableConfig,
          action.updateFields ?? {},
        );
        const reply =
          scene?.formatReply(
            {
              intent: 'CREATE',
              fields: action.updateFields ?? {},
              confidence: 1,
              summary: '强制新建',
            },
            { success: true, record },
            tableConfig.fieldMapping,
          ) ?? '✅ 已新建记录';
        await channelAdapter.reply(msg, reply);
        return true;
      }
      return false;
    }

    if (action.type === 'select_record') {
      const num = Number.parseInt(content, 10);
      if (Number.isNaN(num) || num < 1 || num > action.candidates.length)
        return false;
      await this.pending.delete(pendingKeyOf(msg));
      // biome-ignore lint/style/noNonNullAssertion: num 已校验在 [1, candidates.length] 范围内
      const target = action.candidates[num - 1]!;
      const updated = await adapter.updateRecord(
        tableConfig,
        target.recordId,
        action.updateFields ?? {},
      );
      const reply =
        scene?.formatReply(
          {
            intent: 'UPDATE',
            fields: action.updateFields ?? {},
            confidence: 1,
            summary: '更新记录',
          },
          { success: true, record: updated },
          tableConfig.fieldMapping,
        ) ?? '✅ 已更新记录';
      await channelAdapter.reply(msg, reply);
      return true;
    }

    return false;
  }

  private getHelpText(): string {
    const scenes = this.registry.getScenes();
    if (scenes.length === 0) return '🤖 当前没有可用的业务场景';
    const list = scenes.map((s) => `• ${s.name}: ${s.description}`).join('\n');
    return `🤖 我可以帮你处理以下业务：\n\n${list}\n\n直接 @我 发送消息即可！`;
  }
}
