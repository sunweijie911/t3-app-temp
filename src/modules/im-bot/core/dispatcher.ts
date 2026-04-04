import type { ChannelAdapter } from '../channels/types';
import { CONFIDENCE_THRESHOLD } from '../constants';
import type { BotScene } from '../scenes/types';
import { getSpreadsheetAdapter } from '../spreadsheets/factory';
import { MemoryDedupStore } from './dedup';
import { chatCompletion, extractJson } from './llm';
import { MemoryPendingActionStore } from './pending-action';
import { SceneRegistry } from './scene-registry';
import type {
  BotEvent,
  ExecuteResult,
  ParsedIntent,
  PendingAction,
  SpreadsheetTableConfig,
  UnifiedMessage,
} from './types';

interface DispatcherConfig {
  getTableConfig: (
    sceneId: string,
    platform: string,
  ) => SpreadsheetTableConfig | null;
  onEvent?: (event: BotEvent) => void;
}

export class Dispatcher {
  readonly registry = new SceneRegistry();
  private dedup = new MemoryDedupStore();
  private pending = new MemoryPendingActionStore();
  private config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    this.config = config;
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
      // 1. PendingAction
      const pendingAction = this.pending.get(msg.chatId, msg.senderId);
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
        await channelAdapter.reply(
          msg,
          pendingAction.type === 'confirm_delete'
            ? '请回复"确认删除"执行，或回复"取消"放弃'
            : `请回复序号(1~${pendingAction.candidates.length})选择，或回复"取消"放弃`,
        );
        logEvent({ sceneId: pendingAction.sceneId, result: 'ignored' });
        return;
      }

      // 2. 去重
      if (this.dedup.has(msg.eventId)) {
        logEvent({ result: 'ignored' });
        return;
      }
      this.dedup.set(msg.eventId);

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
      const llmOutput = await chatCompletion(systemPrompt, msg.content);

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

      // 7. 执行 CRUD
      const result = await this.executeCrud(scene, parsed, msg);

      // 8. 回复
      const reply = scene.formatReply(parsed, result);
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
        .catch(() => {});
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
    const tableConfig = this.config.getTableConfig(scene.id, msg.platform);
    if (!tableConfig) {
      return {
        success: false,
        error: `场景 "${scene.name}" 未配置 ${msg.platform} 平台的表格映射`,
      };
    }

    const adapter = getSpreadsheetAdapter(msg.platform);

    switch (parsed.intent) {
      case 'CREATE': {
        const fields = { ...parsed.fields, operator: msg.senderName };
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
        if (!parsed.filters || Object.keys(parsed.filters).length === 0) {
          return { success: false, error: '更新操作需要指定筛选条件' };
        }
        const records = await adapter.queryRecords(tableConfig, parsed.filters);
        if (records.length === 0)
          return { success: false, error: '未找到匹配记录' };
        if (records.length === 1) {
          const target = records[0];
          if (target) {
            const updated = await adapter.updateRecord(
              tableConfig,
              target.recordId,
              parsed.fields,
            );
            return { success: true, record: updated };
          }
        }
        this.pending.set(msg.chatId, msg.senderId, {
          sceneId: scene.id,
          type: 'select_record',
          candidates: records,
          message: msg,
          updateFields: parsed.fields,
        });
        return {
          success: false,
          error: `找到 ${records.length} 条匹配记录，请回复序号选择：\n${records.map((r, i) => `${i + 1}. ${JSON.stringify(r.fields)}`).join('\n')}`,
        };
      }

      case 'DELETE': {
        if (!parsed.filters || Object.keys(parsed.filters).length === 0) {
          return { success: false, error: '删除操作需要指定筛选条件' };
        }
        const records = await adapter.queryRecords(tableConfig, parsed.filters);
        if (records.length === 0)
          return { success: false, error: '未找到匹配记录' };
        this.pending.set(msg.chatId, msg.senderId, {
          sceneId: scene.id,
          type: 'confirm_delete',
          candidates: records,
          message: msg,
        });
        return {
          success: false,
          error: `确认删除 ${records.length} 条记录？回复"确认删除"执行，回复"取消"放弃`,
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

    if (['取消', '算了', '不用了'].some((kw) => content.includes(kw))) {
      this.pending.delete(msg.chatId, msg.senderId);
      await channelAdapter.reply(msg, '已取消操作');
      return true;
    }

    const tableConfig = this.config.getTableConfig(
      action.sceneId,
      msg.platform,
    );
    if (!tableConfig) return false;
    const adapter = getSpreadsheetAdapter(msg.platform);
    const scene = this.registry.getById(action.sceneId);

    if (action.type === 'confirm_delete' && content.includes('确认删除')) {
      this.pending.delete(msg.chatId, msg.senderId);
      for (const record of action.candidates) {
        await adapter.deleteRecord(tableConfig, record.recordId);
      }
      await channelAdapter.reply(
        msg,
        `✅ 已删除 ${action.candidates.length} 条记录`,
      );
      return true;
    }

    if (action.type === 'select_record') {
      const num = Number.parseInt(content, 10);
      if (Number.isNaN(num) || num < 1 || num > action.candidates.length)
        return false;
      this.pending.delete(msg.chatId, msg.senderId);
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
