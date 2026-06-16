import { describe, expect, it } from 'vitest';

import { readUserInfoContact } from '@/modules/lucky-wheel/schema';

describe('readUserInfoContact', () => {
  it('读取新快照的 contact', () => {
    expect(
      readUserInfoContact({ name: 'a', contact: 'x@y.com', address: null }),
    ).toBe('x@y.com');
  });

  it('兼容旧快照的 phone 键', () => {
    expect(
      readUserInfoContact({
        name: 'a',
        phone: '13800138000',
        address: null,
      }),
    ).toBe('13800138000');
  });

  it('两者皆无返回 null', () => {
    expect(readUserInfoContact({ name: 'a', address: null })).toBeNull();
  });

  it('入参 null 返回 null', () => {
    expect(readUserInfoContact(null)).toBeNull();
  });
});
