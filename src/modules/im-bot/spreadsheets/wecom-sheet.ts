import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';
import type { SpreadsheetAdapter } from './types';

// TODO: 企微智能表格 Adapter — Phase 3 实现
export class WecomSheetAdapter implements SpreadsheetAdapter {
  readonly platform = 'wecom' as const;
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
