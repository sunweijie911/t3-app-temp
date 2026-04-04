import type {
  ExecuteResult,
  ParsedIntent,
  SceneContext,
} from '../../core/types';
import type { BotScene } from '../types';
import { getTasksSystemPrompt } from './prompt';

const KEYWORDS = ['任务', '启动', '提测', '上线', '排期', '进度', '开发'];

export class TasksScene implements BotScene {
  readonly id = 'tasks';
  readonly name = '任务跟踪';
  readonly description =
    '从群聊消息中提取任务信息（负责人、任务名、状态、排期等），写入多维表格';

  match(content: string): number {
    const matched = KEYWORDS.filter((kw) => content.includes(kw));
    return matched.length > 0 ? matched.length / KEYWORDS.length : 0;
  }

  getSystemPrompt(ctx: SceneContext): string {
    return getTasksSystemPrompt(ctx.today);
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

    if (intent.intent === 'CREATE' && result.record) {
      const f = result.record.fields;
      const lines = ['✅ 已录入任务', ''];
      if (f.task) lines.push(`任务：${f.task}`);
      if (f.assignee) lines.push(`负责人：${f.assignee}`);
      if (f.status) lines.push(`状态：${f.status}`);
      if (f.startDate) lines.push(`启动日期：${f.startDate}`);
      if (f.testDate) lines.push(`预计提测：${f.testDate}`);
      if (f.releaseType) lines.push(`上线方式：${f.releaseType}`);
      return lines.join('\n');
    }

    if (intent.intent === 'QUERY' && result.records) {
      if (result.records.length === 0) return '📊 查询结果: 未找到匹配任务';
      const items = result.records.map((r, i) => {
        const f = r.fields;
        return `${i + 1}. ${f.task ?? '-'} | ${f.assignee ?? '-'} | ${f.status ?? '-'}`;
      });
      return `📊 查询结果 (共 ${result.records.length} 条)\n${items.join('\n')}`;
    }

    if (intent.intent === 'UPDATE') return '✅ 已更新任务';
    if (intent.intent === 'DELETE') return '✅ 已删除任务';
    return '✅ 操作完成';
  }
}
