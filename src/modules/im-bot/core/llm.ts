import OpenAI from 'openai';
import { env } from '@/env';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: env.IM_BOT_LLM_BASE_URL,
      apiKey: env.IM_BOT_LLM_API_KEY ?? '',
    });
  }
  return client;
}

export async function chatCompletion(
  system: string,
  user: string,
): Promise<string> {
  try {
    const res = await getClient().chat.completions.create({
      model: env.IM_BOT_LLM_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.1,
    });
    const content = res.choices?.[0]?.message?.content ?? '';
    if (!content) {
      console.warn(
        '[LLM] 空响应, choices:',
        JSON.stringify(res.choices ?? null).slice(0, 200),
      );
    }
    return content;
  } catch (err) {
    console.error('[LLM] 调用失败:', err instanceof Error ? err.message : err);
    throw err;
  }
}

/**
 * 从 LLM 原始输出中提取第一个完整的 JSON 对象。
 * 使用括号平衡算法，正确处理嵌套 {}。
 */
export function extractJson(raw: string): string | null {
  // 优先从 markdown 代码块提取
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    const trimmed = codeBlock[1].trim();
    if (trimmed.startsWith('{')) return trimmed;
  }

  // 括号平衡提取第一个完整 JSON 对象
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null;
}
