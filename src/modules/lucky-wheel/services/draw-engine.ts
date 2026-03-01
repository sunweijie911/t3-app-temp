import { and, eq, gte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  wheelActivities,
  wheelDrawRecords,
  wheelPrizes,
} from '@/modules/lucky-wheel/schema';
import type { db as dbType } from '@/server/db';

type Db = typeof dbType;

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
 * 2. Check user draw limits (per-user total & per-day)
 * 3. Weighted random pick among active prizes with remaining stock
 * 4. Atomic stock deduction (UPDATE ... WHERE remaining_stock > 0)
 * 5. Write draw record
 */
export async function executeDraw(
  db: Db,
  activityId: string,
  userId: string,
): Promise<DrawResult> {
  // 1. Validate activity
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

  // 2. Check draw limits
  if (activity.maxDrawsPerUser > 0) {
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wheelDrawRecords)
      .where(
        and(
          eq(wheelDrawRecords.activityId, activityId),
          eq(wheelDrawRecords.userId, userId),
        ),
      );
    if ((totalResult?.count ?? 0) >= activity.maxDrawsPerUser) {
      throw new Error('已达到最大抽奖次数');
    }
  }

  if (activity.maxDrawsPerDay > 0) {
    const todayStart = new Date(
      new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) +
        'T00:00:00+08:00',
    );

    const [dailyResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(wheelDrawRecords)
      .where(
        and(
          eq(wheelDrawRecords.activityId, activityId),
          eq(wheelDrawRecords.userId, userId),
          gte(wheelDrawRecords.createdAt, todayStart),
        ),
      );
    if ((dailyResult?.count ?? 0) >= activity.maxDrawsPerDay) {
      throw new Error('今日抽奖次数已用完');
    }
  }

  // 3. Fetch active prizes
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

  // 4. Weighted random pick
  const totalWeight = prizes.reduce((sum, p) => sum + p.probability, 0);
  if (totalWeight <= 0) {
    throw new Error('奖品概率配置异常');
  }

  let random = Math.floor(Math.random() * totalWeight);
  // biome-ignore lint/style/noNonNullAssertion: prizes.length > 0 guaranteed above
  let selectedPrize = prizes[prizes.length - 1]!;
  for (const prize of prizes) {
    random -= prize.probability;
    if (random < 0) {
      selectedPrize = prize;
      break;
    }
  }

  // "thanks" type = no real win, or prize with 0 stock means miss
  const isThanksType = selectedPrize.type === 'thanks';
  let isWin = !isThanksType;
  let finalPrizeId: string | null = null;

  // 5 & 6. Stock deduction + record write in a transaction to prevent stock leaks
  const recordId = nanoid();
  await db.transaction(async (tx) => {
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
        // Stock exhausted — treat as "thanks" (miss)
        isWin = false;
      } else {
        finalPrizeId = selectedPrize.id;
      }
    }

    await tx.insert(wheelDrawRecords).values({
      id: recordId,
      userId,
      activityId,
      prizeId: finalPrizeId,
      isWin,
      status: isWin ? 'pending' : 'confirmed',
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
