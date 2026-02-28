import type { inferProcedureInput } from '@trpc/server';
import { describe, expect, it } from 'vitest';

import type { AppRouter } from '@/server/api/root';
import { createCaller } from '@/server/api/root';
import type { createTRPCContext } from '@/server/api/trpc';

describe('post router', () => {
  it('hello procedure returns greeting', async () => {
    const ctx: Awaited<ReturnType<typeof createTRPCContext>> = {
      db: {} as never,
      session: null,
      headers: new Headers(),
    };

    const caller = createCaller(ctx);

    type Input = inferProcedureInput<AppRouter['post']['hello']>;
    const input: Input = { text: 'test' };

    const result = await caller.post.hello(input);

    expect(result).toEqual({ greeting: 'Hello test' });
  });
});
