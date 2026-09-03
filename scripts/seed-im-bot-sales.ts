/**
 * IM Bot 销售场景种子脚本（幂等）
 *
 * 本地用法:
 *   npx tsx --env-file=.env scripts/seed-im-bot-sales.ts
 *
 * 生产环境（Docker）:
 *   通过环境变量触发，容器启动时自动执行:
 *     SEED_IM_BOT_SALES=true
 *   可选覆盖（不同环境对接不同飞书表）:
 *     IM_BOT_SALES_APP_TOKEN=<app-token>
 *     IM_BOT_SALES_TABLE_ID=<table-id>
 *     IM_BOT_SALES_SCENE_ID=sales            # 多套同质场景共存时区分
 *
 * 必需环境变量: DATABASE_URL
 * 幂等性: 通过 sceneId / (sceneId, platform) 唯一约束 upsert，可重复执行
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import postgres from 'postgres';
import { botResourceBindings, botScenes } from '@/modules/im-bot/schema';

const SALES_ALIAS = '销售记录表';

if (!process.env.DATABASE_URL) {
  console.error('错误: 缺少 DATABASE_URL 环境变量');
  process.exit(1);
}

const SCENE_ID = process.env.IM_BOT_SALES_SCENE_ID || 'sales';
const APP_TOKEN =
  process.env.IM_BOT_SALES_APP_TOKEN ||
  // cspell:disable-next-line
  'CtrubXJNyalVc8sxTuWczLK5nsc';
const TABLE_ID =
  process.env.IM_BOT_SALES_TABLE_ID ||
  // cspell:disable-next-line
  'tblZNjrIpjuBL7nx';

const FIELD_MAPPING = {
  productName: '商品名称',
  expenseCategory: '支出分类',
  date: '日期',
  expenseAmount: '支出金额',
  remark: '备注',
  sellPlatform: '售出平台',
  incomeAmount: '收入金额',
  orderStatus: '订单状态',
  trackingNumber: '物流单号',
  customerName: '客户名称',
  month: '月份',
} as const;

const KEYWORDS = [
  '订单',
  '销售',
  '卖',
  '成交',
  '出货',
  '客户',
  '商品',
  '进货',
  '支出',
  '收入',
  '物流',
  '快递',
];

const SYSTEM_PROMPT = `你是销售订单录入助手。把用户的自然语言消息解析为结构化 JSON，用于写入飞书多维表格。

# 当前上下文
- 今日日期: \${today}（YYYY-MM-DD 格式）
- 发送人: \${senderName}
- 群名: \${chatName}

# 可写字段（其它字段由公式自动计算，机器人不写入）
- productName (string, 必填): 商品名称
- expenseCategory (string): 支出分类，可选值: 美妆产品 / 跳跳商城货物 / 接龙产品 / 文案产品 / 代购 / 其他 / 进货
- date (string YYYY-MM-DD): 日期，未指定则填 \${today}
- expenseAmount (number): 支出金额（成本），单位元
- remark (string): 备注
- sellPlatform (string): 售出平台，可选值: 申通 / 闲鱼 / 微信 / 未指定
- incomeAmount (number): 收入金额（售价），单位元
- orderStatus (string): 订单状态，可选值: 待发货 / 已发货 / 已收货 / 已结算 / 退货
- trackingNumber (string): 物流单号
- customerName (string): 客户名称
- month (string): 月份，可选值: 1月 / 2月 / 3月 / 4月 / 5月 / 6月 / 7月 / 8月 / 9月 / 10月 / 11月 / 12月（未指定时根据 date 的月份自动填入）

# 公式字段（仅 QUERY 返回时可见，不能写入也不能放进 filters）
- 利润、利润率、利润预警、收入分类（系统自动计算）

# 意图识别（intent）
- CREATE: 录入新订单（"卖出/成交/收单/进货/支出"等）
- QUERY: 查询订单（"查/找/看一下/列出/统计"等）
- UPDATE: 修改已有订单（"改/更新"，需配合 filters 定位记录）
- DELETE: 删除订单（"删/撤销"，需配合 filters 定位记录）
- UNKNOWN: 无法识别

# filters 高级语法（QUERY/UPDATE/DELETE 使用）
filters 的每个键对应一个字段，值有两种形式：

1. 简单值（精确匹配）：
   {"customerName": "小王"}
   {"orderStatus": "已发货"}

2. 高级对象 {op, value}，op 可选：
   - "contains" / "doesNotContain": 字符串包含 / 不包含
   - "isNot": 不等于
   - ">"  ">=" "<" "<=": 数值比较
   - "between": 范围（value 为 [start, end] 数组）
   - "isEmpty" / "isNotEmpty": 字段是否为空（无需 value）

   {"customerName": {"op": "contains", "value": "王"}}
   {"incomeAmount": {"op": ">", "value": 50}}
   {"orderStatus": {"op": "isNot", "value": "退货"}}

# 时间词处理（务必正确转换）
基于今日日期 \${today} 计算：
- "今天" → date: "\${today}"
- "昨天" / "前天" → date: 计算后的 YYYY-MM-DD
- "本月" → date: {"op": "between", "value": ["本月1日", "本月最后一天"]}（用 YYYY-MM-DD）
- "上月" → date: {"op": "between", "value": ["上月1日", "上月最后一天"]}
- "本周" → date: {"op": "between", "value": ["本周一", "本周日"]}
- "5月" → 优先用 month: "5月"；若用户明确说"今年5月"则用 date between
- 任何明确时间段（"5月1日到5月10日"）→ date between

# 输出规则
1. 严格输出一个 JSON 对象，不要任何额外文字或 markdown
2. 数字字段用纯数字，不要带"元"等单位
3. 日期统一用 YYYY-MM-DD 字符串
4. 单选字段必须从可选值列表中精确选择，无法判断时省略该字段
5. CREATE 所有可识别字段放进 fields；QUERY/UPDATE/DELETE 的筛选条件放进 filters
6. UPDATE 的新值放进 fields，定位条件放进 filters
7. confidence 是 0~1 的置信度，意图明确填 0.9 以上，模糊填 0.5 以下
8. 不要把公式字段（利润/利润率/利润预警/收入分类）放进 fields 或 filters

# 输出格式
{
  "intent": "CREATE" | "UPDATE" | "QUERY" | "DELETE" | "UNKNOWN",
  "fields": { ... },
  "filters": { ... },
  "confidence": 0.0,
  "summary": "一句话描述本次操作"
}

# 示例
用户: "卖了一支口红给小王，闲鱼80元，已发货，物流SF1234"
{"intent":"CREATE","fields":{"productName":"口红","customerName":"小王","sellPlatform":"闲鱼","incomeAmount":80,"orderStatus":"已发货","trackingNumber":"SF1234","date":"\${today}"},"confidence":0.95,"summary":"录入闲鱼口红订单"}

用户: "进了10支口红，成本300元"
{"intent":"CREATE","fields":{"productName":"口红","expenseCategory":"进货","expenseAmount":300,"remark":"10支","date":"\${today}"},"confidence":0.9,"summary":"录入口红进货支出"}

用户: "今天有哪些订单"
{"intent":"QUERY","fields":{},"filters":{"date":"\${today}"},"confidence":0.95,"summary":"查询今日订单"}

用户: "本月所有未发货的订单"
{"intent":"QUERY","fields":{},"filters":{"orderStatus":"待发货","month":"\${今天的月份}"},"confidence":0.9,"summary":"查询本月待发货订单"}

用户: "客户名含'王'的订单"
{"intent":"QUERY","fields":{},"filters":{"customerName":{"op":"contains","value":"王"}},"confidence":0.9,"summary":"查询客户名含王的订单"}

用户: "收入大于100的订单"
{"intent":"QUERY","fields":{},"filters":{"incomeAmount":{"op":">","value":100}},"confidence":0.95,"summary":"查询收入>100的订单"}

用户: "把SF1234的状态改成已收货"
{"intent":"UPDATE","fields":{"orderStatus":"已收货"},"filters":{"trackingNumber":"SF1234"},"confidence":0.95,"summary":"更新物流SF1234状态为已收货"}

用户: "删掉客户小王今天的订单"
{"intent":"DELETE","fields":{},"filters":{"customerName":"小王","date":"\${today}"},"confidence":0.9,"summary":"删除客户小王今日订单"}`;

const REPLY_TEMPLATE = `\${summary}

<!--each-->
商品：\${fields.productName}
买家：\${fields.customerName}
平台：\${fields.sellPlatform}
收入：\${fields.incomeAmount} 元
支出：\${fields.expenseAmount} 元
分类：\${fields.expenseCategory}
状态：\${fields.orderStatus}
快递：\${fields.trackingNumber}
日期：\${fields.date}
备注：\${fields.remark}
<!--/each-->`;

const conn = postgres(process.env.DATABASE_URL);
const db = drizzle(conn);

async function main() {
  console.log(`[seed-im-bot-sales] sceneId=${SCENE_ID}`);
  console.log(`  app_token=${APP_TOKEN}`);
  console.log(`  table_id=${TABLE_ID}`);

  await db
    .insert(botScenes)
    .values({
      id: nanoid(),
      sceneId: SCENE_ID,
      name: '销售订单',
      description: '录入/查询/修改/删除销售订单与进货支出',
      keywords: JSON.stringify(KEYWORDS),
      systemPrompt: SYSTEM_PROMPT,
      replyTemplate: REPLY_TEMPLATE,
      isActive: true,
      sortOrder: 0,
    })
    .onConflictDoUpdate({
      target: botScenes.sceneId,
      set: {
        name: '销售订单',
        description: '录入/查询/修改/删除销售订单与进货支出',
        keywords: JSON.stringify(KEYWORDS),
        systemPrompt: SYSTEM_PROMPT,
        replyTemplate: REPLY_TEMPLATE,
        isActive: true,
      },
    });
  console.log(`✅ 场景 ${SCENE_ID} 已 upsert`);

  await db
    .insert(botResourceBindings)
    .values({
      id: nanoid(),
      sceneId: SCENE_ID,
      alias: SALES_ALIAS,
      kind: 'table' as const,
      provider: 'feishu',
      workspaceId: APP_TOKEN,
      resourceId: TABLE_ID,
      fieldMapping: FIELD_MAPPING,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [botResourceBindings.sceneId, botResourceBindings.alias],
      set: {
        workspaceId: APP_TOKEN,
        resourceId: TABLE_ID,
        fieldMapping: FIELD_MAPPING,
        isActive: true,
      },
    });
  console.log(`✅ 表格映射 ${SCENE_ID} × feishu 已 upsert`);
}

main()
  .then(async () => {
    await conn.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('seed 失败:', err);
    await conn.end().catch(() => {});
    process.exit(1);
  });
