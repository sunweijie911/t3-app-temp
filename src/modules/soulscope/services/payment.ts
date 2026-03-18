import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';

export async function simulatePayment(orderId: string): Promise<void> {
  const updated = await db
    .update(orders)
    .set({
      status: 'paid',
      paidAt: new Date(),
      paymentMethod: 'stub',
    })
    .where(and(eq(orders.id, orderId), eq(orders.status, 'pending')))
    .returning({ id: orders.id });

  if (updated.length === 0) {
    throw new Error(`订单 ${orderId} 不存在或状态非 pending，无法支付`);
  }
}
