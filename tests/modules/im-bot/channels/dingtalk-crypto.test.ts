import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  isTimestampFresh,
  robotSignature,
  SIGN_TOLERANCE_MS,
  verifyRobotSignature,
} from '@/modules/im-bot/channels/dingtalk-crypto';

const SECRET = 'SEC0123456789abcdef';

describe('robotSignature', () => {
  it('HmacSHA256 以 secret 为密钥，对 "timestamp\\nsecret" 签名后取 base64', () => {
    const ts = '1700000000000';
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(`${ts}\n${SECRET}`)
      .digest('base64');
    expect(robotSignature(ts, SECRET)).toBe(expected);
  });

  it('输出是 base64 而不是 hex（钉钉与企微/飞书在这点上不同）', () => {
    const sig = robotSignature('1700000000000', SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // sha256 的 base64 固定 44 字符（含一个填充）
    expect(sig).toHaveLength(44);
    expect(sig).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('timestamp 变化签名就变', () => {
    expect(robotSignature('1700000000000', SECRET)).not.toBe(
      robotSignature('1700000000001', SECRET),
    );
  });

  it('secret 变化签名就变（secret 既当密钥又在被签名内容里）', () => {
    expect(robotSignature('1700000000000', SECRET)).not.toBe(
      robotSignature('1700000000000', `${SECRET}x`),
    );
  });

  it('同输入稳定可重现', () => {
    const a = robotSignature('1700000000000', SECRET);
    const b = robotSignature('1700000000000', SECRET);
    expect(a).toBe(b);
  });
});

describe('verifyRobotSignature', () => {
  it('相同签名通过', () => {
    const sig = robotSignature('1700000000000', SECRET);
    expect(verifyRobotSignature(sig, sig)).toBe(true);
  });

  it('不同签名不通过', () => {
    expect(
      verifyRobotSignature(
        robotSignature('1700000000000', SECRET),
        robotSignature('1700000000001', SECRET),
      ),
    ).toBe(false);
  });

  it('长度不同不通过（timingSafeEqual 对不等长会抛错，必须先挡住）', () => {
    expect(verifyRobotSignature('abc', 'abcdef')).toBe(false);
  });

  it('空串不通过非空', () => {
    expect(verifyRobotSignature('', 'x')).toBe(false);
  });
});

describe('isTimestampFresh', () => {
  const now = 1_700_000_000_000;

  it('当前时间通过', () => {
    expect(isTimestampFresh(String(now), now)).toBe(true);
  });

  it('容忍窗口内通过（钉钉官方是 1 小时）', () => {
    expect(isTimestampFresh(String(now - 30 * 60 * 1000), now)).toBe(true);
    expect(isTimestampFresh(String(now + 30 * 60 * 1000), now)).toBe(true);
  });

  it('恰好在边界上通过', () => {
    expect(isTimestampFresh(String(now - SIGN_TOLERANCE_MS), now)).toBe(true);
  });

  it('超出窗口不通过 —— 抓到的旧回调不能无限重放', () => {
    expect(isTimestampFresh(String(now - SIGN_TOLERANCE_MS - 1), now)).toBe(
      false,
    );
  });

  it('未来时间超窗同样不通过', () => {
    expect(isTimestampFresh(String(now + SIGN_TOLERANCE_MS + 1), now)).toBe(
      false,
    );
  });

  it('非数字 / 空 / 负数一律不通过', () => {
    expect(isTimestampFresh('abc', now)).toBe(false);
    expect(isTimestampFresh('', now)).toBe(false);
    expect(isTimestampFresh('-1', now)).toBe(false);
    expect(isTimestampFresh('0', now)).toBe(false);
  });
});
