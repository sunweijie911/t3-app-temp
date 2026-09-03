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
