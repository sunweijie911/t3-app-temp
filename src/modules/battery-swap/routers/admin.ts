import { TRPCError } from '@trpc/server';
import { asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { adminProcedure, createTRPCRouter } from '@/server/api/trpc';
import { batterySwapPackages } from '@/server/db/schema';

const specSchema = z.object({
  model: z.string().min(1),
  price: z.number().int().min(0),
});

const buttonSchema = z.object({
  label: z.string().trim().min(1).max(20),
  link: z.string().trim().min(1),
});

export const upsertInput = z.object({
  id: z.string().optional(),
  company: z.string().min(1),
  title: z.string().min(1),
  imageUrl: z.string().nullable().optional(),
  detailImageUrl: z.string().nullable().optional(),
  cardBgColor: z.string().nullable().optional(),
  originalPrice: z.number().int().min(0),
  salePrice: z.number().int().min(0),
  specs: z.array(specSchema).min(1),
  depositMethod: z.string().nullable().optional(),
  regionLimit: z.string().nullable().optional(),
  purchaseNotes: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  buttons: z.array(buttonSchema).max(4).default([]),
});

export const batterySwapAdminRouter = createTRPCRouter({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(batterySwapPackages)
      .orderBy(
        asc(batterySwapPackages.sortOrder),
        desc(batterySwapPackages.createdAt),
      );
  }),

  upsert: adminProcedure.input(upsertInput).mutation(async ({ ctx, input }) => {
    const id = input.id ?? nanoid();

    const shared = {
      company: input.company,
      title: input.title,
      imageUrl: input.imageUrl ?? null,
      detailImageUrl: input.detailImageUrl ?? null,
      cardBgColor: input.cardBgColor ?? '#ffffff',
      originalPrice: input.originalPrice,
      salePrice: input.salePrice,
      specs: input.specs,
      depositMethod: input.depositMethod ?? '芝麻信用抵押金',
      regionLimit: input.regionLimit ?? null,
      purchaseNotes: input.purchaseNotes ?? null,
      validFrom: input.validFrom ? new Date(input.validFrom) : null,
      validTo: input.validTo ? new Date(input.validTo) : null,
      buttons: input.buttons,
    };

    // 使用显式 insert/update 代替 onConflictDoUpdate，避免 Drizzle hook 冲突
    if (input.id) {
      const existing = await ctx.db
        .select({ id: batterySwapPackages.id })
        .from(batterySwapPackages)
        .where(eq(batterySwapPackages.id, input.id))
        .limit(1);

      if (existing.length > 0) {
        await ctx.db
          .update(batterySwapPackages)
          .set(shared)
          .where(eq(batterySwapPackages.id, input.id));
        return { id: input.id };
      }
    }

    await ctx.db.insert(batterySwapPackages).values({
      id,
      ...shared,
      sortOrder: 0,
      isActive: false,
    });

    return { id };
  }),

  reorder: adminProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        for (const [i, id] of input.ids.entries()) {
          await tx
            .update(batterySwapPackages)
            .set({ sortOrder: i })
            .where(eq(batterySwapPackages.id, id));
        }
      });
      return { success: true };
    }),

  toggleActive: adminProcedure
    .input(z.object({ id: z.string(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(batterySwapPackages)
        .set({ isActive: input.isActive })
        .where(eq(batterySwapPackages.id, input.id))
        .returning({ id: batterySwapPackages.id });

      if (updated.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '套餐不存在' });
      }

      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(batterySwapPackages)
        .where(eq(batterySwapPackages.id, input.id))
        .returning({ id: batterySwapPackages.id });

      if (deleted.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '套餐不存在' });
      }

      return { success: true };
    }),
});
