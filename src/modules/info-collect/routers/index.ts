import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { ID_CARD_RE } from '@/modules/info-collect/constants';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import { infoCollectRecords } from '@/server/db/schema';
import { encrypt, hashForLookup } from '@/server/services/crypto';
import {
  getDingtalkUserInfo,
  getUserByAuthCode,
} from '@/server/services/dingtalk';
import { infoCollectSubmitLimiter } from '@/server/services/rate-limiter';

import { infoCollectAdminRouter } from './admin';
import { fetchInfoCollectConfig } from './shared';

export const infoCollectRouter = createTRPCRouter({
  getConfig: publicProcedure.query(async ({ ctx }) => {
    const config = await fetchInfoCollectConfig(ctx.db);
    return { bannerUrl: config.bannerUrl };
  }),

  submit: publicProcedure
    .input(
      z.object({
        authCode: z.string().min(1, '缺少免登授权码'),
        idCard: z.string().regex(ID_CARD_RE, '请输入有效的身份证号'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. 通过钉钉免登获取用户信息
      const userInfo = await getDingtalkUserInfo(input.authCode).catch(
        (err: Error) => {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `钉钉免登失败: ${err.message}`,
          });
        },
      );

      // 2. 限流：基于钉钉 userid
      const rateLimitKey = `info-submit:${userInfo.userid}`;
      const rateCheck = infoCollectSubmitLimiter.check(rateLimitKey);
      if (!rateCheck.allowed) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `提交过于频繁，请 ${Math.ceil(rateCheck.retryAfterMs / 1000)} 秒后重试`,
        });
      }

      // 3. 加密身份证号
      const encryptedIdCard = encrypt(input.idCard);
      const idCardHash = hashForLookup(input.idCard);

      // 4. 事务：去重 + 创建记录
      return ctx.db.transaction(async (tx) => {
        const existing = await tx
          .select({
            id: infoCollectRecords.id,
            status: infoCollectRecords.status,
          })
          .from(infoCollectRecords)
          .where(
            and(
              eq(infoCollectRecords.dingtalkUserid, userInfo.userid),
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

        // 删除被拒绝/需补充的旧记录
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
          dingtalkUserid: userInfo.userid,
          name: userInfo.name,
          phone: userInfo.mobile,
          department: userInfo.department,
          position: userInfo.position,
          jobNumber: userInfo.jobNumber,
          idCard: encryptedIdCard,
          idCardHash,
          status: 'pending',
        });

        return { id };
      });
    }),

  query: publicProcedure
    .input(
      z.object({
        authCode: z.string().min(1, '缺少免登授权码'),
      }),
    )
    .query(async ({ ctx, input }) => {
      // 通过 authCode 获取钉钉 userid
      const authUser = await getUserByAuthCode(input.authCode).catch(
        (err: Error) => {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `钉钉免登失败: ${err.message}`,
          });
        },
      );

      const records = await ctx.db
        .select({
          id: infoCollectRecords.id,
          status: infoCollectRecords.status,
          rejectReason: infoCollectRecords.rejectReason,
          trackingNumber: infoCollectRecords.trackingNumber,
          createdAt: infoCollectRecords.createdAt,
        })
        .from(infoCollectRecords)
        .where(eq(infoCollectRecords.dingtalkUserid, authUser.userid))
        .orderBy(desc(infoCollectRecords.createdAt));

      return records;
    }),

  admin: infoCollectAdminRouter,
});
