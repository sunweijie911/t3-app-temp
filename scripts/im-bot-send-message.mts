/**
 * ⚠️ 这个脚本会产生真实副作用，不是"模拟"。
 *
 * 它构造一条**合法的**飞书加密回调 POST 给 webhook，然后走完整处理链：
 *   验签 → 解密 → 场景匹配 → LLM 解析 → 对多维表做 CRUD → 回复
 *
 * 也就是说：
 *   - 会真的往绑定的多维表写 / 改 / 删数据
 *   - 会真的往群里发消息（回复走飞书 API 主动发送）
 *   - 会真的消耗 LLM 调用
 *
 * 原名 simulate-feishu.mts —— "simulate" 这个名字有误导性，会让人以为
 * 是干跑（dry run），随手执行一下就往财务表里写了条数据。
 *
 * 用法：
 *   npx tsx --env-file=.env scripts/im-bot-send-message.mts "本月支出合计"
 *
 * 可用 env 覆盖：
 *   SIM_CHAT_ID       目标群（默认 AI测试群）
 *   SIM_OPEN_ID       伪装的发送者
 *   SIM_BOT_OPEN_ID   机器人自身 open_id，见下方说明
 *   SIM_ENDPOINT      webhook 地址（默认 localhost:3000）
 */
import crypto from 'node:crypto';

const CHAT_ID =
  process.env.SIM_CHAT_ID ?? 'oc_6e3116758151407584639d7d3dd5fae8';
const OPEN_ID =
  process.env.SIM_OPEN_ID ?? 'ou_0dd8f824117dd0410390b9f4d5e84f99';
const ENDPOINT =
  process.env.SIM_ENDPOINT ?? 'http://localhost:3000/api/bot/feishu/webhook';

/**
 * mentions 里机器人的 open_id。
 *
 * ⚠️ 这里以前硬编码 'ou_bot'，脚本能跑通纯属侥幸：
 * channels/feishu.ts 的 enrich() 会校验「被 @ 的是不是我」——
 *   if (isGroup && botOpenId && !mentions.some(m => m.id.open_id === botOpenId))
 *     → 丢弃这条消息
 * 只有在 getFeishuBotOpenId() **拿不到**自身 ID（fail-open）时，
 * 'ou_bot' 才不会被比对。一旦机器人拿到了 bot/v3/info 权限，
 * 这个脚本就会开始静默无响应，而且完全看不出为什么。
 *
 * 所以：真实调试时用 SIM_BOT_OPEN_ID 填上机器人的真 open_id。
 */
const BOT_OPEN_ID = process.env.SIM_BOT_OPEN_ID ?? 'ou_bot';

const encryptKey = process.env.IM_BOT_FEISHU_ENCRYPT_KEY;
const verificationToken = process.env.IM_BOT_FEISHU_VERIFICATION_TOKEN;
if (!encryptKey || !verificationToken) {
  console.error('缺少 IM_BOT_FEISHU_ENCRYPT_KEY / VERIFICATION_TOKEN');
  process.exit(1);
}

/** 飞书事件加密：AES-256-CBC，key=sha256(encryptKey)，iv 放在密文头部 16 字节 */
function encryptFeishuEvent(plain: string, key: string): string {
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, body]).toString('base64');
}

const text = process.argv.slice(2).join(' ');
if (!text) {
  console.error(
    '需要给一条消息内容。\n' +
      '  npx tsx --env-file=.env scripts/im-bot-send-message.mts "本月支出合计"',
  );
  process.exit(1);
}
const eventId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const event = {
  schema: '2.0',
  header: {
    event_id: eventId,
    event_type: 'im.message.receive_v1',
    token: verificationToken,
    create_time: String(Date.now()),
    tenant_key: 'sim',
    app_id: process.env.IM_BOT_FEISHU_APP_ID ?? '',
  },
  event: {
    sender: {
      sender_id: { open_id: OPEN_ID, user_id: 'sim', union_id: 'sim' },
      sender_type: 'user',
      tenant_key: 'sim',
    },
    message: {
      message_id: `om_sim_${Date.now()}`,
      chat_id: CHAT_ID,
      chat_type: 'group',
      message_type: 'text',
      // 群聊消息带 @机器人 的占位符，adapter 会剥掉
      content: JSON.stringify({ text: `@_user_1 ${text}` }),
      mentions: [
        {
          key: '@_user_1',
          id: { open_id: BOT_OPEN_ID },
          name: '项目助手',
          tenant_key: 'sim',
        },
      ],
      create_time: String(Date.now()),
    },
  },
};

async function main() {
  console.log('⚠️  这会真的写数据、真的往群里发消息\n');
  console.log('消息:    ', text);
  console.log('目标群:  ', CHAT_ID);
  console.log('发送者:  ', OPEN_ID);
  console.log('eventId: ', eventId);
  console.log('端点:    ', ENDPOINT, '\n');

  const encrypted = encryptFeishuEvent(JSON.stringify(event), encryptKey);
  const started = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypt: encrypted }),
  });
  const body = await res.text();
  console.log(`webhook 响应 ${res.status} (${Date.now() - started}ms):`, body);
  console.log(
    '\n处理是异步的（after()），回复会在几秒后出现在群里。',
    '\n用 scripts/im-bot-inspect-events.mts 看这条事件的解析细节。',
    '\n若群里毫无反应，先看 SIM_BOT_OPEN_ID 的说明。',
  );
}
main().catch((e) => {
  console.error('💥', e);
  process.exitCode = 1;
});
