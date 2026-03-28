import { lt } from 'drizzle-orm';
import { env } from '@/env';
import { db } from '@/server/db';
import { adminAuditLog } from '@/server/db/schema';
import { getConfigValue } from '@/server/services/config';

export async function GET(request: Request) {
  // 鉴权：校验 Bearer Token
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!env.CRON_SECRET || token !== env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 读取配置
  const enabled = await getConfigValue('audit.autoCleanupEnabled');
  if (enabled !== 'true') {
    return Response.json({ skipped: true, reason: '自动清理未启用' });
  }

  const retentionDays = Number(await getConfigValue('audit.retentionDays'));
  if (!retentionDays || retentionDays <= 0) {
    return Response.json({ skipped: true, reason: '保留天数未配置' });
  }

  // 计算截止日期并删除
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const deleted = await db
    .delete(adminAuditLog)
    .where(lt(adminAuditLog.createdAt, cutoffDate))
    .returning({ id: adminAuditLog.id });

  return Response.json({
    success: true,
    deleted: deleted.length,
    cutoffDate: cutoffDate.toISOString(),
    retentionDays,
  });
}
