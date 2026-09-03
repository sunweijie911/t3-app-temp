import type { BotPlatform } from '../constants';
import type { SpreadsheetRecord, SpreadsheetTableConfig } from '../core/types';

/** 带截断信息的查询结果 */
export interface SpreadsheetQueryResult {
  records: SpreadsheetRecord[];
  /**
   * 拉取阶段撞上翻页上限，平台侧还有没取到的数据。
   *
   * 必须由 adapter 自己上报：钉钉/企微没有服务端 filter，截断发生在
   * **内存过滤之前**，用返回条数与 queryHardLimit 比较永远为 false
   * —— 拉满 5000 行、过滤后剩 1 条时，用户会拿到一个静默不完整的答案。
   */
  truncated: boolean;
}

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
  /**
   * 同 queryRecords，但额外上报拉取是否被翻页上限截断。
   * 三个内置 adapter 都实现了它，queryRecords 只是它的一层剥壳；
   * 声明为可选是为了不强制外部/测试替身实现 —— 调用方缺省时
   * 退化为「返回条数 >= queryHardLimit」的旧判据。
   */
  queryRecordsWithMeta?(
    config: SpreadsheetTableConfig,
    filters: Record<string, unknown>,
  ): Promise<SpreadsheetQueryResult>;
  deleteRecord(config: SpreadsheetTableConfig, recordId: string): Promise<void>;
}
