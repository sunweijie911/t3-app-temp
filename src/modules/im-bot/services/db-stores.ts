import { eq, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { BotPlatform } from '../constants';
import {
  DEDUP_TTL_MS,
  PENDING_ACTION_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
} from '../constants';
import {
  type DedupStore,
  type PendingActionStore,
  type PendingKeyParts,
  type RateLimitStore,
  serializeDedupKey,
  serializePendingKey,
  serializeRateLimitKey,
} from '../core/stores';
import type {
  PendingAction,
  SpreadsheetRecord,
  UnifiedMessage,
} from '../core/types';
import { botEventDedup, botPendingActions, botRateLimits } from '../schema';

/** 过期行清理的最小间隔：避免每条消息都扫一次表 */
const GC_INTERVAL_MS = 5 * 60 * 1000;
let lastGcAt = 0;

/**
 * 顺带清理过期行。故意不阻塞主流程（不 await），失败只记日志 ——
 * 过期行留着也不影响正确性（读取时都会比对 expiresAt），只是占空间。
 */
function maybeGc() {
  if (Date.now() - lastGcAt < GC_INTERVAL_MS) return;
  lastGcAt = Date.now();
  const now = new Date();
  void db
    .delete(botEventDedup)
    .where(lt(botEventDedup.expiresAt, now))
    .execute()
    .catch((err) => console.error('[DbStores] 清理过期幂等记录失败:', err));
  void db
    .delete(botPendingActions)
    .where(lt(botPendingActions.expiresAt, now))
    .execute()
    .catch((err) => console.error('[DbStores] 清理过期待确认记录失败:', err));
  void db
    .delete(botRateLimits)
    .where(lt(botRateLimits.expiresAt, now))
    .execute()
    .catch((err) => console.error('[DbStores] 清理过期限流计数失败:', err));
}

/**
 * DB 限流存储 —— 多实例安全。
 *
 * 计数是一条语句：窗口起点在主键里，所以「同窗口再来一次」必然撞主键，
 * `DO UPDATE SET count = count + 1 RETURNING count` 直接拿到累计值。
 * 没有读改写，也就没有并发窗口。
 */
/**
 * 限流不可用的原因。
 *
 * fail-open 对**临时 DB 抖动**是对的，但对**表根本不存在**这种永久性
 * 配置缺失就错了：实测一轮 21 条刷屏消息全部放行、各花一次 LLM 调用，
 * 而运维面上什么都看不到 —— 你以为限流在保护你，其实一次都没生效。
 * 所以把状态记下来，由 getSharedStateStats 暴露到后台。
 */
let rateLimitOutage: {
  reason: string;
  permanent: boolean;
  since: Date;
} | null = null;
/** 同一个原因最多每分钟打一条日志，避免刷屏时把日志刷爆 */
let lastOutageLogAt = 0;
const OUTAGE_LOG_INTERVAL_MS = 60 * 1000;

/** 限流当前是否可用（null = 正常）。供后台观测 */
export function getRateLimitOutage() {
  return rateLimitOutage;
}

/** Postgres 42P01 = undefined_table，说明迁移没跑，不是临时故障 */
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === '42P01';
}

export class DbRateLimitStore implements RateLimitStore {
  async hit(
    key: PendingKeyParts,
    windowMs: number = RATE_LIMIT_WINDOW_MS,
  ): Promise<number> {
    const now = Date.now();
    const k = serializeRateLimitKey(key, windowMs, now);
    try {
      const [row] = await db
        .insert(botRateLimits)
        .values({
          limitKey: k,
          count: 1,
          expiresAt: new Date(now + windowMs),
        })
        .onConflictDoUpdate({
          target: botRateLimits.limitKey,
          set: { count: sql`${botRateLimits.count} + 1` },
        })
        .returning({ count: botRateLimits.count });
      rateLimitOutage = null;
      return row?.count ?? 1;
    } catch (err) {
      // 仍然 fail-open：限流是成本闸门，不是安全边界；因为计数表挂了
      // 就让所有人用不了机器人显然更糟。但要让"没生效"这件事可见。
      const permanent = isMissingTable(err);
      const reason = permanent
        ? '限流表不存在，迁移未执行（pnpm db:migrate）'
        : err instanceof Error
          ? err.message
          : String(err);
      if (!rateLimitOutage || rateLimitOutage.permanent !== permanent) {
        rateLimitOutage = { reason, permanent, since: new Date() };
      }
      if (now - lastOutageLogAt > OUTAGE_LOG_INTERVAL_MS) {
        lastOutageLogAt = now;
        console.error(
          permanent
            ? `[DbRateLimitStore] ⚠️ 限流未生效（${reason}）—— 所有消息都会被放行，每条都消耗 LLM 调用`
            : `[DbRateLimitStore] 计数失败，放行本次处理: ${reason}`,
        );
      }
      return 1;
    }
  }
}

/**
 * DB 幂等存储 —— 多实例安全。
 *
 * 靠 `INSERT ... ON CONFLICT DO NOTHING` 的原子性判断谁抢到处理权：
 * 有 returning 行 = 插入成功 = 本次抢到；无 returning 行 = 键已存在 = 已处理过。
 * 这比原来「先查再写」少了一个竞态窗口。
 */
export class DbDedupStore implements DedupStore {
  async claim(
    platform: BotPlatform,
    eventId: string,
    ttlMs: number = DEDUP_TTL_MS,
  ): Promise<boolean> {
    const key = serializeDedupKey(platform, eventId);
    const now = new Date();
    maybeGc();

    try {
      const inserted = await db
        .insert(botEventDedup)
        .values({ dedupKey: key, expiresAt: new Date(now.getTime() + ttlMs) })
        .onConflictDoUpdate({
          target: botEventDedup.dedupKey,
          // 只在旧记录已过期时才续期。DO UPDATE 的 WHERE 不成立时不会返回行，
          // 正好等价于「键仍有效 → 抢占失败」，一条语句同时表达了两种情形。
          set: { expiresAt: new Date(now.getTime() + ttlMs) },
          setWhere: lt(botEventDedup.expiresAt, now),
        })
        .returning({ dedupKey: botEventDedup.dedupKey });
      return inserted.length > 0;
    } catch (err) {
      // DB 故障时选择「放行」而不是「拦截」：拦截会让用户完全收不到回复，
      // 放行最坏是极端情况下重复处理一次，且平台重试本身并不频繁。
      console.error('[DbDedupStore] 幂等判定失败，放行本次处理:', err);
      return true;
    }
  }
}

interface StoredPendingRow {
  sceneId: string;
  bindingAlias: string;
  type: string;
  candidates: unknown;
  selectableCount: number | null;
  message: unknown;
  updateFields: unknown;
  expiresAt: Date;
}

const PENDING_TYPES: ReadonlySet<PendingAction['type']> = new Set([
  'confirm_delete',
  'select_record',
  'confirm_upsert',
  'confirm_update',
]);

function rowToPendingAction(row: StoredPendingRow): PendingAction | null {
  if (!PENDING_TYPES.has(row.type as PendingAction['type'])) {
    console.warn('[DbPendingActionStore] 未知的 pending 类型:', row.type);
    return null;
  }
  return {
    sceneId: row.sceneId,
    bindingAlias: row.bindingAlias,
    type: row.type as PendingAction['type'],
    candidates: (row.candidates as SpreadsheetRecord[]) ?? [],
    selectableCount: row.selectableCount ?? undefined,
    message: row.message as UnifiedMessage,
    updateFields:
      (row.updateFields as Record<string, unknown> | null) ?? undefined,
    expiresAt: row.expiresAt.getTime(),
  };
}

/**
 * DB 待确认交互存储 —— 多实例安全。
 *
 * candidates/message 存 jsonb。注意 message 里的 `raw`（平台原始事件体）
 * 会被一起序列化，这是有意的：钉钉/企微的 reply 需要它，而确认步骤
 * 可能落在另一个实例上，拿不到原请求。
 */
export class DbPendingActionStore implements PendingActionStore {
  async get(key: PendingKeyParts): Promise<PendingAction | null> {
    const k = serializePendingKey(key);
    try {
      const [row] = await db
        .select({
          sceneId: botPendingActions.sceneId,
          bindingAlias: botPendingActions.bindingAlias,
          type: botPendingActions.type,
          candidates: botPendingActions.candidates,
          selectableCount: botPendingActions.selectableCount,
          message: botPendingActions.message,
          updateFields: botPendingActions.updateFields,
          expiresAt: botPendingActions.expiresAt,
        })
        .from(botPendingActions)
        .where(eq(botPendingActions.pendingKey, k))
        .limit(1);
      if (!row) return null;
      if (row.expiresAt.getTime() < Date.now()) {
        // 过期即删，避免用户被卡在等待态
        await this.delete(key);
        return null;
      }
      return rowToPendingAction(row);
    } catch (err) {
      // 读失败时当作「无待确认」：最坏是用户要重发一次指令，
      // 比把后续所有消息都拦在等待态要好
      console.error('[DbPendingActionStore] 读取失败，视为无待确认:', err);
      return null;
    }
  }

  async set(
    key: PendingKeyParts,
    action: Omit<PendingAction, 'expiresAt'>,
    ttlMs = PENDING_ACTION_TTL_MS,
  ): Promise<void> {
    const k = serializePendingKey(key);
    const expiresAt = new Date(Date.now() + ttlMs);
    /**
     * 显式声明成「PendingAction 的每个字段都必须出现」。
     *
     * 这里曾经漏掉 selectableCount：类型上它是可选的，漏了不报错，
     * 于是内存存储（按引用存对象）一切正常、测试全绿，只有走 DB 的
     * 生产环境会静默丢掉它。加上这个类型标注后，往 PendingAction 里
     * 加字段而忘了在这里持久化，会直接编译不过。
     */
    const values = {
      sceneId: action.sceneId,
      bindingAlias: action.bindingAlias,
      type: action.type,
      candidates: action.candidates,
      selectableCount: action.selectableCount ?? null,
      message: action.message as unknown as Record<string, unknown>,
      updateFields: action.updateFields ?? null,
      expiresAt,
      // satisfies 而不是类型标注：只校验「键齐全」，不把值类型擦成 unknown
      // （擦掉的话 drizzle 的 insert 会拒绝整个对象）
    } satisfies Record<keyof Omit<PendingAction, 'expiresAt'>, unknown> & {
      expiresAt: Date;
    };
    await db
      .insert(botPendingActions)
      .values({ pendingKey: k, ...values })
      .onConflictDoUpdate({
        target: botPendingActions.pendingKey,
        set: values,
      });
  }

  async delete(key: PendingKeyParts): Promise<void> {
    await db
      .delete(botPendingActions)
      .where(eq(botPendingActions.pendingKey, serializePendingKey(key)));
  }
}

/** 待确认记录条数（供 admin 观测多实例状态是否正常流转） */
export async function countPendingActions(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(botPendingActions);
  return row?.count ?? 0;
}
