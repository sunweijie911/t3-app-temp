import { describe, expect, it } from 'vitest';
import {
  isTimestampFresh,
  REPLAY_TOLERANCE_MS,
  timestampFreshness,
  timestampToMs,
} from '@/modules/im-bot/channels/replay-window';
import { DEDUP_TTL_MS } from '@/modules/im-bot/constants';

const NOW = 1_780_000_000_000; // 2026-05-29 前后，毫秒

describe('REPLAY_TOLERANCE_MS', () => {
  it('★ 与幂等 TTL 相等 —— 否则会开出"验签通过但幂等已过期"的重放区间', () => {
    // 三家共用这一个常量。窗口比幂等 TTL 长的话，抓到的合法回调在
    // 「窗口内、幂等外」的那段区间里重放会被再次完整处理，
    // 一条 CREATE 就多写一条记录。
    expect(REPLAY_TOLERANCE_MS).toBe(DEDUP_TTL_MS);
  });
});

describe('timestampToMs — 单位按数量级判别', () => {
  it('毫秒原样返回', () => {
    expect(timestampToMs(NOW)).toBe(NOW);
    expect(timestampToMs(String(NOW))).toBe(NOW);
  });

  it('★ 秒自动放大成毫秒 —— 三家单位不一致且协议里都没标注', () => {
    // 钉钉 timestamp 头是毫秒、企微 query timestamp 是秒、
    // 飞书 X-Lark-Request-Timestamp 是秒而 header.create_time 是毫秒。
    // 让每个调用方各自乘 1000 的话，猜错单位的表现是"整个平台永久拒收"。
    expect(timestampToMs(NOW / 1000)).toBe(NOW);
    expect(timestampToMs(String(NOW / 1000))).toBe(NOW);
  });

  it('非数字 / 空 / 零 / 负数 → null', () => {
    for (const v of [
      '',
      'abc',
      '2026-05-29T00:00:00Z',
      0,
      -1,
      null,
      undefined,
    ]) {
      expect(timestampToMs(v), String(v)).toBeNull();
    }
  });
});

describe('timestampFreshness — 三态', () => {
  it('窗口内 fresh，窗口外 stale', () => {
    expect(timestampFreshness(NOW, NOW)).toBe('fresh');
    expect(timestampFreshness(NOW - REPLAY_TOLERANCE_MS, NOW)).toBe('fresh');
    expect(timestampFreshness(NOW - REPLAY_TOLERANCE_MS - 1, NOW)).toBe(
      'stale',
    );
    expect(timestampFreshness(NOW + REPLAY_TOLERANCE_MS + 1, NOW)).toBe(
      'stale',
    );
  });

  it('★ 解析不出是 unknown，不是 stale —— 两类调用方要的行为相反', () => {
    // 「协议要求必带时间戳」的地方（钉钉 timestamp 头）：unknown 该拒绝
    // 「只是顺带拿得到」的地方（飞书 header.create_time）：unknown 该放行
    // 混成一个布尔值的话，后者只能写 `if (raw && !fresh(raw))`，
    // 而 'abc' 这种"有值但解析不出"会落进拒绝分支，
    // 平台改一个字段形状就能让整个通道失联。
    expect(timestampFreshness('abc', NOW)).toBe('unknown');
    expect(timestampFreshness(undefined, NOW)).toBe('unknown');
    expect(timestampFreshness('', NOW)).toBe('unknown');
  });

  it('秒单位的时间戳也能正确判窗', () => {
    const staleSec = Math.floor((NOW - REPLAY_TOLERANCE_MS - 5000) / 1000);
    expect(timestampFreshness(String(staleSec), NOW)).toBe('stale');
    const freshSec = Math.floor(NOW / 1000);
    expect(timestampFreshness(String(freshSec), NOW)).toBe('fresh');
  });
});

describe('isTimestampFresh — 布尔版对 unknown 取拒绝', () => {
  it('解析不出一律 false', () => {
    expect(isTimestampFresh('abc', NOW)).toBe(false);
    expect(isTimestampFresh('', NOW)).toBe(false);
    expect(isTimestampFresh('0', NOW)).toBe(false);
    expect(isTimestampFresh('-1', NOW)).toBe(false);
  });

  it('窗口内 true', () => {
    expect(isTimestampFresh(String(NOW - 1000), NOW)).toBe(true);
  });
});
