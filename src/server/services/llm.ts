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
let cachedClient: OpenAI | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * 获取 LLM 配置和客户端实例。
 * 配置从 DB 读取并缓存 1 分钟，TTL 过期后自动刷新。
 */
async function getClientWithConfig(): Promise<{
  client: OpenAI;
  config: LLMConfig;
}> {
  const now = Date.now();
  if (cachedConfig && cachedClient && now - cacheTimestamp < CACHE_TTL_MS) {
    return { client: cachedClient, config: cachedConfig };
  }

  const [baseURL, apiKey, model, temperature, maxTokens] = await Promise.all([
    getConfigValue('llm.base_url'),
    getConfigValue('llm.api_key'),
    getConfigValue('llm.model'),
    getConfigValue('llm.temperature'),
    getConfigValue('llm.max_tokens'),
  ]);

  const config: LLMConfig = {
    baseURL: baseURL ?? 'https://api.deepseek.com/v1',
    // DB config takes priority; env var is the fallback
    apiKey: apiKey ?? env.LLM_API_KEY ?? '',
    model: model ?? 'deepseek-chat',
    temperature: temperature ? parseFloat(temperature) : 0.7,
    maxTokens: maxTokens ? parseInt(maxTokens, 10) : 2048,
  };

  const client = new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });

  cachedConfig = config;
  cachedClient = client;
  cacheTimestamp = now;

  return { client, config };
}

/**
 * 仅获取 LLM 配置（不含客户端），供外部读取 model 等字段。
 */
export async function getLLMConfig(): Promise<LLMConfig> {
  const { config } = await getClientWithConfig();
  return config;
}

type CompletionOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export async function streamCompletion(
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: CompletionOptions,
) {
  const { client, config } = await getClientWithConfig();
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
  options?: CompletionOptions,
): Promise<OpenAI.ChatCompletion> {
  const { client, config } = await getClientWithConfig();
  return client.chat.completions.create({
    model: options?.model ?? config.model,
    messages,
    temperature: options?.temperature ?? config.temperature,
    max_tokens: options?.maxTokens ?? config.maxTokens,
    stream: false,
  });
}
