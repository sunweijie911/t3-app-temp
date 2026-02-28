import { and, eq } from 'drizzle-orm';
import { auth } from '@/server/better-auth';
import { db } from '@/server/db';
import { aiReports, orders, testResults } from '@/server/db/schema';
import { generateReport } from '@/server/services/report-generator';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

async function verifyAccess(request: Request, resultId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return { error: new Response('Unauthorized', { status: 401 }) };
  }

  const result = await db.query.testResults.findFirst({
    where: and(
      eq(testResults.id, resultId),
      eq(testResults.userId, session.user.id),
    ),
  });
  if (!result) {
    return { error: new Response('Not found', { status: 404 }) };
  }

  const order = await db.query.orders.findFirst({
    where: and(
      eq(orders.resultId, resultId),
      eq(orders.userId, session.user.id),
      eq(orders.status, 'paid'),
    ),
  });
  if (!order) {
    return { error: new Response('Payment required', { status: 402 }) };
  }

  return { session };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resultId: string }> },
) {
  const { resultId } = await params;
  const access = await verifyAccess(request, resultId);
  if ('error' in access) return access.error;

  // Read-only: return existing completed report or 404
  const existingReport = await db.query.aiReports.findFirst({
    where: eq(aiReports.resultId, resultId),
  });

  if (existingReport?.status === 'completed' && existingReport.content) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ content: existingReport.content })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  return new Response('Report not found', { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resultId: string }> },
) {
  const { resultId } = await params;
  const access = await verifyAccess(request, resultId);
  if ('error' in access) return access.error;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = generateReport(resultId, access.session.user.id);
        for await (const chunk of generator) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`),
          );
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: String(error) })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
