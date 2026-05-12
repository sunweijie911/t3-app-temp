// cspell:ignore cooldown
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { feishuTokenManager } from '../auth/feishu-token';
import { DingtalkChannelAdapter } from '../channels/dingtalk';
import { FeishuChannelAdapter } from '../channels/feishu';
import type { ChannelAdapter } from '../channels/types';
import { WecomChannelAdapter } from '../channels/wecom';
import type { BotPlatform } from '../constants';
import { Dispatcher } from '../core/dispatcher';
import type {
  BotEvent,
  FieldMappingValue,
  SpreadsheetTableConfig,
} from '../core/types';
import { DatabaseDrivenScene, parseKeywords } from '../scenes/db-scene';
import { botEventLogs, botScenes, botTableMappings } from '../schema';
import { resetCredentialsCache } from './credentials';

const channelAdapters: Record<BotPlatform, ChannelAdapter> = {
  feishu: new FeishuChannelAdapter(),
  dingtalk: new DingtalkChannelAdapter(),
  wecom: new WecomChannelAdapter(),
};

let dispatcher: Dispatcher | null = null;
let initPromise: Promise<Dispatcher> | null = null;
// init 失败短期熔断：DB 抖动时若每条 webhook 都重新发起一次全量加载，
// 会被飞书重试机制放大成 N 倍 DB 压力。失败后 30s 内直接抛缓存错误。
const INIT_FAILURE_COOLDOWN_MS = 30_000;
let lastInitError: { error: unknown; expiresAt: number } | null = null;

async function loadTableMappings(): Promise<
  Map<string, SpreadsheetTableConfig>
> {
  const mappings = await db
    .select()
    .from(botTableMappings)
    .where(eq(botTableMappings.isActive, true));

  const map = new Map<string, SpreadsheetTableConfig>();
  for (const m of mappings) {
    const key = `${m.sceneId}:${m.platform}`;
    map.set(key, {
      platform: m.platform,
      workspaceId: m.workspaceId,
      tableId: m.tableId,
      fieldMapping: (m.fieldMapping as Record<string, FieldMappingValue>) ?? {},
      uniqueKey: m.uniqueKey ?? undefined,
    });
  }
  return map;
}

function logBotEvent(event: BotEvent) {
  db.insert(botEventLogs)
    .values({
      platform: event.platform,
      eventId: event.eventId,
      chatId: event.chatId,
      chatName: event.chatName,
      senderId: event.senderId,
      senderName: event.senderName,
      content: event.content,
      sceneId: event.sceneId,
      intent: event.intent,
      result: event.result,
      resultData: event.resultData as Record<string, unknown>,
      errorMsg: event.errorMsg,
      costMs: event.costMs,
    })
    .execute()
    .catch((err) => console.error('[BotEngine] 审计日志写入失败:', err));
}

async function getDispatcher(): Promise<Dispatcher> {
  if (dispatcher) return dispatcher;
  if (initPromise) return initPromise;
  if (lastInitError && Date.now() < lastInitError.expiresAt) {
    throw lastInitError.error;
  }

  initPromise = (async () => {
    const [tableMappings, scenes] = await Promise.all([
      loadTableMappings(),
      db.select().from(botScenes).where(eq(botScenes.isActive, true)),
    ]);

    const d = new Dispatcher({
      getTableConfig: (sceneId, platform) =>
        tableMappings.get(`${sceneId}:${platform}`) ?? null,
      onEvent: logBotEvent,
    });

    for (const s of scenes) {
      if (!s.systemPrompt) continue;
      d.registry.register(
        new DatabaseDrivenScene({
          sceneId: s.sceneId,
          name: s.name,
          description: s.description ?? '',
          keywords: parseKeywords(s.keywords),
          systemPrompt: s.systemPrompt,
          replyTemplate: s.replyTemplate ?? undefined,
        }),
      );
    }

    dispatcher = d;
    lastInitError = null;
    return d;
  })()
    .catch((err) => {
      lastInitError = {
        error: err,
        expiresAt: Date.now() + INIT_FAILURE_COOLDOWN_MS,
      };
      throw err;
    })
    .finally(() => {
      initPromise = null;
    });

  return initPromise;
}

export function reloadBotConfig() {
  dispatcher = null;
  lastInitError = null;
  resetCredentialsCache();
  feishuTokenManager.reset();
}

export async function handleBotWebhook(
  platform: BotPlatform,
  req: Request,
): Promise<Response> {
  const adapter = channelAdapters[platform];
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.warn('[BotEngine] 请求体解析失败，platform:', platform);
    return new Response('Bad Request', { status: 400 });
  }

  const verifyResult = await adapter.verify(req, body);
  if ('challenge' in verifyResult) {
    return Response.json({ challenge: verifyResult.challenge });
  }
  if (!verifyResult.ok) {
    return new Response('Forbidden', { status: verifyResult.status });
  }

  const msg = await adapter.parse(body);
  if (!msg) {
    return Response.json({ ok: true });
  }

  const disp = await getDispatcher();
  disp.process(msg, adapter).catch((err) => {
    console.error('[BotEngine] 异步处理异常:', err);
  });

  return Response.json({ ok: true });
}
