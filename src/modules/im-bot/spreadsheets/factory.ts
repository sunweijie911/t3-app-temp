import type { BotPlatform } from '../constants';
import { DingtalkSheetAdapter } from './dingtalk-sheet';
import { FeishuBitableAdapter } from './feishu-bitable';
import type { SpreadsheetAdapter } from './types';
import { WecomSheetAdapter } from './wecom-sheet';

const adapters: Record<BotPlatform, SpreadsheetAdapter> = {
  feishu: new FeishuBitableAdapter(),
  dingtalk: new DingtalkSheetAdapter(),
  wecom: new WecomSheetAdapter(),
};

export function getSpreadsheetAdapter(
  platform: BotPlatform,
): SpreadsheetAdapter {
  return adapters[platform];
}
