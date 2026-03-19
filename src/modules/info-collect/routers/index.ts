import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { ID_CARD_RE, PHONE_RE } from '@/modules/info-collect/constants';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { infoCollectRecords } from '@/server/db/schema';
import { encrypt, hashForLookup } from '@/server/services/crypto';
import { infoCollectSubmitLimiter } from '@/server/services/rate-limiter';

import { infoCollectAdminRouter } from './admin';
import { fetchInfoCollectConfig } from './shared';

export const infoCollectRouter = createTRPCRouter({
  getConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await fetchInfoCollectConfig(ctx.db);
    return {
      bannerUrl: config.bannerUrl,
      enabledFields: config.enabledFields,
    };
  }),

  submit: publicProcedure
    .input(
      z.object({
        name: z.string().optional(),
        phone: z.string().regex(PHONE_RE, '请输入有效的手机号'),
        idCard: z.string().regex(ID_CARD_RE, '请输入有效的身份证号'),
        proofImageUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 限流：基于 IP（从 headers 提取）或 phone 号，防批量提交
      const rateLimitKey = `info-submit:${input.phone}`;
      const rateCheck = infoCollectSubmitLimiter.check(rateLimitKey);
      if (!rateCheck.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `提交过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        });
      }

      const { enabledFields } = await fetchInfoCollectConfig(ctx.db);

      // Validate enabled fields
      if (enabledFields.includes('name')) {
        if (!input.name || input.name.length < 2 || input.name.length > 20) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '姓名需 2-20 个字符',
          });
        }
      }

      if (enabledFields.includes('proofImage')) {
        if (
          !input.proofImageUrl ||
          !input.proofImageUrl.startsWith('/uploads/info-collect/')
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: '请上传在职证明截图',
          });
        }
      }

      // 加密身份证号，哈希用于去重查询
      const encryptedIdCard = encrypt(input.idCard);
      const idCardHash = hashForLookup(input.idCard);

      return ctx.db.transaction(async (tx) => {
        // FOR UPDATE 防止并发提交竞态（使用哈希查找代替明文比对）
        const existing = await tx
          .select({
            id: infoCollectRecords.id,
            status: infoCollectRecords.status,
          })
          .from(infoCollectRecords)
          .where(
            and(
              eq(infoCollectRecords.phone, input.phone),
              eq(infoCollectRecords.idCardHash, idCardHash),
            ),
          )
          .for('update');

        const blocking = existing.filter(
          (r) => !['rejected', 'needs_supplement'].includes(r.status),
        );

        if (blocking.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: '您已提交过信息，请勿重复提交',
          });
        }

        if (existing.length > 0) {
          await tx.delete(infoCollectRecords).where(
            inArray(
              infoCollectRecords.id,
              existing.map((r) => r.id),
            ),
          );
        }

        const id = nanoid();
        await tx.insert(infoCollectRecords).values({
          id,
          name: enabledFields.includes('name') ? (input.name ?? null) : null,
          phone: input.phone,
          idCard: encryptedIdCard,
          idCardHash,
          proofImageUrl: enabledFields.includes('proofImage')
            ? (input.proofImageUrl ?? null)
            : null,
          status: 'pending',
        });

        return { id };
      });
    }),

  query: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(PHONE_RE, '请输入有效的手机号'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const records = await ctx.db
        .select({
          id: infoCollectRecords.id,
          status: infoCollectRecords.status,
          rejectReason: infoCollectRecords.rejectReason,
          trackingNumber: infoCollectRecords.trackingNumber,
          createdAt: infoCollectRecords.createdAt,
        })
        .from(infoCollectRecords)
        .where(eq(infoCollectRecords.phone, input.phone))
        .orderBy(desc(infoCollectRecords.createdAt));
      return records;
    }),

  admin: infoCollectAdminRouter,
});
