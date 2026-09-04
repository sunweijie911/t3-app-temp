/**
 * 只读：查看 / 分析机器人的审计事件。无任何副作用。
 *
 * 排障主力工具。逐条打出：原文、命中场景、解析出的 intent、筛选键与操作符、
 * 聚合的算子与结果、纠正重试次数与原因、影响的 recordId、耗时、错误；
 * 末尾给结果分布、意图分布、重试/限流条数、耗时中位数，以及**未清理的
 * 待确认**（正常应接近 0，长期堆积说明有用户被卡在等待态）。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/im-bot-inspect-events.mts        # 最近 30 条
 *   npx tsx --env-file=.env scripts/im-bot-inspect-events.mts 97     # id > 97 的增量
 *
 * 增量看法：每次输出末尾会给出「最新 id」，下次拿它当参数就是增量。
 */

import { asc, desc, gt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { botEventLogs, botPendingActions } from '@/modules/im-bot/schema';

if (!process.env.DATABASE_URL) {
  console.error('错误: 缺少 DATABASE_URL 环境变量');
  process.exit(1);
}
const conn = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(conn);
/** 不传参数时看最近 RECENT 条，而不是从头拉全表 */
const RECENT = 30;
const arg = process.argv[2];
const since = arg !== undefined ? Number(arg) : -1;

let from = since;
if (from < 0) {
  const [max] = await db
    .select({ id: botEventLogs.id })
    .from(botEventLogs)
    .orderBy(desc(botEventLogs.id))
    .limit(1);
  from = Math.max(0, (max?.id ?? 0) - RECENT);
}

const rows = await db
  .select()
  .from(botEventLogs)
  .where(gt(botEventLogs.id, from))
  .orderBy(asc(botEventLogs.id));

console.log(`=== 共 ${rows.length} 条事件 (id > ${from}) ===\n`);

const icon: Record<string, string> = {
  success: '✅',
  error: '❌',
  ignored: '⏭️',
  pending: '⏳',
};
for (const r of rows) {
  const t = r.createdAt.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
  });
  const rd = (r.resultData ?? {}) as EventResultData;
  const req = rd.request ?? {};
  const bits: string[] = [];
  if (req.confidence !== undefined) bits.push(`conf=${req.confidence}`);
  if (req.filters && Object.keys(req.filters).length)
    bits.push(`filters=${JSON.stringify(req.filters)}`);
  if (req.fieldKeys) bits.push(`fields=[${req.fieldKeys.join(',')}]`);
  if (req.projectFields) bits.push(`proj=[${req.projectFields.join(',')}]`);
  if (req.aggregate)
    bits.push(
      `agg=${req.aggregate.op}(${req.aggregate.field ?? ''})${req.aggregate.groupBy ? ` by ${req.aggregate.groupBy}` : ''}`,
    );
  if (rd.aggregate)
    bits.push(
      `结果=${rd.aggregate.value ?? `${rd.aggregate.groupCount}组`} 扫描=${rd.aggregate.recordCount}${rd.aggregate.skipped ? ` 跳过${rd.aggregate.skipped}` : ''}`,
    );
  if (rd.attempts) bits.push(`attempts=${rd.attempts}`);
  if (rd.recordCount !== undefined) bits.push(`命中=${rd.recordCount}`);
  if (rd.deleted !== undefined) bits.push(`已删=${rd.deleted}`);
  if (rd.updated !== undefined) bits.push(`已更新=${rd.updated}`);
  if (rd.updatedAll) bits.push('批量');
  if (rd.failed) bits.push(`失败=${rd.failed}`);
  if (rd.pendingType) bits.push(`pending=${rd.pendingType}`);
  if (rd.picked) bits.push(`选=${rd.picked}`);
  if (rd.aborted) bits.push(`中止=${rd.aborted}`);
  if (rd.droppedFields) bits.push(`丢弃=[${rd.droppedFields.join(',')}]`);

  console.log(
    `#${r.id} ${t} ${icon[r.result] ?? '?'} ${(r.intent ?? '-').padEnd(9)} ${r.costMs ?? '?'}ms`,
  );
  console.log(`   原文: ${r.content}`);
  if (bits.length) console.log(`   解析: ${bits.join(' | ')}`);
  if (rd.retriedFrom)
    console.log(`   重试原因: ${JSON.stringify(rd.retriedFrom)}`);
  if (r.errorMsg) console.log(`   ⚠️  ${r.errorMsg}`);
  if (rd.error) console.log(`   错误: ${rd.error}`);
  console.log();
}

// 汇总
const by = (k: string) => rows.filter((r) => r.result === k).length;
console.log('=== 汇总 ===');
console.log(
  `success=${by('success')} error=${by('error')} pending=${by('pending')} ignored=${by('ignored')}`,
);
const intents = new Map<string, number>();
for (const r of rows)
  intents.set(r.intent ?? '-', (intents.get(r.intent ?? '-') ?? 0) + 1);
console.log('意图分布:', [...intents].map(([k, v]) => `${k}=${v}`).join(' '));
const retried = rows.filter(
  (r) => (r.resultData as EventResultData | null)?.attempts,
);
console.log(
  `触发过纠正重试: ${retried.length} 条 ${retried.map((r) => `#${r.id}`).join(' ')}`,
);
const limited = rows.filter((r) => r.errorMsg?.includes('限流'));
console.log(`触发限流: ${limited.length} 条`);
const costs = rows
  .map((r) => r.costMs ?? 0)
  .filter(Boolean)
  .sort((a, b) => a - b);
if (costs.length)
  console.log(
    `耗时 中位=${costs[Math.floor(costs.length / 2)]}ms 最大=${costs.at(-1)}ms`,
  );

// 迁移没跑时这张表可能缺列（如 selectableCount）—— 给一句能照着做的提示，
// 而不是抛一堆 Postgres errorMissingColumn 出来
let pend: Array<{
  type: string;
  candidates: unknown;
  selectableCount: number | null;
  expiresAt: Date;
}> = [];
try {
  pend = await db.select().from(botPendingActions);
} catch (err) {
  // drizzle 会把 Postgres 错误包一层，code 在 cause 上
  const e = err as { code?: string; cause?: { code?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  console.log(
    code === '42703'
      ? '\n⚠️ bot_pending_action 缺列，待确认状态读不出来 —— 需要执行 pnpm db:migrate'
      : `\n⚠️ 读取待确认失败: ${err instanceof Error ? err.message : String(err)}`,
  );
}
console.log(`\n未清理待确认: ${pend.length}`);
for (const p of pend) {
  const left = Math.round((p.expiresAt.getTime() - Date.now()) / 1000);
  console.log(
    `  ${p.type} | 候选 ${(p.candidates as unknown[]).length}` +
      ` | 可选序号上限=${p.selectableCount ?? '-'}` +
      ` | ${left > 0 ? `${left}s 后过期` : '已过期'}`,
  );
}
console.log(
  `\n[最新 id = ${rows.at(-1)?.id ?? from}] —— 下次拿它当参数就是增量`,
);
await conn.end();
process.exit(0);
