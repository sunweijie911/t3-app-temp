// cspell:ignore wwcorp zhangsan lisi
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/services/credentials', () => ({
  getWecomCredentials: vi.fn(),
}));

import { WecomChannelAdapter } from '@/modules/im-bot/channels/wecom';
import {
  callbackSignature,
  encryptMessage,
} from '@/modules/im-bot/channels/wecom-crypto';
import { getWecomCredentials } from '@/modules/im-bot/services/credentials';

const mockCreds = vi.mocked(getWecomCredentials);

const AES_KEY = crypto.randomBytes(32).toString('base64').slice(0, 43);
const TOKEN = 'my-callback-token';
const CORP_ID = 'wwcorp123';

const adapter = new WecomChannelAdapter();

const botPayload = {
  msgid: 'MSG-1',
  chatid: 'CHAT-1',
  chattype: 'group',
  from: { userid: 'zhangsan', name: '张三' },
  msgtype: 'text',
  text: { content: '新增项目 督导2.0' },
  webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
};

/** 构造一个签名与加密都正确的回调请求 */
function makeCallback(
  payload: unknown = botPayload,
  opts: {
    timestamp?: string;
    nonce?: string;
    corpId?: string;
    sig?: string;
  } = {},
) {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? '1234567';
  const encrypt = encryptMessage(
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    AES_KEY,
    opts.corpId ?? CORP_ID,
  );
  const sig = opts.sig ?? callbackSignature(TOKEN, timestamp, nonce, encrypt);
  const url = `https://example.com/api/bot/wecom/webhook?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}`;
  return new Request(url, {
    method: 'POST',
    body: `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><Encrypt><![CDATA[${encrypt}]]></Encrypt></xml>`,
  });
}

beforeEach(() => {
  mockCreds.mockReset();
  mockCreds.mockResolvedValue({
    corpId: CORP_ID,
    botToken: TOKEN,
    encodingAesKey: AES_KEY,
    botSecret: 'secret',
  });
});

describe('WecomChannelAdapter.verifyUrl — GET echostr', () => {
  function makeVerifyReq(
    echoPlain = 'echo-plain-text',
    opts: { sig?: string } = {},
  ) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'n1';
    const echostr = encryptMessage(echoPlain, AES_KEY, CORP_ID);
    const sig = opts.sig ?? callbackSignature(TOKEN, timestamp, nonce, echostr);
    return new Request(
      `https://example.com/api/bot/wecom/webhook?msg_signature=${sig}&timestamp=${timestamp}&nonce=${nonce}&echostr=${encodeURIComponent(echostr)}`,
    );
  }

  it('验签通过后回写解密的明文本身（不是 JSON）', async () => {
    const res = await adapter.verifyUrl(makeVerifyReq('plain-echo-123'));
    expect(res?.status).toBe(200);
    await expect(res?.text()).resolves.toBe('plain-echo-123');
    expect(res?.headers.get('Content-Type')).toContain('text/plain');
  });

  it('缺少参数 → 400', async () => {
    const res = await adapter.verifyUrl(
      new Request('https://example.com/api/bot/wecom/webhook'),
    );
    expect(res?.status).toBe(400);
  });

  it('签名不匹配 → 403', async () => {
    const res = await adapter.verifyUrl(
      makeVerifyReq('x', { sig: 'deadbeef' }),
    );
    expect(res?.status).toBe(403);
  });

  it('未配置凭证 → 403，不让验证流程裸奔', async () => {
    mockCreds.mockResolvedValue({ corpId: CORP_ID });
    const res = await adapter.verifyUrl(makeVerifyReq());
    expect(res?.status).toBe(403);
  });
});

describe('WecomChannelAdapter.decode — 验签与解密', () => {
  it('合法回调解析出统一消息，并保留 raw', async () => {
    const r = await adapter.decode(makeCallback());
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.platform).toBe('wecom');
    expect(r.message.content).toBe('新增项目 督导2.0');
    expect(r.message.chatId).toBe('CHAT-1');
    expect(r.message.chatType).toBe('group');
    expect(r.message.senderId).toBe('zhangsan');
    expect(r.message.senderName).toBe('张三');
    // msgid 兼作幂等键（企微没有独立 eventId）
    expect(r.message.eventId).toBe('MSG-1');
    // raw 必须带上 webhook_url，否则 reply 无从下手
    expect(r.message.raw).toMatchObject({
      webhook_url: botPayload.webhook_url,
    });
  });

  it('XML 请求体不再导致 400 —— decode 自己读 text()', async () => {
    // 回归：旧的 verify(req, body) 两段式要求调用方先 req.json()，
    // 企微是 XML，第一步就失败，整个平台接不进来
    const r = await adapter.decode(makeCallback());
    expect(r.kind).toBe('ok');
  });

  it('缺少验签参数 → 400', async () => {
    const r = await adapter.decode(
      new Request('https://example.com/x', { method: 'POST', body: '<xml/>' }),
    );
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(400);
  });

  it('XML 里没有 Encrypt 字段 → 400', async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const r = await adapter.decode(
      new Request(
        `https://example.com/x?msg_signature=s&timestamp=${ts}&nonce=n`,
        { method: 'POST', body: '<xml><ToUserName>x</ToUserName></xml>' },
      ),
    );
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(400);
  });

  it('签名不匹配 → 403', async () => {
    const r = await adapter.decode(makeCallback(botPayload, { sig: 'bad' }));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });

  it('未配置 botToken/encodingAesKey → 403，webhook 不裸奔', async () => {
    mockCreds.mockResolvedValue({ corpId: CORP_ID });
    const r = await adapter.decode(makeCallback());
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });
});

describe('WecomChannelAdapter.decode — 重放与跨企业防护', () => {
  it('过期时间戳被拒（企微回调没有 eventId 幂等，这是第一道防线）', async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const r = await adapter.decode(
      makeCallback(botPayload, { timestamp: old }),
    );
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.reason).toContain('时间戳');
  });

  it('未来时间戳同样被拒', async () => {
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    const r = await adapter.decode(
      makeCallback(botPayload, { timestamp: future }),
    );
    expect(r.kind).toBe('reject');
  });

  it('容忍窗口内的时间戳放行', async () => {
    const recent = String(Math.floor(Date.now() / 1000) - 60);
    const r = await adapter.decode(
      makeCallback(botPayload, { timestamp: recent }),
    );
    expect(r.kind).toBe('ok');
  });

  it('receiveId 与本企业 corpId 不符 → 403（别的企业的回调不能当自己的）', async () => {
    const r = await adapter.decode(
      makeCallback(botPayload, { corpId: 'wwOTHER' }),
    );
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.reason).toContain('receiveId');
  });
});

describe('WecomChannelAdapter.decode — 消息过滤', () => {
  it('非文本消息 → ignored', async () => {
    const r = await adapter.decode(
      makeCallback({ ...botPayload, msgtype: 'image' }),
    );
    expect(r.kind).toBe('ignored');
  });

  it('正文为空 → ignored，不浪费 LLM token', async () => {
    const r = await adapter.decode(
      makeCallback({ ...botPayload, text: { content: '   ' } }),
    );
    expect(r.kind).toBe('ignored');
  });

  it('缺少 msgid → ignored（没有幂等键不能进处理链）', async () => {
    const { msgid, ...rest } = botPayload;
    void msgid;
    const r = await adapter.decode(makeCallback(rest));
    expect(r.kind).toBe('ignored');
    expect(r.kind === 'ignored' && r.reason).toContain('msgid');
  });

  it('缺少发送者 userid → ignored', async () => {
    const r = await adapter.decode(makeCallback({ ...botPayload, from: {} }));
    expect(r.kind).toBe('ignored');
  });

  it('单聊无 chatid 时用 userid 兜底，保证 PendingAction 键稳定', async () => {
    const r = await adapter.decode(
      makeCallback({ ...botPayload, chattype: 'single', chatid: undefined }),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatType).toBe('p2p');
    expect(r.message.chatId).toBe('p2p:zhangsan');
  });

  it('自建应用的 XML 明文 → ignored 并说明原因（而不是当成解析失败）', async () => {
    const xmlPlain =
      '<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi]]></Content></xml>';
    const r = await adapter.decode(makeCallback(xmlPlain));
    expect(r.kind).toBe('ignored');
    expect(r.kind === 'ignored' && r.reason).toContain('自建应用');
  });

  it('senderName 缺失时回退到 userid', async () => {
    const r = await adapter.decode(
      makeCallback({ ...botPayload, from: { userid: 'lisi' } }),
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.senderName).toBe('lisi');
  });
});
