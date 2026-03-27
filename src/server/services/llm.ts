import 'server-only';
import OpenAI from 'openai';
import { env } from '@/env';
import { getConfigValue } from './config';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';

/** 内置默认白名单，可通过 LLM_ALLOWED_HOSTS 环境变量扩展或覆盖 */
const DEFAULT_ALLOWED_HOSTS = [
  'api.deepseek.com',
  'api.openai.com',
  'dashscope.aliyuncs.com',
  'api.anthropic.com',
];

function getAllowedHosts(): Set<string> {
  const envHosts = env.LLM_ALLOWED_HOSTS;
  if (envHosts) {
    return new Set(
      envHosts
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    );
  }
  return new Set(DEFAULT_ALLOWED_HOSTS);
}

/** 校验 baseURL 仅允许 HTTPS + 白名单域名，防止 SSRF */
function validateBaseURL(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      console.warn(`[LLM] baseURL 协议不安全: ${url}，回退到默认值`);
      return DEFAULT_BASE_URL;
    }
    if (!getAllowedHosts().has(parsed.hostname)) {
      console.warn(
        `[LLM] baseURL 域名不在白名单: ${parsed.hostname}，回退到默认值`,
      );
      return DEFAULT_BASE_URL;
    }
    return url;
  } catch {
    console.warn(`[LLM] baseURL 格式无效: ${url}，回退到默认值`);
    return DEFAULT_BASE_URL;
  }
}

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
    baseURL: validateBaseURL(baseURL ?? DEFAULT_BASE_URL),
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
