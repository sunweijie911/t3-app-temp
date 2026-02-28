import { and, eq } from 'drizzle-orm';

import type { db as DB } from '@/server/db';
import { orders } from '@/server/db/schema';

export async function hasPaidOrder(
  db: typeof DB,
  userId: string,
  resultId: string,
): Promise<boolean> {
  const paidOrder = await db.query.orders.findFirst({
    where: and(
      eq(orders.resultId, resultId),
      eq(orders.userId, userId),
      eq(orders.status, 'paid'),
    ),
  });
  return !!paidOrder;
}
