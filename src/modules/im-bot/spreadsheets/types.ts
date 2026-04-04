import type { BotPlatform } from '../constants';
import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';

export interface SpreadsheetAdapter {
  readonly platform: BotPlatform;
  createRecord(
    config: SpreadsheetTableConfig,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord>;
  updateRecord(
    config: SpreadsheetTableConfig,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<SpreadsheetRecord>;
  queryRecords(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetRecord[]>;
  deleteRecord(config: SpreadsheetTableConfig, recordId: string): Promise<void>;
}
