#!/usr/bin/env node
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]])
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

// cspell:disable-next-line
const APP_TOKEN = 'CtrubXJNyalVc8sxTuWczLK5nsc';
// cspell:disable-next-line
const TABLE_ID = 'tblZNjrIpjuBL7nx';

const appId = process.env.IM_BOT_FEISHU_APP_ID;
const appSecret = process.env.IM_BOT_FEISHU_APP_SECRET;

if (!appId || !appSecret) {
  console.error('缺少 IM_BOT_FEISHU_APP_ID / IM_BOT_FEISHU_APP_SECRET');
  process.exit(1);
}

async function getToken() {
  const res = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const data = await res.json();
  if (data.code !== 0)
    throw new Error(`token 获取失败: ${JSON.stringify(data)}`);
  return data.tenant_access_token;
}

async function listFields(token) {
  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/fields?page_size=100`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`字段查询失败: ${JSON.stringify(data)}`);
  return data.data?.items ?? [];
}

const FIELD_TYPE_NAMES = {
  1: '多行文本',
  2: '数字',
  3: '单选',
  4: '多选',
  5: '日期',
  7: '复选框',
  11: '人员',
  13: '电话号码',
  15: '超链接',
  17: '附件',
  18: '关联',
  19: '查找引用',
  20: '公式',
  21: '双向关联',
  22: '地理位置',
  23: '群组',
  1001: '创建时间',
  1002: '最后更新时间',
  1003: '创建人',
  1004: '修改人',
  1005: '自动编号',
};

(async () => {
  const token = await getToken();
  const fields = await listFields(token);
  console.log(`\n表格字段 (${fields.length} 个):\n`);
  for (const f of fields) {
    const typeName = FIELD_TYPE_NAMES[f.type] ?? `type=${f.type}`;
    const primary = f.is_primary ? ' [主键]' : '';
    const formula = f.type === 20 ? ' [公式·只读]' : '';
    let extra = '';
    // 单选/多选字段：列出选项
    const options = f.property?.options;
    if (Array.isArray(options) && options.length > 0) {
      extra = `\n      选项: ${options.map((o) => o.name).join(' / ')}`;
    }
    console.log(
      `  • ${f.field_name}  (${typeName})${primary}${formula}${extra}`,
    );
  }
  console.log();
})().catch((err) => {
  console.error('错误:', err.message);
  process.exit(1);
});
