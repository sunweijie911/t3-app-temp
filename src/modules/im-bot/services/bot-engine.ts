// cspell:ignore cooldown
import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/server/db';
import { dingtalkTokenManager } from '../auth/dingtalk-token';
import { resetFeishuChatNameCache } from '../auth/feishu-chat';
import { feishuTokenManager } from '../auth/feishu-token';
import { wecomTokenManager } from '../auth/wecom-token';
import { DingtalkChannelAdapter } from '../channels/dingtalk';
import { FeishuChannelAdapter } from '../channels/feishu';
import type { ChannelAdapter } from '../channels/types';
import { WecomChannelAdapter } from '../channels/wecom';
import type { BotPlatform } from '../constants';
import { Dispatcher } from '../core/dispatcher';
import type {
  BotEvent,
  FieldMappingValue,
  ResourceBinding,
} from '../core/types';
import { DatabaseDrivenScene, parseKeywords } from '../scenes/db-scene';
import { botEventLogs, botResourceBindings, botScenes } from '../schema';
import { resetCredentialsCache } from './credentials';
import { DbDedupStore, DbPendingActionStore } from './db-stores';

// 幂等/待确认状态走 DB，多实例部署下才能共享
const dedupStore = new DbDedupStore();
const pendingStore = new DbPendingActionStore();

const channelAdapters: Record<BotPlatform, ChannelAdapter> = {
  feishu: new FeishuChannelAdapter(),
  dingtalk: new DingtalkChannelAdapter(),
  wecom: new WecomChannelAdapter(),
};

let dispatcher: Dispatcher | null = null;
let dispatcherExpiresAt = 0;
let initPromise: Promise<Dispatcher> | null = null;
/**
 * 配置缓存 TTL。reloadBotConfig() 只能清掉**当前实例**的缓存，
 * 多实例部署时其它实例收不到广播；靠 TTL 让它们最终收敛。
 * （与 credentials 的 10 分钟 TTL 同理，但场景/绑定改动更频繁，取 60s。）
 */
const CONFIG_TTL_MS = 60 * 1000;
// init 失败短期熔断：DB 抖动时若每条 webhook 都重新发起一次全量加载，
// 会被飞书重试机制放大成 N 倍 DB 压力。失败后 30s 内直接抛缓存错误。
const INIT_FAILURE_COOLDOWN_MS = 30_000;
let lastInitError: { error: unknown; expiresAt: number } | null = null;

/**
 * 按 sceneId 分组加载资源绑定。
 * key 只用 sceneId（不再拼 platform）—— 数据在哪个平台由 binding.provider 决定。
 */
async function loadResourceBindings(): Promise<Map<string, ResourceBinding[]>> {
  const rows = await db
    .select()
    .from(botResourceBindings)
    .where(eq(botResourceBindings.isActive, true));

  const map = new Map<string, ResourceBinding[]>();
  for (const r of rows) {
    const binding: ResourceBinding = {
      alias: r.alias,
      kind: r.kind,
      provider: r.provider,
      workspaceId: r.workspaceId,
      resourceId: r.resourceId,
      fieldMapping: (r.fieldMapping as Record<string, FieldMappingValue>) ?? {},
      uniqueKey: r.uniqueKey ?? undefined,
      isDefault: r.isDefault,
    };
    const list = map.get(r.sceneId);
    if (list) list.push(binding);
    else map.set(r.sceneId, [binding]);
  }
  return map;
}

/**
 * 解析场景的目标资源：给了 alias 就精确取，否则取 isDefault，
 * 都没有则退回第一条 —— 避免只配了一条却忘了勾"默认"时整个场景不可用。
 */
function resolveBinding(
  bindings: Map<string, ResourceBinding[]>,
  sceneId: string,
  alias?: string,
): ResourceBinding | null {
  const list = bindings.get(sceneId);
  if (!list || list.length === 0) return null;
  if (alias) return list.find((b) => b.alias === alias) ?? null;
  return list.find((b) => b.isDefault) ?? list[0] ?? null;
}

/**
 * 写审计日志。返回 Promise 并由 dispatcher await —— 不 await 的话，
 * 这条插入会挂在 after() 回调之外，serverless 响应返回即冻结，日志随机丢失。
 */
async function logBotEvent(event: BotEvent) {
  await db
    .insert(botEventLogs)
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
  if (dispatcher && Date.now() < dispatcherExpiresAt) return dispatcher;
  if (initPromise) return initPromise;
  if (lastInitError && Date.now() < lastInitError.expiresAt) {
    throw lastInitError.error;
  }

  initPromise = (async () => {
    const [bindings, scenes] = await Promise.all([
      loadResourceBindings(),
      db.select().from(botScenes).where(eq(botScenes.isActive, true)),
    ]);

    const d = new Dispatcher({
      getBinding: (sceneId, alias) => resolveBinding(bindings, sceneId, alias),
      onEvent: logBotEvent,
      dedupStore,
      pendingStore,
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
    dispatcherExpiresAt = Date.now() + CONFIG_TTL_MS;
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

/**
 * 立即失效本实例的**场景/绑定**配置缓存。其它实例靠 CONFIG_TTL_MS 收敛
 * —— 真正的跨实例即时生效需要 pub/sub，目前用 TTL 兜底。
 *
 * 不再顺手 reset 三个平台的 token manager：改个场景名和平台凭证没有关系，
 * 却会把三个平台还没到期的 access_token 全丢掉，下一条消息重新换取。
 * 凭证真的变了走 reloadPlatformCredentials()。
 */
export function reloadBotConfig() {
  dispatcher = null;
  dispatcherExpiresAt = 0;
  lastInitError = null;
}

/**
 * 平台凭证变更后失效凭证缓存与已缓存的 access_token。
 * 只 reset 指定平台；不传则全部（比如不确定改了哪个）。
 */
export function reloadPlatformCredentials(platform?: BotPlatform) {
  resetCredentialsCache();
  if (!platform || platform === 'feishu') {
    feishuTokenManager.reset();
    // 群名缓存是用飞书 token 拉的，凭证换了要一并作废
    resetFeishuChatNameCache();
  }
  if (!platform || platform === 'wecom') wecomTokenManager.reset();
  if (!platform || platform === 'dingtalk') dingtalkTokenManager.reset();
}

/**
 * 平台 URL 有效性验证（GET）。企微需要；不支持的平台返回 405。
 * 以前 route 只导出 POST，企微连这一步都过不去。
 */
export async function handleBotUrlVerification(
  platform: BotPlatform,
  req: Request,
): Promise<Response> {
  const adapter = channelAdapters[platform];
  if (!adapter.verifyUrl) {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const res = await adapter.verifyUrl(req);
  return res ?? new Response('Method Not Allowed', { status: 405 });
}

export async function handleBotWebhook(
  platform: BotPlatform,
  req: Request,
): Promise<Response> {
  const adapter = channelAdapters[platform];

  // 解码/验签/解密全部交给 adapter：企微是 XML+AES，这里不能预设 JSON
  const decoded = await adapter.decode(req);

  if (decoded.kind === 'respond') return decoded.response;
  if (decoded.kind === 'reject') {
    console.warn(
      '[BotEngine] 拒绝回调, platform:',
      platform,
      'status:',
      decoded.status,
      'reason:',
      decoded.reason,
    );
    return new Response('Forbidden', { status: decoded.status });
  }
  if (decoded.kind === 'ignored') return Response.json({ ok: true });

  const msg = decoded.message;
  const disp = await getDispatcher();

  // 平台 3s 内不回 200 就重试，所以必须先返回再处理。
  // 用 after() 而不是裸 fire-and-forget：后者在 serverless 上响应返回即冻结，
  // 用户永远收不到回复、审计日志也不会落库。
  const run = () =>
    disp.process(msg, adapter).catch((err) => {
      console.error('[BotEngine] 异步处理异常:', err);
    });

  try {
    after(run);
  } catch (err) {
    // after() 只能在请求上下文里调用；非 Next 请求上下文（如测试）下降级为直接执行
    console.warn('[BotEngine] after() 不可用，降级为即时处理:', err);
    void run();
  }

  return Response.json({ ok: true });
}
