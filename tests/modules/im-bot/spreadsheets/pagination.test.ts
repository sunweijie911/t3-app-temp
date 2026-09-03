import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/auth/dingtalk-token', () => ({
  dingtalkTokenManager: { getToken: vi.fn(async () => 'dt-token') },
}));
vi.mock('@/modules/im-bot/auth/wecom-token', () => ({
  wecomTokenManager: { getToken: vi.fn(async () => 'wx-token') },
}));

import type { SpreadsheetTableConfig } from '@/modules/im-bot/core/types';
import { DingtalkSheetAdapter } from '@/modules/im-bot/spreadsheets/dingtalk-sheet';
import { WecomSheetAdapter } from '@/modules/im-bot/spreadsheets/wecom-sheet';

const dingtalkConfig: SpreadsheetTableConfig = {
  platform: 'dingtalk',
  workspaceId: 'base1',
  tableId: 'sheet1',
  fieldMapping: { 名称: '名称' },
};

const wecomConfig: SpreadsheetTableConfig = {
  platform: 'wecom',
  workspaceId: 'doc1',
  tableId: 'sheet1',
  fieldMapping: { 名称: '名称' },
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('DingtalkSheetAdapter.queryRecords — 翻页', () => {
  const adapter = new DingtalkSheetAdapter();

  it('响应带 nextToken 时续拉下一页', async () => {
    // 回归：以前只发一个请求，超过单页的记录被静默丢掉，
    // 再叠加内存过滤 —— 大表上表现为"查不到"而不是报错
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonResponse({
          records: [{ id: 'r1', fields: { 名称: 'A' } }],
          nextToken: 'tok2',
        }),
      )
      .mockImplementationOnce(async () =>
        jsonResponse({ records: [{ id: 'r2', fields: { 名称: 'B' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await adapter.queryRecords(dingtalkConfig, {});

    expect(out.map((r) => r.recordId)).toEqual(['r1', 'r2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('nextToken=tok2');
  });

  it('没有游标字段时只发一个请求（与改动前行为一致，不回归）', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ records: [{ id: 'r1', fields: { 名称: 'A' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await adapter.queryRecords(dingtalkConfig, {});

    expect(out).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('游标不被支持、第二页原样回第一页时按 id 去重并停止', async () => {
    const page = {
      records: [{ id: 'r1', fields: { 名称: 'A' } }],
      nextToken: 'same',
    };
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse(page));
    vi.stubGlobal('fetch', fetchMock);

    const out = await adapter.queryRecords(dingtalkConfig, {});

    expect(out).toHaveLength(1); // 没有被重复计进结果
    expect(fetchMock).toHaveBeenCalledTimes(2); // 第二页发现无新记录即止
  });
});

describe('WecomSheetAdapter.queryRecords — 翻页', () => {
  const adapter = new WecomSheetAdapter();

  it('第一页请求体不带 offset（与改动前逐字节一致）', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse({
        errcode: 0,
        records: [{ record_id: 'r1', values: {} }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await adapter.queryRecords(wecomConfig, {});

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;
    expect(body).not.toHaveProperty('offset');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offset 不被支持、第二页原样回第一页时不会重复计数', async () => {
    // 构造满页触发续拉：PAGE_SIZE 条相同记录
    const full = Array.from({ length: 1000 }, (_, i) => ({
      record_id: `r${i}`,
      values: {},
    }));
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ errcode: 0, records: full }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await adapter.queryRecords(wecomConfig, {});

    expect(out).toHaveLength(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('queryHardLimit — 各平台自己声明上限', () => {
  it('三个 adapter 都声明了非零上限', () => {
    expect(new DingtalkSheetAdapter().queryHardLimit).toBeGreaterThan(0);
    expect(new WecomSheetAdapter().queryHardLimit).toBeGreaterThan(0);
  });
});
