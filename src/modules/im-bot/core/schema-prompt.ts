import { RESOURCE_KIND_LABELS } from '../constants';
import type { SceneResource } from './types';

/**
 * 把场景绑定的资源渲染成一段 system prompt。
 *
 * 为什么必须自动生成：以前字段清单是管理员在 systemPrompt 里手抄的，
 * 多维表加一列、改个列名都不会同步 —— LLM 继续按旧字段名输出（会被
 * 未知字段守卫拦下），而新字段它压根不知道存在，用户说了也记不进去。
 * 同理，一场景多资源时管理员还得手写 alias，LLM 才知道 resource 填什么。
 *
 * 放在管理员 prompt **之后**：业务规则先声明，机器生成的事实垫在最后，
 * 既离用户消息更近，也让"字段只能取这些"成为最后一道约束。
 */
export function renderResourceSchema(resources: SceneResource[]): string {
  if (resources.length === 0) return '';

  const blocks = resources.map((r) => {
    const kindLabel = RESOURCE_KIND_LABELS[r.kind];
    const flag = r.isDefault && resources.length > 1 ? '，默认资源' : '';
    const lines = [`### 「${r.alias}」— ${kindLabel}${flag}`];

    lines.push(
      r.actions.length > 0
        ? `- 可用 intent：${r.actions.join(' / ')}`
        : '- 该资源暂不支持任何操作',
    );

    if (r.fields.length > 0) {
      lines.push(
        '- fields 与 filters 的 key 只能取下列字段名，不要自创、不要翻译：',
      );
      for (const f of r.fields) {
        const notes = [f.hint, f.sensitive ? '回复中会脱敏' : undefined]
          .filter(Boolean)
          .join('；');
        lines.push(`  - ${f.key}${notes ? `（${notes}）` : ''}`);
        // 单选/多选的合法取值紧跟在字段下面。
        //
        // 这份清单以前要管理员**手抄进场景 prompt**（「支出分类：美妆产品 /
        // 进货 / …」），飞书里加一个选项就过期 —— LLM 挑一个不存在的值，
        // 平台要么拒收要么写进脏数据，而且没人会发现。
        // 现在从 fieldMapping 派生，与字段清单同源同步。
        if (f.options?.length) {
          lines.push(
            `    只能取：${f.options.join(' / ')}（原样取用，不得自造、不得改写）`,
          );
        }
      }
    }

    if (r.uniqueKey) {
      lines.push(
        `- 唯一键：${r.uniqueKey}（新增前按它查重，命中会转为确认更新）`,
      );
    }

    if (r.kind === 'doc') {
      lines.push('- APPEND 时把要写入的正文放在 fields.content');
    }

    // 聚合的请求结构必须写清楚，否则 LLM 只会把 AGGREGATE 当 QUERY 用
    if (r.actions.includes('AGGREGATE')) {
      lines.push(
        '- AGGREGATE 用于统计类问题：总共/合计/一共多少钱、平均、最大/最小/最高/最低/最多/最少、有几条/多少条、占比。把请求放在 aggregate：',
        '  {"op":"sum|count|avg|min|max","field":"要统计的数值字段","groupBy":"分组字段（可省略）"}',
        '  count 不需要 field；filters 与 QUERY 写法一致。',
        '  「最大/最小的是多少」问的是一个数值，用 AGGREGATE 的 max/min，不要用 QUERY 把明细全捞回来。',
        '  只有在用户要看具体记录时才用 QUERY。',
      );
    }

    return lines.join('\n');
  });

  const multi =
    resources.length > 1
      ? '\n\n用 resource 字段指定操作哪个资源（填上面引号里的名字）；省略则用默认资源。'
      : '';

  return `## 可操作的资源与字段（按当前配置自动生成，以此为准）\n\n${blocks.join(
    '\n\n',
  )}${multi}`;
}
