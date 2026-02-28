import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders } from '@/server/db/schema';

export async function simulatePayment(orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({
      status: 'paid',
      paidAt: new Date(),
      paymentMethod: 'stub',
    })
    .where(eq(orders.id, orderId));
}
