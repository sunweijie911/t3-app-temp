import type { UnifiedMessage } from '../core/types';
import type { ChannelAdapter, VerifyResult } from './types';

// TODO: 钉钉 Channel Adapter — Phase 3 实现
export class DingtalkChannelAdapter implements ChannelAdapter {
  readonly platform = 'dingtalk' as const;

  async verify(): Promise<VerifyResult> {
    return { ok: false, status: 501 };
  }

  parse(): UnifiedMessage | null {
    return null;
  }

  async reply(): Promise<void> {
    throw new Error('钉钉适配器尚未实现');
  }
}
