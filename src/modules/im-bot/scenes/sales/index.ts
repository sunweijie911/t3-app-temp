import type {
  ExecuteResult,
  ParsedIntent,
  SceneContext,
} from '../../core/types';
import type { BotScene } from '../types';
import { getSalesSystemPrompt } from './prompt';

const KEYWORDS = [
  // CREATE
  '卖了',
  '发了',
  '发货',
  '成本',
  '售价',
  '单号',
  '快递',
  // QUERY / UPDATE / DELETE
  '查看',
  '查一下',
  '销售',
  '订单',
  '记录',
  '商品',
];

export class SalesScene implements BotScene {
  readonly id = 'sales';
  readonly name = '销售记录';
  readonly description =
    '从群聊消息中提取销售数据（商品、成本、售价、快递等），写入多维表格';

  match(content: string): number {
    const matched = KEYWORDS.filter((kw) => content.includes(kw));
    return matched.length > 0 ? matched.length / KEYWORDS.length : 0;
  }

  getSystemPrompt(ctx: SceneContext): string {
    return getSalesSystemPrompt(ctx.today);
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
      const lines = ['✅ 已录入销售记录', ''];
      if (f.product) lines.push(`商品：${f.product}`);
      if (f.tags && Array.isArray(f.tags) && f.tags.length > 0)
        lines.push(`标签：${f.tags.join(' | ')}`);
      if (f.cost != null || f.price != null)
        lines.push(`成本/售价：¥${f.cost ?? '-'} / ¥${f.price ?? '-'}`);
      if (f.courier)
        lines.push(
          `快递：${f.courier}${f.trackingNo ? ` | 单号：${f.trackingNo}` : ''}`,
        );
      if (f.operator) lines.push(`操作人：${f.operator}`);
      return lines.join('\n');
    }

    if (intent.intent === 'QUERY' && result.records) {
      if (result.records.length === 0) return '📊 查询结果: 未找到匹配记录';
      const items = result.records.map((r, i) => {
        const f = r.fields;
        return `${i + 1}. ${f.product ?? '-'} | ¥${f.cost ?? '-'}/¥${f.price ?? '-'}${f.courier ? ` | ${f.courier}` : ''}`;
      });
      return `📊 查询结果 (共 ${result.records.length} 条)\n${items.join('\n')}`;
    }

    if (intent.intent === 'UPDATE') return '✅ 已更新记录';
    if (intent.intent === 'DELETE') return '✅ 已删除记录';
    return '✅ 操作完成';
  }
}
