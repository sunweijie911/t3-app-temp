import { sql } from 'drizzle-orm';

import { db } from '@/server/db';

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json(
      { status: 'error', message: 'database unreachable' },
      { status: 503 },
    );
  }
}
