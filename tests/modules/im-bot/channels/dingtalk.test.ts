// cspell:ignore zhangsan lisi dingabc
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/services/credentials', () => ({
  getDingtalkCredentials: vi.fn(),
}));

import {
  DingtalkChannelAdapter,
  readDingtalkReplyContext,
} from '@/modules/im-bot/channels/dingtalk';
import { robotSignature } from '@/modules/im-bot/channels/dingtalk-crypto';
import { getDingtalkCredentials } from '@/modules/im-bot/services/credentials';

const mockCreds = vi.mocked(getDingtalkCredentials);

const SECRET = 'SECdingtalk123456';
const adapter = new DingtalkChannelAdapter();

const basePayload = {
  msgId: 'msg-1',
  msgtype: 'text',
  text: { content: '新增项目 督导2.0' },
  conversationType: '2',
  conversationId: 'cid-1',
  conversationTitle: '前端项目群',
  senderId: 'dingabc',
  senderNick: '张三',
  senderStaffId: 'zhangsan',
  sessionWebhook: 'https://oapi.dingtalk.com/robot/sendBySession?session=xyz',
  sessionWebhookExpiredTime: Date.now() + 3600_000,
};

function makeReq(
  payload: unknown = basePayload,
  opts: { timestamp?: string; sign?: string; noHeaders?: boolean } = {},
) {
  const timestamp = opts.timestamp ?? String(Date.now());
  const sign = opts.sign ?? robotSignature(timestamp, SECRET);
  const headers: Record<string, string> = opts.noHeaders
    ? { 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json', timestamp, sign };
  return new Request('https://example.com/api/bot/dingtalk/webhook', {
    method: 'POST',
    headers,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

beforeEach(() => {
  mockCreds.mockReset();
  mockCreds.mockResolvedValue({
    appKey: 'key',
    appSecret: 'secret',
    botSecret: SECRET,
  });
});

describe('DingtalkChannelAdapter.decode — 验签', () => {
  it('合法回调解析出统一消息', async () => {
    const r = await adapter.decode(makeReq());
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.platform).toBe('dingtalk');
    expect(r.message.content).toBe('新增项目 督导2.0');
    expect(r.message.chatId).toBe('cid-1');
    expect(r.message.chatName).toBe('前端项目群');
    expect(r.message.chatType).toBe('group');
    expect(r.message.senderName).toBe('张三');
    // msgId 兼作幂等键
    expect(r.message.eventId).toBe('msg-1');
  });

  it('缺少 timestamp / sign 请求头 → 400', async () => {
    const r = await adapter.decode(makeReq(basePayload, { noHeaders: true }));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(400);
  });

  it('签名不匹配 → 403', async () => {
    const r = await adapter.decode(makeReq(basePayload, { sign: 'bad-sign' }));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });

  it('未配置 botSecret → 403，webhook 不裸奔', async () => {
    mockCreds.mockResolvedValue({ appKey: 'key' });
    const r = await adapter.decode(makeReq());
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });

  it('过期时间戳被拒（钉钉回调无 eventId 幂等，这是第一道防线）', async () => {
    const old = String(Date.now() - 2 * 60 * 60 * 1000);
    const r = await adapter.decode(makeReq(basePayload, { timestamp: old }));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.reason).toContain('时间戳');
  });

  it('验签在解析 body 之前 —— 非法 body 也不会先泄漏解析错误', async () => {
    // 签名错误时应直接 403，而不是先去解析 body 报 400
    const r = await adapter.decode(makeReq('not-json', { sign: 'bad' }));
    expect(r.kind === 'reject' && r.status).toBe(403);
  });

  it('验签通过但 body 非法 JSON → 400', async () => {
    const r = await adapter.decode(makeReq('not-json'));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(400);
  });
});

describe('DingtalkChannelAdapter.decode — 消息解析', () => {
  it('非文本消息 → ignored', async () => {
    const r = await adapter.decode(
      makeReq({ ...basePayload, msgtype: 'picture' }),
    );
    expect(r.kind).toBe('ignored');
  });

  it('缺少 msgId → ignored（没有幂等键不能进处理链）', async () => {
    const { msgId, ...rest } = basePayload;
    void msgId;
    const r = await adapter.decode(makeReq(rest));
    expect(r.kind).toBe('ignored');
    expect(r.kind === 'ignored' && r.reason).toContain('msgId');
  });

  it('优先用 senderStaffId 而非 senderId（后者换群会变，做 pending 键不稳定）', async () => {
    const r = await adapter.decode(makeReq());
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.senderId).toBe('zhangsan');
  });

  it('没有 senderStaffId 时回退到 senderId', async () => {
    const { senderStaffId, ...rest } = basePayload;
    void senderStaffId;
    const r = await adapter.decode(makeReq(rest));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.senderId).toBe('dingabc');
  });

  it('conversationType=1 → 单聊', async () => {
    const r = await adapter.decode(
      makeReq({ ...basePayload, conversationType: '1' }),
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatType).toBe('p2p');
  });

  it('单聊无 conversationId 时用发送者兜底，保证 pending 键稳定', async () => {
    const r = await adapter.decode(
      makeReq({
        ...basePayload,
        conversationType: '1',
        conversationId: undefined,
      }),
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatId).toBe('p2p:zhangsan');
  });

  it('剥掉正文里的 @昵称 前缀', async () => {
    const r = await adapter.decode(
      makeReq({
        ...basePayload,
        text: { content: '@项目助手 新增项目 督导2.0' },
      }),
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.content).toBe('新增项目 督导2.0');
  });

  it('配置了 robotCode 时也剥掉该前缀', async () => {
    mockCreds.mockResolvedValue({ botSecret: SECRET, robotCode: 'MyRobot' });
    const r = await adapter.decode(
      makeReq({ ...basePayload, text: { content: '@MyRobot 查询项目' } }),
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.content).toBe('查询项目');
  });

  it('只 @ 了机器人没写正文 → ignored，不把 "@昵称" 当业务消息', async () => {
    for (const content of ['@项目助手   ', '@项目助手', ' @项目助手 ']) {
      const r = await adapter.decode(
        makeReq({ ...basePayload, text: { content } }),
      );
      expect(r.kind, `content=${JSON.stringify(content)}`).toBe('ignored');
    }
  });

  it('不吃掉 "@张三的进度" 这种没空格的写法', async () => {
    // 剥前缀的正则要求 @ 后有空白，否则会把整段正文吞掉
    const r = await adapter.decode(
      makeReq({
        ...basePayload,
        text: { content: '@项目助手 @张三的进度如何' },
      }),
    );
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.content).toBe('@张三的进度如何');
  });

  it('缺少 sessionWebhook → ignored（处理完也发不出去，提前拒掉）', async () => {
    const { sessionWebhook, ...rest } = basePayload;
    void sessionWebhook;
    const r = await adapter.decode(makeReq(rest));
    expect(r.kind).toBe('ignored');
    expect(r.kind === 'ignored' && r.reason).toContain('sessionWebhook');
  });

  it('raw 里保留 sessionWebhook，reply 才拿得到', async () => {
    const r = await adapter.decode(makeReq());
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(readDingtalkReplyContext(r.message.raw)?.sessionWebhook).toBe(
      basePayload.sessionWebhook,
    );
  });
});

describe('readDingtalkReplyContext', () => {
  it('取出 sessionWebhook 与过期时间', () => {
    const ctx = readDingtalkReplyContext(basePayload);
    expect(ctx?.sessionWebhook).toBe(basePayload.sessionWebhook);
    expect(ctx?.sessionWebhookExpiredTime).toBe(
      basePayload.sessionWebhookExpiredTime,
    );
  });

  it('非 https 的 webhook 被拒（防止 raw 被污染后打到任意地址）', () => {
    expect(
      readDingtalkReplyContext({ sessionWebhook: 'http://evil.example.com' }),
    ).toBeNull();
  });

  it('缺失 / 非对象 / 空值一律返回 null', () => {
    expect(readDingtalkReplyContext(null)).toBeNull();
    expect(readDingtalkReplyContext('str')).toBeNull();
    expect(readDingtalkReplyContext({})).toBeNull();
    expect(readDingtalkReplyContext({ sessionWebhook: '' })).toBeNull();
  });
});

describe('DingtalkChannelAdapter.reply', () => {
  const msg = {
    platform: 'dingtalk' as const,
    eventId: 'e1',
    messageId: 'msg-1',
    chatId: 'cid-1',
    chatType: 'group' as const,
    senderId: 'zhangsan',
    senderName: '张三',
    content: 'hi',
    timestamp: Date.now(),
    raw: basePayload,
  };

  it('POST 到 sessionWebhook，body 是 text 消息', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await adapter.reply(msg, '✅ 已录入');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(basePayload.sessionWebhook);
    expect(JSON.parse(String(init.body))).toEqual({
      msgtype: 'text',
      text: { content: '✅ 已录入' },
    });
    vi.unstubAllGlobals();
  });

  it('sessionWebhook 已过期时不发请求（避免拿到笼统的失败原因）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await adapter.reply(
      {
        ...msg,
        raw: { ...basePayload, sessionWebhookExpiredTime: Date.now() - 1000 },
      },
      'x',
    );

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('raw 里没有 sessionWebhook 时不发请求且不抛错', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      adapter.reply({ ...msg, raw: {} }, 'x'),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('网络异常被吞掉，不让 dispatcher 崩', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(adapter.reply(msg, 'x')).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('DingtalkChannelAdapter.reply — 按平台字节上限截断', () => {
  const msg = {
    platform: 'dingtalk' as const,
    eventId: 'e1',
    messageId: 'msg-1',
    chatId: 'cid-1',
    chatType: 'group' as const,
    senderId: 'zhangsan',
    senderName: '张三',
    content: 'hi',
    timestamp: Date.now(),
    raw: basePayload,
  };

  it('超长文本按 UTF-8 字节截断后再发', async () => {
    // 回归：core 的 clampReply 是按字符的单一阈值(20000)，面向飞书；
    // 钉钉按字节计，20000 个汉字 = 60KB，整条会被平台拒收
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ errcode: 0 }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await adapter.reply(msg, '汉'.repeat(20_000));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = (
      JSON.parse(String(init.body)) as { text: { content: string } }
    ).text.content;
    expect(Buffer.byteLength(sent, 'utf8')).toBeLessThanOrEqual(
      adapter.maxReplyBytes,
    );
    expect(sent).toContain('已截断');
    vi.unstubAllGlobals();
  });
});

describe('DingtalkChannelAdapter.decode — robotCode 含正则元字符', () => {
  it('robotCode 里的 . * ( ) 被转义，不会当成模式解析', async () => {
    // 回归：robotCode 直接拼进 new RegExp()，含元字符时轻则剥错前缀重则抛异常
    mockCreds.mockResolvedValue({
      botSecret: SECRET,
      robotCode: 'ding.bot(v2)*',
    });
    const body = {
      ...basePayload,
      text: { content: '@ding.bot(v2)* 新增项目 督导2.0' },
    };
    const res = await adapter.decode(makeReq(body));

    expect(res.kind).toBe('ok');
    if (res.kind === 'ok') expect(res.message.content).toBe('新增项目 督导2.0');
  });
});
