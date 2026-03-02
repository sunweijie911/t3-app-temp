import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  type WheelUserInfo,
  wheelActivities,
  wheelDrawRecords,
  wheelExtraChances,
  wheelPrizes,
} from '@/modules/lucky-wheel/schema';
import type { db as dbType } from '@/server/db';
import { user } from '@/server/db/auth-schema';

type Db = typeof dbType;

/**
 * 解析用户在某活动中的总允许抽奖次数。
 * totalAllowed = activity.maxDrawsPerUser + extraChances（按手机号配置）
 * totalAllowed = 0 表示不限次数。
 */
export async function resolveDrawLimit(
  db: Db,
  activityId: string,
  userId: string,
  maxDrawsPerUser: number,
): Promise<number> {
  const userRecord = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { phoneNumber: true },
  });
  const phone = userRecord?.phoneNumber ?? null;

  const extraChancesRow = phone
    ? await db.query.wheelExtraChances.findFirst({
        where: and(
          eq(wheelExtraChances.activityId, activityId),
          eq(wheelExtraChances.phone, phone),
        ),
      })
    : null;

  return maxDrawsPerUser + (extraChancesRow?.extraChances ?? 0);
}

interface DrawResult {
  recordId: string;
  isWin: boolean;
  prize: {
    id: string;
    name: string;
    image: string | null;
    type: string;
    value: Record<string, unknown> | null;
  } | null;
}

/**
 * Execute a single draw for a user on a given activity.
 *
 * Flow:
 * 1. Validate activity is active and within date range
 * 2. Resolve extra chances for the user's phone number
 * 3. Fetch active prizes and validate probability config
 * 4. Transaction (user row FOR UPDATE to prevent concurrent over-draw):
 *    a. Count check against totalAllowed
 *    b. Weighted random pick
 *    c. Atomic stock deduction (UPDATE ... WHERE remaining_stock > 0)
 *    d. Write draw record with userInfo snapshot in one INSERT
 */
export async function executeDraw(
  db: Db,
  activityId: string,
  userId: string,
  userInfo: WheelUserInfo,
): Promise<DrawResult> {
  // 1. 验证活动
  const activity = await db.query.wheelActivities.findFirst({
    where: and(
      eq(wheelActivities.id, activityId),
      eq(wheelActivities.isActive, true),
    ),
  });

  if (!activity) {
    throw new Error('活动不存在或已下线');
  }

  const now = new Date();
  if (activity.startAt && now < activity.startAt) {
    throw new Error('活动尚未开始');
  }
  if (activity.endAt && now > activity.endAt) {
    throw new Error('活动已结束');
  }

  // 2. 解析总允许次数（事务外 — 只读）
  // 【已知限制】extra chances 以手机号为 key 存储，若用户修改了手机号，旧号码的额外次数将不再生效。
  const totalAllowed = await resolveDrawLimit(
    db,
    activityId,
    userId,
    activity.maxDrawsPerUser,
  );

  // 3. 获取在线奖品（事务外 — 奖品列表在单次抽奖中稳定）
  const prizes = await db
    .select()
    .from(wheelPrizes)
    .where(
      and(
        eq(wheelPrizes.activityId, activityId),
        eq(wheelPrizes.isActive, true),
      ),
    );

  if (prizes.length === 0) {
    throw new Error('活动暂无可用奖品');
  }

  const totalWeight = prizes.reduce((sum, p) => sum + p.probability, 0);
  if (totalWeight <= 0) {
    throw new Error('奖品概率配置异常');
  }

  // 4. 事务：行锁 → 次数检查 → 库存扣减 → 一次性写入记录（含 userInfo 快照）
  const recordId = nanoid();
  let isWin = false;
  let finalPrizeId: string | null = null;
  // biome-ignore lint/style/noNonNullAssertion: prizes.length > 0 guaranteed above
  let selectedPrize = prizes[prizes.length - 1]!;

  await db.transaction(async (tx) => {
    // 锁定用户行，串行化同一用户的并发抽奖请求，防止次数检查竞态
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for('update');

    // 次数检查（totalAllowed = 0 表示不限次数）
    if (totalAllowed > 0) {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(wheelDrawRecords)
        .where(
          and(
            eq(wheelDrawRecords.activityId, activityId),
            eq(wheelDrawRecords.userId, userId),
          ),
        );
      if ((row?.count ?? 0) >= totalAllowed) {
        throw new Error('已达到最大抽奖次数');
      }
    }

    // 加权随机抽取
    let random = Math.floor(Math.random() * totalWeight);
    for (const prize of prizes) {
      random -= prize.probability;
      if (random < 0) {
        selectedPrize = prize;
        break;
      }
    }

    const isThanksType = selectedPrize.type === 'thanks';
    isWin = !isThanksType;

    // 原子库存扣减
    if (isWin) {
      const updated = await tx
        .update(wheelPrizes)
        .set({
          remainingStock: sql`${wheelPrizes.remainingStock} - 1`,
        })
        .where(
          and(
            eq(wheelPrizes.id, selectedPrize.id),
            sql`${wheelPrizes.remainingStock} > 0`,
          ),
        )
        .returning({ id: wheelPrizes.id });

      if (updated.length === 0) {
        // 库存耗尽 — 降级为未中奖
        isWin = false;
      } else {
        finalPrizeId = selectedPrize.id;
      }
    }

    // 一次性写入记录，含 userInfo 快照，避免二次 UPDATE
    await tx.insert(wheelDrawRecords).values({
      id: recordId,
      userId,
      activityId,
      prizeId: finalPrizeId,
      isWin,
      status: isWin ? 'pending' : 'confirmed',
      userInfo,
    });
  });

  return {
    recordId,
    isWin,
    prize: isWin
      ? {
          id: selectedPrize.id,
          name: selectedPrize.name,
          image: selectedPrize.image,
          type: selectedPrize.type,
          value: selectedPrize.value,
        }
      : null,
  };
}
