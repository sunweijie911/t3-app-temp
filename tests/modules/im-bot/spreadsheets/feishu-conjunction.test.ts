import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/auth/feishu-token', () => ({
  feishuTokenManager: { getToken: vi.fn(async () => 'fs-token') },
}));

import type { SpreadsheetTableConfig } from '@/modules/im-bot/core/types';
import { FeishuBitableAdapter } from '@/modules/im-bot/spreadsheets/feishu-bitable';

const config: SpreadsheetTableConfig = {
  platform: 'feishu',
  workspaceId: 'app1',
  tableId: 't1',
  fieldMapping: {
    域: { name: '域', type: 'plain', displayType: 'text' },
    标签: { name: '标签', type: 'multiSelect' },
    日期: { name: '日期', type: 'plain', displayType: 'date' },
    名称: { name: '名称', type: 'plain', displayType: 'text' },
  },
};

/** 捕获发给飞书 search 接口的 filter */
function stubSearch(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: { body?: string }) => {
      bodies.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
      return new Response(
        JSON.stringify({ code: 0, data: { items: [], has_more: false } }),
        { status: 200 },
      );
    }),
  );
  return { bodies };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('FeishuBitableAdapter — 连接词按各组的硬性要求解析', () => {
  const adapter = new FeishuBitableAdapter();

  it('单字段多值：自动用 or，不再被默认 and 变成空集', async () => {
    const { bodies } = stubSearch();
    await adapter.queryRecordsWithMeta(config, { 域: ['门户', '督导'] });
    expect(bodies[0]?.filter).toEqual({
      conjunction: 'or',
      conditions: [
        { field_name: '域', operator: 'is', value: ['门户'] },
        { field_name: '域', operator: 'is', value: ['督导'] },
      ],
    });
  });

  it('单字段 multiSelect 多值：同样自动用 or', async () => {
    const { bodies } = stubSearch();
    await adapter.queryRecordsWithMeta(config, { 标签: ['门户', '督导'] });
    expect((bodies[0]?.filter as { conjunction: string }).conjunction).toBe(
      'or',
    );
  });

  it('单字段日期区间：仍然用 and', async () => {
    const { bodies } = stubSearch();
    await adapter.queryRecordsWithMeta(config, {
      日期: { op: 'between', value: ['2026-05-01', '2026-05-31'] },
    });
    expect((bodies[0]?.filter as { conjunction: string }).conjunction).toBe(
      'and',
    );
  });

  it('多值 + 另一个条件：无解，报一句能照着改的错而不是给空集', async () => {
    stubSearch();
    await expect(
      adapter.queryRecordsWithMeta(config, {
        域: ['门户', '督导'],
        名称: 'A',
      }),
    ).rejects.toThrow(/给了多个候选值.*无法与其它「且」条件混用/);
  });

  it('区间 + 显式 or：保留原有的区间冲突报错', async () => {
    stubSearch();
    await expect(
      adapter.queryRecordsWithMeta(config, {
        日期: { op: 'between', value: ['2026-05-01', '2026-05-31'] },
        名称: 'A',
        _conjunction: 'or',
      }),
    ).rejects.toThrow(/是一个区间.*无法与「或」条件混用/);
  });

  it('单值多条件仍按外层 conjunction 走', async () => {
    const { bodies } = stubSearch();
    await adapter.queryRecordsWithMeta(config, { 域: '门户', 名称: 'A' });
    expect(bodies[0]?.filter).toEqual({
      conjunction: 'and',
      conditions: [
        { field_name: '域', operator: 'is', value: ['门户'] },
        { field_name: '名称', operator: 'is', value: ['A'] },
      ],
    });
  });

  it('无有效条件时不下发 filter', async () => {
    const { bodies } = stubSearch();
    await adapter.queryRecordsWithMeta(config, {});
    expect(bodies[0]?.filter).toBeUndefined();
  });
});
