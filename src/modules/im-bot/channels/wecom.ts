import type { UnifiedMessage } from '../core/types';
import type { ChannelAdapter, VerifyResult } from './types';

// TODO: 企微 Channel Adapter — Phase 3 实现
export class WecomChannelAdapter implements ChannelAdapter {
  readonly platform = 'wecom' as const;

  async verify(): Promise<VerifyResult> {
    return { ok: false, status: 501 };
  }

  async parse(): Promise<UnifiedMessage | null> {
    return null;
  }

  async reply(): Promise<void> {
    throw new Error('企微适配器尚未实现');
  }
}
