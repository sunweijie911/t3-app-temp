// cspell:ignore wwcorp zhangsan lisi aibot
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/services/credentials', () => ({
  getWecomCredentials: vi.fn(),
}));

import {
  __resetWecomReplyGuard,
  readWecomReplyContext,
  WecomChannelAdapter,
} from '@/modules/im-bot/channels/wecom';
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
  // 官方「接收消息」回调（path/100719）给的是 response_url
  aibotid: 'AIBOT-1',
  response_url: 'https://qyapi.weixin.qq.com/cgi-bin/aibot/response?token=abc',
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
  __resetWecomReplyGuard();
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
    // raw 必须带上 response_url，否则 reply 无从下手
    expect(r.message.raw).toMatchObject({
      response_url: botPayload.response_url,
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

describe('WecomChannelAdapter.reply — 官方「主动回复」协议', () => {
  const makeMsg = (messageId = 'MSG-1') => ({
    platform: 'wecom' as const,
    eventId: messageId,
    messageId,
    chatId: 'CHAT-1',
    chatType: 'group' as const,
    senderId: 'zhangsan',
    senderName: '张三',
    content: 'hi',
    timestamp: Date.now(),
    raw: { ...botPayload },
  });

  function stubFetchOk() {
    // 每次调用给一份新的 Response —— 复用同一个实例时第二次 .json() 会炸
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function sentBody(fetchMock: ReturnType<typeof stubFetchOk>, call = 0) {
    const [, init] = fetchMock.mock.calls[call] as [string, RequestInit];
    return JSON.parse(String(init.body)) as {
      msgtype: string;
      markdown?: { content: string };
      text?: { content: string };
    };
  }

  it('body 用 msgtype=markdown —— 主动回复接口不支持 text', async () => {
    const fetchMock = stubFetchOk();
    await adapter.reply(makeMsg(), '共 2 条：\n1. 督导2.0');

    const body = sentBody(fetchMock);
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown?.content).toBe('共 2 条：\n1. 督导2.0');
    expect(body.text).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('markdown 特殊字符原样进 content，不做转义', async () => {
    const fetchMock = stubFetchOk();
    await adapter.reply(makeMsg(), '进度 *50%* 与 _备注_ 见 `表格`');
    expect(sentBody(fetchMock).markdown?.content).toBe(
      '进度 *50%* 与 _备注_ 见 `表格`',
    );
    vi.unstubAllGlobals();
  });

  it('POST 打到 response_url 上', async () => {
    const fetchMock = stubFetchOk();
    await adapter.reply(makeMsg(), 'hi');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(botPayload.response_url);
    vi.unstubAllGlobals();
  });

  it('上限是 markdown 的 20480 字节，超出才截断', async () => {
    const fetchMock = stubFetchOk();
    // 10000 个汉字 = 30000 字节，超过 20480
    await adapter.reply(makeMsg(), '汉'.repeat(10_000));

    const sent = sentBody(fetchMock).markdown?.content ?? '';
    expect(adapter.maxReplyBytes).toBe(20_480);
    expect(Buffer.byteLength(sent, 'utf8')).toBeLessThanOrEqual(20_480);
    vi.unstubAllGlobals();
  });

  it('3000 字节的回复不再被截 —— 旧的 2048 上限白扔了 90% 预算', async () => {
    const fetchMock = stubFetchOk();
    const long = '汉'.repeat(1000); // 3000 字节
    await adapter.reply(makeMsg(), long);
    expect(sentBody(fetchMock).markdown?.content).toBe(long);
    vi.unstubAllGlobals();
  });

  it('同一条消息第二次 reply 被跳过：response_url 只能调用一次', async () => {
    const fetchMock = stubFetchOk();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = makeMsg('MSG-DUP');

    await adapter.reply(msg, '第一次');
    await adapter.reply(msg, '第二次');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('不同消息互不影响', async () => {
    const fetchMock = stubFetchOk();
    await adapter.reply(makeMsg('MSG-A'), 'a');
    await adapter.reply(makeMsg('MSG-B'), 'b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('★ HTTP 失败不算"回过了"，同一条消息还能再试', async () => {
    // 以前是发送**之前**就标记：一次超时 / 5xx 就把这条消息永久标成回过了，
    // 用户从"这次没回复"变成"永远收不到回复"。而那次失败里
    // response_url 并没有被平台消费掉。
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => new Response('boom', { status: 500 }))
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const msg = makeMsg('MSG-RETRY');

    await adapter.reply(msg, '第一次');
    await adapter.reply(msg, '重试');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    err.mockRestore();
    vi.unstubAllGlobals();
  });

  it('★ 业务 errcode 非 0 同样不算"回过了"', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ errcode: 45009, errmsg: 'limit' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const msg = makeMsg('MSG-ERRCODE');

    await adapter.reply(msg, '第一次');
    await adapter.reply(msg, '重试');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    err.mockRestore();
    vi.unstubAllGlobals();
  });

  it('★ 网络异常（fetch 抛）同样不算"回过了"', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('network down');
      })
      .mockImplementationOnce(
        async () =>
          new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const msg = makeMsg('MSG-NET-FAIL');

    await adapter.reply(msg, '第一次');
    await adapter.reply(msg, '重试');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    err.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('readWecomReplyContext — response_url 优先，webhook_url 兼容', () => {
  it('取 response_url', () => {
    const ctx = readWecomReplyContext(botPayload);
    expect(ctx?.responseUrl).toBe(botPayload.response_url);
  });

  it('存量 raw 里只有 webhook_url 时照常能回（仅覆盖发版瞬间的存量 raw）', () => {
    const ctx = readWecomReplyContext({
      chatid: 'CHAT-1',
      chattype: 'group',
      webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    });
    expect(ctx?.responseUrl).toBe(
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    );
  });

  it('两个字段都在时以 response_url 为准', () => {
    const ctx = readWecomReplyContext({
      response_url: 'https://qyapi.weixin.qq.com/cgi-bin/aibot/response?t=new',
      webhook_url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=old',
    });
    expect(ctx?.responseUrl).toContain('aibot/response');
  });
});

describe('WecomChannelAdapter — 群聊剥 @机器人 前缀', () => {
  // 飞书剥 `@_user_N` 占位符、钉钉剥 `@昵称`，企微以前原样透传 ——
  // 带 @ 的正文会直接进 LLM，也会原样落进审计日志的 content 列
  it('群聊剥掉开头的 @机器人', async () => {
    const r = await adapter.decode(
      makeCallback({
        ...botPayload,
        text: { content: '@小助手 新增项目 督导2.0' },
      }),
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.message.content).toBe('新增项目 督导2.0');
  });

  it('只剥一次，后面的 @张三 是业务内容要保留', async () => {
    const r = await adapter.decode(
      makeCallback({
        ...botPayload,
        text: { content: '@小助手 @张三的项目进度' },
      }),
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.message.content).toBe('@张三的项目进度');
  });

  it('只 @ 了机器人什么都没写 → 按正文为空丢弃', async () => {
    const r = await adapter.decode(
      makeCallback({ ...botPayload, text: { content: '@小助手' } }),
    );
    expect(r.kind).toBe('ignored');
  });

  it('单聊不剥 —— 私聊「@张三 的进度」不能被吃掉第一个 token', async () => {
    const r = await adapter.decode(
      makeCallback({
        ...botPayload,
        chattype: 'single',
        chatid: '',
        text: { content: '@张三 的进度' },
      }),
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.message.content).toBe('@张三 的进度');
  });

  it('正文本来就不带 @ 时原样保留（对不加前缀的场景无害）', async () => {
    const r = await adapter.decode(makeCallback(botPayload));
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.message.content).toBe('新增项目 督导2.0');
  });
});

describe('WecomChannelAdapter — response_url 域名白名单', () => {
  it('非企微域被拒绝，reply 不发请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await adapter.reply(
      {
        platform: 'wecom',
        eventId: 'e',
        messageId: 'm',
        chatId: 'c',
        chatType: 'group',
        senderId: 's',
        senderName: 'n',
        content: 'x',
        timestamp: Date.now(),
        raw: { response_url: 'https://attacker.example/collect' },
      },
      '机密数据',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('旧 webhook_url 落在非企微域同样被拒', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await adapter.reply(
      {
        platform: 'wecom',
        eventId: 'e-legacy',
        messageId: 'm-legacy',
        chatId: 'c',
        chatType: 'group',
        senderId: 's',
        senderName: 'n',
        content: 'x',
        timestamp: Date.now(),
        raw: { webhook_url: 'https://attacker.example/collect' },
      },
      '机密数据',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('企微自己的域名照常通过', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
      );
    await adapter.reply(
      {
        platform: 'wecom',
        eventId: 'e',
        messageId: 'm',
        chatId: 'c',
        chatType: 'group',
        senderId: 's',
        senderName: 'n',
        content: 'x',
        timestamp: Date.now(),
        raw: botPayload,
      },
      'hi',
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});
