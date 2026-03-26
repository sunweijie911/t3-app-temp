import { eq } from 'drizzle-orm';
import { ImageResponse } from 'next/og';
import { MODULE_NAME } from '@/modules/soulscope/constants';
import { db } from '@/server/db';
import { testResults } from '@/server/db/schema';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shareToken: string }> },
) {
  const { shareToken } = await params;

  const result = await db.query.testResults.findFirst({
    where: eq(testResults.shareToken, shareToken),
    with: { testType: true },
  });

  if (!result) {
    return new Response('Not found', { status: 404 });
  }

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 100%)',
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 24, opacity: 0.8, marginBottom: 16 }}>
        {MODULE_NAME} - {result.testType?.name}
      </div>
      <div style={{ fontSize: 72, fontWeight: 'bold', marginBottom: 16 }}>
        {result.resultCode}
      </div>
      <div style={{ fontSize: 36, marginBottom: 24 }}>{result.resultLabel}</div>
      <div
        style={{
          fontSize: 18,
          opacity: 0.7,
          maxWidth: 600,
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        {result.summary.length > 100
          ? `${result.summary.slice(0, 100)}...`
          : result.summary}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}
