import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';
import type { SpreadsheetAdapter } from './types';

// TODO: 钉钉宜搭多维表 Adapter — Phase 3 实现
export class DingtalkSheetAdapter implements SpreadsheetAdapter {
  readonly platform = 'dingtalk' as const;
  async createRecord(
    _c: SpreadsheetTableConfig,
    _f: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    throw new Error('未实现');
  }
  async updateRecord(
    _c: SpreadsheetTableConfig,
    _id: string,
    _f: Record<string, unknown>,
  ): Promise<SpreadsheetRecord> {
    throw new Error('未实现');
  }
  async queryRecords(
    _c: SpreadsheetTableConfig,
    _f: Record<string, unknown>,
  ): Promise<SpreadsheetRecord[]> {
    throw new Error('未实现');
  }
  async deleteRecord(_c: SpreadsheetTableConfig, _id: string): Promise<void> {
    throw new Error('未实现');
  }
}
