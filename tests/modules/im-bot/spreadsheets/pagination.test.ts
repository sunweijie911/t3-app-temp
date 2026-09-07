import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/auth/dingtalk-token', () => ({
  dingtalkTokenManager: { getToken: vi.fn(async () => 'dt-token') },
}));
vi.mock('@/modules/im-bot/auth/wecom-token', () => ({
  wecomTokenManager: { getToken: vi.fn(async () => 'wx-token') },
}));

import type { SpreadsheetTableConfig } from '@/modules/im-bot/core/types';
import {
  __resetDingtalkDeleteWarning,
  DingtalkSheetAdapter,
  readDingtalkDeleteOutcome,
} from '@/modules/im-bot/spreadsheets/dingtalk-sheet';
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

describe('queryRecordsWithMeta — 截断由 adapter 上报（P0：过滤后条数判不出来）', () => {
  it('钉钉：页数用完且仍有 nextToken → truncated', async () => {
    // 每页都带新记录和新游标，5 页拉完平台还说有后续
    let page = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      page++;
      return jsonResponse({
        records: [{ id: `p${page}`, fields: { 名称: `A${page}` } }],
        nextToken: `tok${page + 1}`,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await new DingtalkSheetAdapter().queryRecordsWithMeta(
      dingtalkConfig,
      // 过滤只留一条：旧判据「返回条数 >= queryHardLimit」在这里恒为 false
      { 名称: 'A1' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(out.records).toHaveLength(1);
    expect(out.truncated).toBe(true);
  });

  it('钉钉：一页拉完 → 不算截断', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ records: [{ id: 'r1', fields: { 名称: 'A' } }] }),
      ),
    );

    const out = await new DingtalkSheetAdapter().queryRecordsWithMeta(
      dingtalkConfig,
      {},
    );

    expect(out.truncated).toBe(false);
  });

  it('企微：满页续拉到页数上限 → truncated', async () => {
    let seq = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      // 每页都是满页（1000 条），说明后面还有
      const records = Array.from({ length: 1000 }, (_, i) => ({
        record_id: `p${seq}-r${i}`,
        values: { 名称: [{ type: 'text', text: 'A' }] },
      }));
      seq++;
      return jsonResponse({ records });
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await new WecomSheetAdapter().queryRecordsWithMeta(
      wecomConfig,
      { 名称: '不存在的值' },
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(out.records).toHaveLength(0);
    expect(out.truncated).toBe(true);
  });

  it('queryRecords 与 queryRecordsWithMeta 返回同一批记录', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ records: [{ id: 'r1', fields: { 名称: 'A' } }] }),
      ),
    );
    const adapter = new DingtalkSheetAdapter();

    const plain = await adapter.queryRecords(dingtalkConfig, {});
    const meta = await adapter.queryRecordsWithMeta(dingtalkConfig, {});

    expect(plain).toEqual(meta.records);
  });
});

describe('readDingtalkDeleteOutcome — 删除响应判定', () => {
  it('非空 id 列表 = 删掉了', () => {
    expect(readDingtalkDeleteOutcome({ ids: ['r1'] })).toBe('deleted');
    expect(readDingtalkDeleteOutcome({ recordIds: ['r1'] })).toBe('deleted');
    expect(readDingtalkDeleteOutcome({ result: ['r1'] })).toBe('deleted');
  });

  it('★ 空列表 / 计数为 0 = 一条都没删', () => {
    expect(readDingtalkDeleteOutcome({ ids: [] })).toBe('none');
    expect(readDingtalkDeleteOutcome({ successCount: 0 })).toBe('none');
    expect(readDingtalkDeleteOutcome({ result: false })).toBe('none');
  });

  it('★ 布尔 false 是明确的否定信号，不能掉进 unknown 被当成功', () => {
    // 回归：`deleted` 曾只在"计数键"里按 number 判，`{"deleted": false}`
    // 既不是数组也过不了 typeof number，会一路落到 unknown 被放行 ——
    // 而它恰恰是最不该被放行的那种响应。
    expect(readDingtalkDeleteOutcome({ deleted: false })).toBe('none');
    expect(readDingtalkDeleteOutcome({ deleted: true })).toBe('deleted');
    expect(readDingtalkDeleteOutcome({ successCount: false })).toBe('none');
    expect(readDingtalkDeleteOutcome({ ids: false })).toBe('none');
  });

  it('计数 > 0 = 删掉了', () => {
    expect(readDingtalkDeleteOutcome({ deletedCount: 2 })).toBe('deleted');
    expect(readDingtalkDeleteOutcome({ result: true })).toBe('deleted');
  });

  it('认不出的形状 → unknown（不能升级成"一定删不掉"）', () => {
    expect(readDingtalkDeleteOutcome({})).toBe('unknown');
    expect(readDingtalkDeleteOutcome({ requestId: 'x' })).toBe('unknown');
    expect(readDingtalkDeleteOutcome({ result: { ok: 1 } })).toBe('unknown');
  });
});

describe('DingtalkSheetAdapter.deleteRecord — 不能谎报成功', () => {
  const adapter = new DingtalkSheetAdapter();

  beforeEach(() => {
    __resetDingtalkDeleteWarning();
  });

  it('★ 200 + 0 条删除必须抛错 —— 否则会回一句"✅ 已删除"而表里一条没少', async () => {
    // 删除接口的请求参数名无法离线核实（疑为 recordIds 而非 ids），
    // 而参数名不对时钉钉返回的正是 200 + 空结果、**不报错**。
    // 不在这里抛的话：dispatcher 收到一片 fulfilled → 回「✅ 已删除 3 条」
    // → 审计日志记 success，而记录全都还在。破坏性操作里"谎报成功"
    // 比"报错让人重试"危险得多。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ids: [] })),
    );
    await expect(adapter.deleteRecord(dingtalkConfig, 'r1')).rejects.toThrow(
      /未删除任何记录/,
    );
  });

  it('抛错文案要指向真正的排查方向（参数名）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ successCount: 0 })),
    );
    await expect(adapter.deleteRecord(dingtalkConfig, 'r1')).rejects.toThrow(
      /recordIds/,
    );
  });

  it('有肯定信号时正常返回', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ids: ['r1'] })),
    );
    await expect(
      adapter.deleteRecord(dingtalkConfig, 'r1'),
    ).resolves.toBeUndefined();
  });

  it('★ 响应形状认不出时放行 + 同一形状只警告一次，不把"可能没删"升级成"一定删不掉"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({})),
    );
    await expect(
      adapter.deleteRecord(dingtalkConfig, 'r1'),
    ).resolves.toBeUndefined();
    await expect(
      adapter.deleteRecord(dingtalkConfig, 'r2'),
    ).resolves.toBeUndefined();
    // 删除是并发跑的，每条都打会把日志刷满
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('★ 去重按响应键集合，不同形状各报一次 —— 这行日志的用途就是照着补键名', () => {
    // 用一个全局布尔去重的话，第一种没认出的形状会把之后**所有**
    // 其它形状一起吞掉，等于永远只知道一半。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shapes = [{}, { requestId: 'x' }, { traceId: 'y', extra: 1 }];
    return (async () => {
      for (const [i, shape] of shapes.entries()) {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => jsonResponse(shape)),
        );
        await adapter.deleteRecord(dingtalkConfig, `r${i}`);
      }
      expect(warn).toHaveBeenCalledTimes(shapes.length);
      // 同一形状再来一次不重复报
      await adapter.deleteRecord(dingtalkConfig, 'again');
      expect(warn).toHaveBeenCalledTimes(shapes.length);
      warn.mockRestore();
    })();
  });

  it('HTTP 层失败仍按原样抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'no permission' }), {
            status: 403,
          }),
      ),
    );
    await expect(adapter.deleteRecord(dingtalkConfig, 'r1')).rejects.toThrow(
      /no permission/,
    );
  });
});
