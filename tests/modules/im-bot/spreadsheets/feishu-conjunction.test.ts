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

  it('★ 多值 + 另一个条件：下推能下推的，剩下的在内存里补（A AND (B OR C)）', async () => {
    // 回归：以前直接抛错，而错误文案会触发纠正重试 —— 模型为了让请求跑通
    // 把「闲鱼和微信」砍成单个平台并报成功，用户以为拿到了完整答案。
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: { body?: string }) => {
        bodies.push(JSON.parse(init.body ?? '{}') as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              // 平台按下推的条件（收入金额 > 100）返回，域没被下推
              items: [
                { record_id: 'r1', fields: { 域: '门户', 收入金额: 200 } },
                { record_id: 'r2', fields: { 域: '督导', 收入金额: 300 } },
                { record_id: 'r3', fields: { 域: '其它', 收入金额: 400 } },
              ],
              has_more: false,
            },
          }),
          { status: 200 },
        );
      }),
    );

    const out = await adapter.queryRecordsWithMeta(config, {
      域: ['门户', '督导'],
      收入金额: { op: '>', value: 100 },
    });

    // 下推的 filter 里只有能按 AND 组合的那部分
    const filter = bodies[0]?.filter as {
      conjunction: string;
      conditions: Array<{ field_name: string }>;
    };
    expect(filter.conjunction).toBe('and');
    expect(filter.conditions.map((c) => c.field_name)).toEqual(['收入金额']);

    // 「域」在内存里补上：其它 被过滤掉，门户/督导 都保留
    expect(out.records.map((r) => r.recordId)).toEqual(['r1', 'r2']);
  });

  it('残差是唯一条件时也成立（全部下推不了 → 全内存过滤）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                { record_id: 'r1', fields: { 域: '门户', 名称: 'A' } },
                { record_id: 'r2', fields: { 域: '其它', 名称: 'B' } },
              ],
              has_more: false,
            },
          }),
          { status: 200 },
        );
      }),
    );
    // 两个 key 都给多值 → 都需要 OR → 都进残差
    const out = await adapter.queryRecordsWithMeta(config, {
      域: ['门户', '督导'],
      名称: ['A', 'Z'],
    });
    expect(out.records.map((r) => r.recordId)).toEqual(['r1']);
  });

  it('★ 文本字段返回 [{text,type}] 段数组时，残差过滤照样命中', async () => {
    // 回归：飞书 records/search 的文本字段返回的是
    // `[{"text":"门户","type":"text"}]`，record-filter 以前 String(member)
    // 得到 "[object Object]"，于是**任何走残差路径的文本列筛选恒返回 0 条**
    // —— 用户看到的是"没查到"，而不是报错
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  record_id: 'r1',
                  fields: {
                    域: [{ text: '门户', type: 'text' }],
                    名称: [{ text: 'A', type: 'text' }],
                  },
                },
                {
                  record_id: 'r2',
                  fields: {
                    域: [{ text: '其它', type: 'text' }],
                    名称: [{ text: 'B', type: 'text' }],
                  },
                },
              ],
              has_more: false,
            },
          }),
          { status: 200 },
        );
      }),
    );
    const out = await adapter.queryRecordsWithMeta(config, {
      域: ['门户', '督导'],
      名称: ['A', 'Z'],
    });
    expect(out.records.map((r) => r.recordId)).toEqual(['r1']);
    // 归一化之后 fields 里不该再有平台原始形状
    expect(out.records[0]?.fields.域).toBe('门户');
  });

  it('文本字段的多段（正文 + @提及）拼成一句话再比', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [
                {
                  record_id: 'r1',
                  fields: {
                    名称: [
                      { text: '门户', type: 'text' },
                      { text: '重构', type: 'text' },
                    ],
                    域: [{ text: '门户', type: 'text' }],
                  },
                },
              ],
              has_more: false,
            },
          }),
          { status: 200 },
        );
      }),
    );
    const out = await adapter.queryRecordsWithMeta(config, {
      名称: ['门户 重构', 'Z'],
      域: ['门户', '督导'],
    });
    expect(out.records.map((r) => r.recordId)).toEqual(['r1']);
  });

  it('★ 外层显式 or + 区间：无法分解，仍然报错', async () => {
    // OR 不能像 AND 那样分解：只满足残差项的记录会被下推的那半边
    // 直接过滤掉，答案会偏小 —— 这种情况必须报错而不是给个错数
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
