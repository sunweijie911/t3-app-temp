import 'server-only';
import OpenAI from 'openai';
import { env } from '@/env';
import { getConfigValue } from './config';

interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

let cachedConfig: LLMConfig | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

export async function getLLMConfig(): Promise<LLMConfig> {
  const now = Date.now();
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const [baseURL, apiKey, model, temperature, maxTokens] = await Promise.all([
    getConfigValue('llm.base_url'),
    getConfigValue('llm.api_key'),
    getConfigValue('llm.model'),
    getConfigValue('llm.temperature'),
    getConfigValue('llm.max_tokens'),
  ]);

  cachedConfig = {
    baseURL: baseURL ?? 'https://api.deepseek.com/v1',
    apiKey: env.LLM_API_KEY ?? apiKey ?? '',
    model: model ?? 'deepseek-chat',
    temperature: temperature ? parseFloat(temperature) : 0.7,
    maxTokens: maxTokens ? parseInt(maxTokens, 10) : 2048,
  };
  cacheTimestamp = now;

  return cachedConfig;
}

export async function streamCompletion(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: { model?: string; temperature?: number; maxTokens?: number },
) {
  const config = await getLLMConfig();
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });

  return client.chat.completions.create({
    model: options?.model ?? config.model,
    messages,
    temperature: options?.temperature ?? config.temperature,
    max_tokens: options?.maxTokens ?? config.maxTokens,
    stream: true,
  });
}

export async function completion(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<OpenAI.ChatCompletion> {
  const config = await getLLMConfig();
  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });

  return client.chat.completions.create({
    model: options?.model ?? config.model,
    messages,
    temperature: options?.temperature ?? config.temperature,
    max_tokens: options?.maxTokens ?? config.maxTokens,
    stream: false,
  });
}
