import { type NextRequest, NextResponse } from 'next/server';
import {
  BOT_PLATFORM_VALUES,
  type BotPlatform,
} from '@/modules/im-bot/constants';
import {
  handleBotUrlVerification,
  handleBotWebhook,
} from '@/modules/im-bot/services/bot-engine';

export const runtime = 'nodejs';

function resolvePlatform(platform: string): BotPlatform | null {
  return BOT_PLATFORM_VALUES.includes(platform as BotPlatform)
    ? (platform as BotPlatform)
    : null;
}

/**
 * URL 有效性验证。企微自建应用配置回调时会先发 GET 带 echostr，
 * 校验通过必须原样回写解密后的明文 —— 缺这个 handler 企微无法完成配置。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const resolved = resolvePlatform(platform);
  if (!resolved) {
    return NextResponse.json(
      { error: 'unsupported platform' },
      { status: 400 },
    );
  }
  return handleBotUrlVerification(resolved, req);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const resolved = resolvePlatform(platform);
  if (!resolved) {
    return NextResponse.json(
      { error: 'unsupported platform' },
      { status: 400 },
    );
  }
  return handleBotWebhook(resolved, req);
}
