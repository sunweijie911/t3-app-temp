import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * services/ 层此前完全没有测试，而「平台停用开关」的判定就落在这里 ——
 * 这个判定一旦写错，后果是两个极端：要么关不掉（改之前就是这样，开关
 * 纯摆设），要么把还在用的平台全关掉（缺行/默认 false 处理错了）。
 * 两种都只能在生产上被发现，所以这一层必须有测试。
 */

const rows: Array<Record<string, unknown>> = [];

vi.mock('@/env', () => ({
  env: {
    IM_BOT_FEISHU_APP_ID: '',
    IM_BOT_FEISHU_APP_SECRET: '',
    IM_BOT_FEISHU_ENCRYPT_KEY: '',
    IM_BOT_FEISHU_VERIFICATION_TOKEN: '',
  },
}));

const selectSpy = vi.fn();

vi.mock('@/server/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      selectSpy(...args);
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
  },
}));

import {
  getDingtalkCredentials,
  getFeishuCredentials,
  isPlatformEnabled,
  resetCredentialsCache,
} from '@/modules/im-bot/services/credentials';

function setRow(row: Record<string, unknown> | null) {
  rows.length = 0;
  if (row) rows.push(row);
}

beforeEach(() => {
  resetCredentialsCache();
  selectSpy.mockClear();
  setRow(null);
});

describe('isPlatformEnabled', () => {
  it('isActive=true → 启用', async () => {
    setRow({ credentials: { appId: 'a' }, isActive: true });
    expect(await isPlatformEnabled('feishu')).toBe(true);
  });

  it('isActive=false → 停用（这才是开关真正生效）', async () => {
    setRow({ credentials: { appId: 'a' }, isActive: false });
    expect(await isPlatformEnabled('feishu')).toBe(false);
  });

  it('表里没有这一行 → 按启用处理', async () => {
    // 飞书可以纯用 env 配置，那种部署从来没往 bot_platform 写过行；
    // 按停用处理会让它在升级瞬间失联
    setRow(null);
    expect(await isPlatformEnabled('feishu')).toBe(true);
  });

  it('缺行时不会被 isActive 的默认值 false 误伤', async () => {
    setRow(null);
    expect(await isPlatformEnabled('dingtalk')).toBe(true);
    expect(await isPlatformEnabled('wecom')).toBe(true);
  });

  it('有行但 credentials 为空 → 等同没有行，按启用处理', async () => {
    // upsertPlatform 的 isActive 默认 false，后台 Switch 的初始 state 也是
    // false —— 「打开页面就点保存」会留下一行 {credentials:{}, isActive:false}。
    // 纯 env 配置飞书的部署恰好长这样，那个 false 不是管理员的决定。
    // 只看 isActive 会让这类部署在升级瞬间静默失联。
    setRow({ credentials: {}, isActive: false });
    expect(await isPlatformEnabled('feishu')).toBe(true);
  });

  it('凭证非空时 isActive=false 才真的是停用', async () => {
    setRow({ credentials: { appId: 'a' }, isActive: false });
    expect(await isPlatformEnabled('feishu')).toBe(false);
  });
});

describe('resetCredentialsCache 与在途查询的竞态', () => {
  it('reset 之后，在途查询的旧结果不会被写回缓存', async () => {
    // 清 map 是不够的：查询跑在 map 之外的 promise 里，清空后它照样会
    // cache.set —— 写回的是保存**之前**的行，还带一个新的 10 分钟 TTL。
    // 现象是「后台点了停用并保存，十分钟内毫无反应」，且无从查起。
    setRow({ credentials: { appId: 'old' }, isActive: true });
    const inflightRead = getFeishuCredentials();

    // 模拟管理员在这条读还没回来时保存了新配置
    resetCredentialsCache();
    setRow({ credentials: { appId: 'new' }, isActive: false });

    await inflightRead; // 旧结果回来了，但不该污染缓存
    expect(await isPlatformEnabled('feishu')).toBe(false);
    const after = await getFeishuCredentials();
    expect(after.appId).toBe('new');
  });
});

describe('凭证行缓存', () => {
  it('同一平台的 isActive 与 credentials 共用一次查询', async () => {
    // 行本来就是一起读回来的。分成两份缓存的话，热路径上每条 webhook
    // 会多打一次 DB —— 而 ack 预算只有 3 秒
    setRow({ credentials: { appId: 'a', appSecret: 'b' }, isActive: true });
    await isPlatformEnabled('feishu');
    await getFeishuCredentials();
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('并发调用只发一次查询（inflight 去重）', async () => {
    setRow({ credentials: { appId: 'a' }, isActive: true });
    await Promise.all([
      isPlatformEnabled('feishu'),
      getFeishuCredentials(),
      getFeishuCredentials(),
    ]);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('resetCredentialsCache 后重新查库', async () => {
    setRow({ credentials: { appId: 'a' }, isActive: true });
    await getFeishuCredentials();
    expect(selectSpy).toHaveBeenCalledTimes(1);

    resetCredentialsCache();
    setRow({ credentials: { appId: 'a' }, isActive: false });
    expect(await isPlatformEnabled('feishu')).toBe(false);
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });

  it('不同平台各查各的，不会串行共用一份缓存', async () => {
    setRow({ credentials: { appKey: 'k' }, isActive: true });
    await getFeishuCredentials();
    await getDingtalkCredentials();
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });
});

describe('钉钉 chatbotUserId', () => {
  it('配了就读出来（decode 据此比对回调）', async () => {
    setRow({
      credentials: { appKey: 'k', chatbotUserId: '$:LWCP_v1:$abc' },
      isActive: true,
    });
    const c = await getDingtalkCredentials();
    expect(c.chatbotUserId).toBe('$:LWCP_v1:$abc');
  });

  it('没配则为 undefined，decode 会跳过该校验', async () => {
    setRow({ credentials: { appKey: 'k' }, isActive: true });
    const c = await getDingtalkCredentials();
    expect(c.chatbotUserId).toBeUndefined();
  });

  it('空串按没配处理，不会变成一个永远匹配不上的期望值', async () => {
    setRow({ credentials: { appKey: 'k', chatbotUserId: '' }, isActive: true });
    const c = await getDingtalkCredentials();
    expect(c.chatbotUserId).toBeUndefined();
  });
});
