import { eq, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { BotPlatform } from '../constants';
import { DEDUP_TTL_MS, PENDING_ACTION_TTL_MS } from '../constants';
import {
  type DedupStore,
  type PendingActionStore,
  type PendingKeyParts,
  serializeDedupKey,
  serializePendingKey,
} from '../core/stores';
import type {
  PendingAction,
  SpreadsheetRecord,
  UnifiedMessage,
} from '../core/types';
import { botEventDedup, botPendingActions } from '../schema';

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
    const values = {
      sceneId: action.sceneId,
      bindingAlias: action.bindingAlias,
      type: action.type,
      candidates: action.candidates,
      message: action.message as unknown as Record<string, unknown>,
      updateFields: action.updateFields ?? null,
      expiresAt,
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
