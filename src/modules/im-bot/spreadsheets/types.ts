import type { BotPlatform } from '../constants';
import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';

export interface SpreadsheetAdapter {
  readonly platform: BotPlatform;
  /**
   * 单次 queryRecords 最多能返回多少条 —— 翻页上限乘以每页条数。
   * 命中这个数说明结果可能被截断了，回复里要提示用户缩窄条件。
   * 以前这个值在 db-scene 里硬编码成飞书的 1000，对另外两个平台是错的。
   */
  readonly queryHardLimit: number;
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
