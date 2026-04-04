import { type NextRequest, NextResponse } from 'next/server';
import {
  BOT_PLATFORM_VALUES,
  type BotPlatform,
} from '@/modules/im-bot/constants';
import { handleBotWebhook } from '@/modules/im-bot/services/bot-engine';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;

  if (!BOT_PLATFORM_VALUES.includes(platform as BotPlatform)) {
    return NextResponse.json(
      { error: 'unsupported platform' },
      { status: 400 },
    );
  }

  return handleBotWebhook(platform as BotPlatform, req);
}
