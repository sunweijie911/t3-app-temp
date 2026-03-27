import { TRPCError } from '@trpc/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  BANNER_CONFIG_KEY,
  DEFAULT_VISIBLE_FIELDS,
  VISIBLE_FIELDS_CONFIG_KEY,
} from '@/modules/sim-card/constants';
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc';
import {
  simCardClickLogs,
  simCardPackages,
  systemConfig,
} from '@/server/db/schema';
import { getDingtalkUserInfo } from '@/server/services/dingtalk';

import { simCardAdminRouter } from './admin';

export const simCardRouter = createTRPCRouter({
  // 获取已上架套餐列表
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(simCardPackages)
      .where(eq(simCardPackages.isActive, true))
      .orderBy(asc(simCardPackages.sortOrder));
  }),

  // 获取 Banner URL
  bannerUrl: publicProcedure.query(async ({ ctx }) => {
    const row = await ctx.db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, BANNER_CONFIG_KEY))
      .limit(1);
    const v = row[0]?.value;
    return typeof v === 'string' ? v : null;
  }),

  // 获取前台展示的用户字段配置
  visibleFields: publicProcedure.query(async ({ ctx }) => {
    const row = await ctx.db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, VISIBLE_FIELDS_CONFIG_KEY))
      .limit(1);
    const v = row[0]?.value;
    return Array.isArray(v) ? (v as string[]) : DEFAULT_VISIBLE_FIELDS;
  }),

  // 记录点击埋点
  trackClick: publicProcedure
    .input(
      z.object({
        packageId: z.string().min(1),
        authCode: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 获取钉钉用户信息
      const userInfo = await getDingtalkUserInfo(input.authCode).catch(
        (err: Error) => {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `钉钉免登失败: ${err.message}`,
          });
        },
      );

      // 获取套餐信息（用于冗余标题）
      const pkg = await ctx.db
        .select({ title: simCardPackages.title })
        .from(simCardPackages)
        .where(eq(simCardPackages.id, input.packageId))
        .limit(1);

      const pkgRow = pkg[0];
      if (!pkgRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '套餐不存在' });
      }

      // 从请求头获取 UA 和 IP
      const userAgent = ctx.headers.get('user-agent') ?? '';
      const ipAddress =
        ctx.headers.get('x-real-ip') ??
        ctx.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
        '';

      // 解析设备信息
      const deviceInfo = parseDeviceInfo(userAgent);

      await ctx.db.insert(simCardClickLogs).values({
        packageId: input.packageId,
        packageTitle: pkgRow.title,
        dingtalkUserid: userInfo.userid,
        userName: userInfo.name,
        userPhone: userInfo.mobile,
        department: userInfo.department,
        jobNumber: userInfo.jobNumber,
        userAgent,
        ipAddress,
        deviceInfo,
      });

      return { success: true };
    }),

  admin: simCardAdminRouter,
});

// 从 UA 解析设备信息
function parseDeviceInfo(ua: string): string {
  const parts: string[] = [];

  // 操作系统
  if (/iPhone/i.test(ua)) parts.push('iPhone');
  else if (/iPad/i.test(ua)) parts.push('iPad');
  else if (/Android/i.test(ua)) {
    const match = ua.match(/Android\s+([\d.]+)/);
    parts.push(`Android ${match?.[1] ?? ''}`);
  } else if (/Windows/i.test(ua)) parts.push('Windows');
  else if (/Mac OS/i.test(ua)) parts.push('macOS');

  // 客户端
  if (/DingTalk/i.test(ua)) parts.push('钉钉');
  else if (/MicroMessenger/i.test(ua)) parts.push('微信');
  else if (/AlipayClient/i.test(ua)) parts.push('支付宝');

  return parts.join(' / ') || ua.slice(0, 100);
}
