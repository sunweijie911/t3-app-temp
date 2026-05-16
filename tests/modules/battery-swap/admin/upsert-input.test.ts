import { describe, expect, it } from 'vitest';

import { upsertInput } from '@/modules/battery-swap/routers/admin';

const baseValid = {
  company: '智租',
  title: '智租×申通月卡',
  originalPrice: 9900,
  salePrice: 6900,
  specs: [{ model: '48V 20Ah', price: 6900 }],
  buttons: [{ label: '立即购买', link: 'https://example.com' }],
};

describe('batterySwapAdminRouter.upsertInput.buttons', () => {
  it('接受 1 个合法按钮', () => {
    expect(() => upsertInput.parse(baseValid)).not.toThrow();
  });

  it('接受空数组（admin 端用 toast 提醒，不在 zod 强禁）', () => {
    expect(() =>
      upsertInput.parse({ ...baseValid, buttons: [] }),
    ).not.toThrow();
  });

  it('拒绝超过 4 个按钮', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      label: `B${i}`,
      link: 'https://x',
    }));
    expect(() => upsertInput.parse({ ...baseValid, buttons: five })).toThrow();
  });

  it('拒绝空 label', () => {
    expect(() =>
      upsertInput.parse({
        ...baseValid,
        buttons: [{ label: '', link: 'https://x' }],
      }),
    ).toThrow();
  });

  it('拒绝 label 超过 20 字', () => {
    expect(() =>
      upsertInput.parse({
        ...baseValid,
        buttons: [{ label: 'x'.repeat(21), link: 'https://x' }],
      }),
    ).toThrow();
  });

  it('拒绝空 link', () => {
    expect(() =>
      upsertInput.parse({
        ...baseValid,
        buttons: [{ label: '立即购买', link: '' }],
      }),
    ).toThrow();
  });

  it('未传 buttons 时默认空数组', () => {
    const { buttons: _omit, ...withoutButtons } = baseValid;
    const parsed = upsertInput.parse(withoutButtons);
    expect(parsed.buttons).toEqual([]);
  });
});
