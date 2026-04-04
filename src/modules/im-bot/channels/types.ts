import type { BotPlatform } from '../constants';
import type { UnifiedMessage } from '../core/types';

export type VerifyResult =
  | { ok: true }
  | { ok: false; status: number }
  | { challenge: string };

export interface ChannelAdapter {
  readonly platform: BotPlatform;
  verify(req: Request, body: unknown): Promise<VerifyResult>;
  parse(body: unknown): UnifiedMessage | null;
  reply(msg: UnifiedMessage, content: string): Promise<void>;
}
