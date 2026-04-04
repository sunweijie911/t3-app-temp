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
  const res = await getClient().chat.completions.create({
    model: env.IM_BOT_LLM_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
  });
  return res.choices[0]?.message?.content ?? '';
}

/**
 * 从 LLM 原始输出中提取第一个 JSON 对象。
 * 处理 markdown 代码块包裹、多余文字等干扰。
 */
export function extractJson(raw: string): string | null {
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock?.[1]) {
    const trimmed = codeBlock[1].trim();
    if (trimmed.startsWith('{')) return trimmed;
  }
  const match = raw.match(/\{[\s\S]*?\}/);
  return match?.[0] ?? null;
}
