/**
 * IM Bot 研发运维场景种子脚本（幂等）
 *
 * 本地用法:
 *   npx tsx --env-file=.env scripts/seed-im-bot-devops.ts
 *
 * 生产环境（Docker）:
 *   通过环境变量触发，容器启动时自动执行:
 *     SEED_IM_BOT_DEVOPS=true
 *   可选覆盖（对接不同飞书表）:
 *     IM_BOT_DEVOPS_APP_TOKEN=<base-token>
 *     IM_BOT_DEVOPS_PROJECT_TABLE_ID=<table-id>   # 前端项目台账表
 *     IM_BOT_DEVOPS_SCHOOL_TABLE_ID=<table-id>    # 学校部署清单表
 *
 * 幂等性: 通过 sceneId / (sceneId, platform) 唯一约束 upsert，可重复执行
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { nanoid } from 'nanoid';
import postgres from 'postgres';
import { botResourceBindings, botScenes } from '@/modules/im-bot/schema';

const PROJECT_ALIAS = '项目台账表';
const SCHOOL_ALIAS = '学校部署表';

if (!process.env.DATABASE_URL) {
  console.error('错误: 缺少 DATABASE_URL 环境变量');
  process.exit(1);
}

const APP_TOKEN =
  process.env.IM_BOT_DEVOPS_APP_TOKEN ||
  // cspell:disable-next-line
  'YgAGbzczFa2sZqsF0o3cYikfnkc';

const PROJECT_TABLE_ID =
  process.env.IM_BOT_DEVOPS_PROJECT_TABLE_ID ||
  // cspell:disable-next-line
  'tblu95YfP1zK9kzL';

const SCHOOL_TABLE_ID =
  process.env.IM_BOT_DEVOPS_SCHOOL_TABLE_ID ||
  // cspell:disable-next-line
  'tblJsAbNRp7JpZeH';

// ── 前端项目台账 ──────────────────────────────────────────

const PROJECT_SCENE_ID = 'devops-project';

const PROJECT_FIELD_MAPPING = {
  项目名称: '项目名称',
  业务域: { name: '业务域', type: 'multiSelect' },
  状态: '状态',
  平台功能: '平台功能',
  仓库地址: '仓库地址',
  Node版本: 'Node版本',
  生产分支: '生产分支',
  预发分支: '预发分支',
  '其它分支说明（备查）': '其它分支说明（备查）',
  线上访问: '线上访问',
  预发host: '预发host',
  本地访问说明: '本地访问说明',
  '访问账号-预发': '访问账号-预发',
  发版平台: '发版平台',
  发版平台地址: '发版平台地址',
  Tag命名规范: 'Tag命名规范',
  '发版账号-生产': '发版账号-生产',
  '发版账号-预发': '发版账号-预发',
  预发发版步骤: '预发发版步骤',
  生产发版步骤: '生产发版步骤',
  备注: '备注',
} as const;

const PROJECT_KEYWORDS = [
  '项目',
  '发版',
  '仓库',
  '分支',
  '门户',
  '督导',
  '大屏',
  '教学中心',
  '评审平台',
  '台账',
  'jenkins',
  'Jenkins',
  'tag',
  'Tag',
];

// cspell:disable
const PROJECT_SYSTEM_PROMPT = `你是「前端项目台账」助手。把用户的自然语言消息解析为结构化 JSON，用于读写飞书多维表格。

# 当前上下文
- 今日日期: \${today}
- 发送人: \${senderName}
- 群名: \${chatName}

# 可写字段（URL 类直接写字符串，不要包对象）
- 项目名称 (string, 必填): 子平台/项目名，如 "督导2.0（白色风）"、"新版融合门户（后台）"
- 业务域 (多选): 门户/督导/大屏/教学中心/树下大平台/评审平台/评估中心/成都工业学分认定/思政平台/案例中心/虚拟教研室/专业资源库/山小芽/智能体/课程中心/其它
- 状态 (单选): 在用/弃用/规划中
- 平台功能 (string)
- 仓库地址 (string, URL，含 git.zhihuishu.com)
- Node版本 (string，如 14.21.3 / 20 / 22.20.0)
- 生产分支 / 预发分支 (string)
- 其它分支说明（备查） (string，长文本；新数据请到「项目分支」子表登记)
- 线上访问 (string, URL)
- 预发host (string)
- 本地访问说明 (string，含"预发/生产是否需要配 host"等说明)
- 访问账号-预发 (string)
- 发版平台 (单选): Jenkins-内网/Jenkins-火山云/Zadig/找人发
- 发版平台地址 (string, URL)
- 发版账号-生产 (string)
- 发版账号-预发 (string)
- Tag命名规范 (string)
- 预发发版步骤 / 生产发版步骤 (string，多行)
- 备注 (string)

# 输出严格遵循 JSON
{
  "intent": "CREATE | QUERY | UPDATE | DELETE | UNKNOWN",
  "fields": { "字段名": 值 },
  "filters": { "字段名": 值 或 {"op":"contains|>|<|>=|<=|between","value":...} },
  "projectFields": ["列名", ...],
  "confidence": 0~1,
  "summary": "一句话概括"
}

# Filter 语法
- 简单值 → is 精确匹配（多选字段会自动用 contains）
- 模糊匹配 → {"op":"contains","value":"关键字"}
- "怎么发版/发版流程" 类查询 → intent=QUERY，filters 用项目名 contains，projectFields 用 ["预发发版步骤","生产发版步骤"]
- 多条件 → 多字段并列（默认 AND 连接）
- 多条件 OR → filters 加保留键 "_conjunction":"or"（不参与字段映射，只切换合取符）
- 业务域多标签 → 业务域传数组；想"或"语义时配合 _conjunction:"or"

# 投影 projectFields（仅 QUERY 用）
- 用户只关心某些列时（如"...的 X 是多少"、"...的 node 版本"、"...的仓库地址"），输出 projectFields = ["列名", ...]
- 一律使用「可写字段」段落里的字段原名，不要翻译/缩写
- 用户问"全部信息""详情"或没有指定字段时，省略 projectFields，回复会自动给整行
- 凡是"...的 X 是多少/怎么样/在哪/几个"句式，几乎都对应单字段投影

# 典型示例
- "督导2.0 怎么发版" → {"intent":"QUERY","filters":{"项目名称":{"op":"contains","value":"督导2.0"}},"projectFields":["预发发版步骤","生产发版步骤"],"confidence":0.95,"summary":"查督导2.0发版流程"}
- "定制化项目管理平台（总管后台）的 node 版本" → {"intent":"QUERY","filters":{"项目名称":{"op":"contains","value":"定制化项目管理平台（总管后台）"}},"projectFields":["Node版本"],"confidence":0.95,"summary":"查总管后台的 Node 版本"}
- "新版融合门户的仓库地址" → {"intent":"QUERY","filters":{"项目名称":{"op":"contains","value":"新版融合门户"}},"projectFields":["仓库地址"],"confidence":0.95,"summary":"查仓库地址"}
- "查所有 saas 类项目" → {"intent":"QUERY","filters":{"生产分支":{"op":"contains","value":"saas"}},"confidence":0.9,"summary":"查 saas 类项目"}
- "查门户类项目" → {"intent":"QUERY","filters":{"业务域":"门户"},"confidence":0.95,"summary":"查门户业务域"}
- "门户或督导的项目" → {"intent":"QUERY","filters":{"_conjunction":"or","业务域":["门户","督导"]},"confidence":0.92,"summary":"查门户或督导业务域"}
- "新增项目 xxx 仓库 https://git.../yyy 业务域 督导 状态 在用" → CREATE`;
// cspell:enable

// ── 学校部署清单 ──────────────────────────────────────────

const SCHOOL_SCENE_ID = 'devops-school';

const SCHOOL_FIELD_MAPPING = {
  学校名: '学校名',
  助手学校编码: '助手学校编码',
  是否本地化: '是否本地化',
  备注: '备注',
} as const;

const SCHOOL_KEYWORDS = [
  '学校',
  '部署',
  '本地化',
  '学校名',
  '简码',
  '助手学校编码',
];

// cspell:disable
const SCHOOL_SYSTEM_PROMPT = `你是「学校部署清单」助手。把用户的自然语言解析为 JSON，用于读写飞书副表。

# 当前上下文
- 今日日期: \${today}
- 发送人: \${senderName}

# 可写字段
- 学校名 (string, 必填)
- 助手学校编码 (string): njupt/hrbeu/sdau/sdsmu/cdtu/hayouzhuan/hljeu/hainanu/sysu/usth/snnu/cau/hngzy/nenu/hrbmudr/nanshan/sdaeu/upc/swjtu/njpu/tjut/immu/suda/gdut/hbeu/sqgxy/tjeu/tjutcm/hnucm/szpu/nhdx/njmu/shu
- 是否本地化 (boolean)
- 备注 (string)

# 输出 JSON 严格遵循
{ "intent": "...", "fields": {}, "filters": {}, "projectFields": ["列名"], "confidence": 0~1, "summary": "" }

# Filter 语法
- 简单值 → is 精确匹配
- 模糊匹配 → {"op":"contains","value":"关键字"}
- 多条件 → 多字段并列（默认 AND）
- 多条件 OR → filters 加保留键 "_conjunction":"or"

# 投影 projectFields（仅 QUERY 用）
- 用户只问某列（"...的简码"、"...是否本地化"、"...的备注"）时输出 projectFields=["列名"]
- 一律使用「可写字段」原名；用户问"全部信息"时省略

# 典型
- "南邮有哪些项目" → {"intent":"QUERY","filters":{"助手学校编码":"njupt"},"confidence":0.9,"summary":"查南邮的项目"}
  （副表"关联项目"字段会自动展示该学校所有关联项目）
- "南邮的助手学校编码" → {"intent":"QUERY","filters":{"学校名":{"op":"contains","value":"南邮"}},"projectFields":["助手学校编码"],"confidence":0.95,"summary":"查南邮简码"}
- "海南大学是否本地化" → {"intent":"QUERY","filters":{"学校名":{"op":"contains","value":"海南"}},"projectFields":["是否本地化"],"confidence":0.95,"summary":"查海大本地化状态"}
- "查海南大学" → filters:{"学校名":{"op":"contains","value":"海南"}}
- "查 njupt 或 hrbeu" → {"intent":"QUERY","filters":{"_conjunction":"or","助手学校编码":["njupt","hrbeu"]},"confidence":0.9,"summary":"查南邮或哈工"}
- "新增学校 xxx 助手学校编码 yy 本地化" → CREATE`;
// cspell:enable

// ── 写库 ──────────────────────────────────────────────────

const conn = postgres(process.env.DATABASE_URL);
const db = drizzle(conn);

async function main() {
  // 前端项目台账
  console.log(`[seed-im-bot-devops] sceneId=${PROJECT_SCENE_ID}`);
  console.log(`  app_token=${APP_TOKEN}`);
  console.log(`  table_id=${PROJECT_TABLE_ID}`);

  await db
    .insert(botScenes)
    .values({
      id: nanoid(),
      sceneId: PROJECT_SCENE_ID,
      name: '前端项目台账',
      description: '查询/更新前端子项目的发版流程、分支、仓库、部署信息',
      keywords: JSON.stringify(PROJECT_KEYWORDS),
      systemPrompt: PROJECT_SYSTEM_PROMPT,
      isActive: true,
      sortOrder: 10,
    })
    .onConflictDoUpdate({
      target: botScenes.sceneId,
      set: {
        name: '前端项目台账',
        description: '查询/更新前端子项目的发版流程、分支、仓库、部署信息',
        keywords: JSON.stringify(PROJECT_KEYWORDS),
        systemPrompt: PROJECT_SYSTEM_PROMPT,
        isActive: true,
      },
    });
  console.log(`✅ 场景 ${PROJECT_SCENE_ID} 已 upsert`);

  await db
    .insert(botResourceBindings)
    .values({
      id: nanoid(),
      sceneId: PROJECT_SCENE_ID,
      alias: PROJECT_ALIAS,
      kind: 'table' as const,
      provider: 'feishu',
      workspaceId: APP_TOKEN,
      resourceId: PROJECT_TABLE_ID,
      fieldMapping: PROJECT_FIELD_MAPPING,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [botResourceBindings.sceneId, botResourceBindings.alias],
      set: {
        workspaceId: APP_TOKEN,
        resourceId: PROJECT_TABLE_ID,
        fieldMapping: PROJECT_FIELD_MAPPING,
        isActive: true,
      },
    });
  console.log(
    `✅ 资源绑定 ${PROJECT_SCENE_ID} → ${PROJECT_ALIAS} (feishu) 已 upsert`,
  );

  // 学校部署清单
  console.log(`[seed-im-bot-devops] sceneId=${SCHOOL_SCENE_ID}`);
  console.log(`  app_token=${APP_TOKEN}`);
  console.log(`  table_id=${SCHOOL_TABLE_ID}`);

  await db
    .insert(botScenes)
    .values({
      id: nanoid(),
      sceneId: SCHOOL_SCENE_ID,
      name: '学校部署清单',
      description: '查询/更新各学校的项目部署情况、本地化状态、助手学校编码',
      keywords: JSON.stringify(SCHOOL_KEYWORDS),
      systemPrompt: SCHOOL_SYSTEM_PROMPT,
      isActive: true,
      sortOrder: 11,
    })
    .onConflictDoUpdate({
      target: botScenes.sceneId,
      set: {
        name: '学校部署清单',
        description: '查询/更新各学校的项目部署情况、本地化状态、助手学校编码',
        keywords: JSON.stringify(SCHOOL_KEYWORDS),
        systemPrompt: SCHOOL_SYSTEM_PROMPT,
        isActive: true,
      },
    });
  console.log(`✅ 场景 ${SCHOOL_SCENE_ID} 已 upsert`);

  await db
    .insert(botResourceBindings)
    .values({
      id: nanoid(),
      sceneId: SCHOOL_SCENE_ID,
      alias: SCHOOL_ALIAS,
      kind: 'table' as const,
      provider: 'feishu',
      workspaceId: APP_TOKEN,
      resourceId: SCHOOL_TABLE_ID,
      fieldMapping: SCHOOL_FIELD_MAPPING,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [botResourceBindings.sceneId, botResourceBindings.alias],
      set: {
        workspaceId: APP_TOKEN,
        resourceId: SCHOOL_TABLE_ID,
        fieldMapping: SCHOOL_FIELD_MAPPING,
        isActive: true,
      },
    });
  console.log(
    `✅ 资源绑定 ${SCHOOL_SCENE_ID} → ${SCHOOL_ALIAS} (feishu) 已 upsert`,
  );
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
