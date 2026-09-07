import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/modules/im-bot/services/credentials', () => ({
  getFeishuCredentials: vi.fn(),
}));
vi.mock('@/modules/im-bot/auth/feishu-user', () => ({
  getFeishuUserName: vi.fn(),
}));
vi.mock('@/modules/im-bot/auth/feishu-chat', () => ({
  getFeishuChatName: vi.fn(),
  resetFeishuChatNameCache: vi.fn(),
}));
// 不 mock 的话 decode 会真的去打 /bot/v3/info（凭证是 mock 的，但 fetch 是真的）
vi.mock('@/modules/im-bot/auth/feishu-bot', () => ({
  getFeishuBotOpenId: vi.fn(),
  resetFeishuBotOpenIdCache: vi.fn(),
}));

import { getFeishuBotOpenId } from '@/modules/im-bot/auth/feishu-bot';
import { getFeishuChatName } from '@/modules/im-bot/auth/feishu-chat';
import { getFeishuUserName } from '@/modules/im-bot/auth/feishu-user';
import { FeishuChannelAdapter } from '@/modules/im-bot/channels/feishu';
import {
  encryptFeishuEvent,
  eventSignature,
} from '@/modules/im-bot/channels/feishu-crypto';
import { REPLAY_TOLERANCE_MS } from '@/modules/im-bot/channels/replay-window';
import { getFeishuCredentials } from '@/modules/im-bot/services/credentials';

const mockCreds = vi.mocked(getFeishuCredentials);
const mockUserName = vi.mocked(getFeishuUserName);
const mockChatName = vi.mocked(getFeishuChatName);
const mockBotOpenId = vi.mocked(getFeishuBotOpenId);

const adapter = new FeishuChannelAdapter();

function makeReq(body: unknown): Request {
  return new Request('https://example.com/api/bot/feishu/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeEvent(opts: {
  chatType?: string;
  mentions?: unknown[];
  text?: string;
  senderType?: string;
  messageType?: string;
  /** 事件产生时刻（毫秒字符串）。缺省取"现在"—— 见重放窗口那组用例 */
  createTime?: string;
}) {
  return {
    header: {
      event_id: 'ev-1',
      event_type: 'im.message.receive_v1',
      token: 'good-token',
      // 不能写死一个历史时刻：decode 现在会校验事件新鲜度，
      // 固定值会随时间推移把**所有**用例变成"重放被拒"
      create_time: opts.createTime ?? String(Date.now()),
    },
    event: {
      sender: {
        sender_type: opts.senderType ?? 'user',
        sender_id: { open_id: 'ou_abc' },
      },
      message: {
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: opts.chatType ?? 'group',
        message_type: opts.messageType ?? 'text',
        content: JSON.stringify({ text: opts.text ?? '@_user_1 新增项目 A' }),
        mentions: opts.mentions ?? [{ key: '@_user_1' }],
      },
    },
  };
}

beforeEach(() => {
  mockCreds.mockReset();
  mockUserName.mockReset();
  mockChatName.mockReset();
  mockBotOpenId.mockReset();
  // 默认拿不到自身 open_id → fail-open，与加这层判定之前的行为一致
  mockBotOpenId.mockResolvedValue(null);
  mockCreds.mockResolvedValue({
    appId: 'a',
    appSecret: 'b',
    verificationToken: 'good-token',
  });
  mockUserName.mockResolvedValue('张三');
  mockChatName.mockResolvedValue('前端项目群');
});

describe('FeishuChannelAdapter.decode — 验签与 challenge', () => {
  it('非法 JSON body → reject 400（不再由调用方预解析）', async () => {
    const req = new Request('https://example.com/x', {
      method: 'POST',
      body: 'not-json',
    });
    const r = await adapter.decode(req);
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(400);
  });

  it('URL challenge → respond，原样回写 challenge', async () => {
    const r = await adapter.decode(
      makeReq({ challenge: 'c123', type: 'url_verification' }),
    );
    expect(r.kind).toBe('respond');
    if (r.kind !== 'respond') throw new Error('expected respond');
    await expect(r.response.json()).resolves.toEqual({ challenge: 'c123' });
  });

  it('未配置 verificationToken 时拒绝，不让 webhook 裸奔', async () => {
    mockCreds.mockResolvedValue({ appId: 'a', appSecret: 'b' });
    const r = await adapter.decode(makeReq(makeEvent({})));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });

  it('token 不匹配 → 403', async () => {
    const body = makeEvent({});
    body.header.token = 'wrong';
    const r = await adapter.decode(makeReq(body));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
  });
});

describe('FeishuChannelAdapter.decode — 消息解析', () => {
  it('群聊 @机器人 → ok，剥离 @ 占位符；名称由 enrich 补齐', async () => {
    const r = await adapter.decode(makeReq(makeEvent({})));
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.content).toBe('新增项目 A');
    expect(r.message.chatType).toBe('group');
    expect(r.message.eventId).toBe('ev-1');
    // decode 阶段还没查名字，senderName 先用 senderId 占位
    expect(r.message.senderName).toBe('ou_abc');
    expect(r.message.chatName).toBeUndefined();

    const enriched = await adapter.enrich(r.message);
    expect(enriched?.senderName).toBe('张三');
    expect(enriched?.chatName).toBe('前端项目群');
  });

  it('★ decode 阶段零网络调用 —— 它跑在 3 秒 ack 之前', async () => {
    // 回归：三个查询各 3s 超时、冷启动还要先换 token（10s 超时），
    // 留在 decode 里会让首条消息几乎必然触发飞书重试
    const r = await adapter.decode(makeReq(makeEvent({})));
    expect(r.kind).toBe('ok');
    expect(mockBotOpenId).not.toHaveBeenCalled();
    expect(mockUserName).not.toHaveBeenCalled();
    expect(mockChatName).not.toHaveBeenCalled();
  });

  it('单聊免 @：以前无条件要求 mentions，导致所有私聊被丢弃', async () => {
    const r = await adapter.decode(
      makeReq(
        makeEvent({ chatType: 'p2p', mentions: [], text: '查一下项目 A' }),
      ),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatType).toBe('p2p');
    expect(r.message.content).toBe('查一下项目 A');
    // 单聊不查群名、也不查机器人自身 open_id（没有 @ 判定）
    await adapter.enrich(r.message);
    expect(mockChatName).not.toHaveBeenCalled();
    expect(mockBotOpenId).not.toHaveBeenCalled();
  });

  it('群聊未 @机器人 → ignored', async () => {
    const r = await adapter.decode(makeReq(makeEvent({ mentions: [] })));
    expect(r.kind).toBe('ignored');
  });

  it('保留平台原始事件体到 raw（钉钉/企微 reply 依赖此字段）', async () => {
    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.raw).toMatchObject({
      header: { event_id: 'ev-1' },
    });
  });

  it('机器人自己发的消息被忽略，避免回环', async () => {
    const r = await adapter.decode(makeReq(makeEvent({ senderType: 'app' })));
    expect(r.kind).toBe('ignored');
  });

  it('非文本消息 → ignored', async () => {
    const r = await adapter.decode(
      makeReq(makeEvent({ messageType: 'image' })),
    );
    expect(r.kind).toBe('ignored');
  });

  it('非目标事件类型 → ignored', async () => {
    const body = makeEvent({});
    body.header.event_type = 'im.chat.updated_v1';
    const r = await adapter.decode(makeReq(body));
    expect(r.kind).toBe('ignored');
  });

  it('@ 之后内容为空 → ignored，不浪费 LLM token', async () => {
    const r = await adapter.decode(makeReq(makeEvent({ text: '@_user_1  ' })));
    expect(r.kind).toBe('ignored');
  });

  it('用户名查询失败时回退到 open_id，不阻塞处理', async () => {
    mockUserName.mockResolvedValue(null);
    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.senderName).toBe('ou_abc');
  });

  it('群名查询失败时 chatName 为 undefined，不阻塞处理', async () => {
    mockChatName.mockResolvedValue(null);
    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.message.chatName).toBeUndefined();
  });
});

describe('群聊 @ 判定：被 @ 的必须是机器人自己（P2）', () => {
  const botOpenId = 'ou_bot';

  it('@ 的是机器人 → 正常处理', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [{ key: '@_user_1', id: { open_id: botOpenId } }],
        }),
      ),
    );

    expect(r.kind).toBe('ok');
  });

  it('@ 的是别人 → 忽略（开通"接收群里所有消息"后才会遇到）', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [{ key: '@_user_1', id: { open_id: 'ou_someone' } }],
          text: '@_user_1 帮我看下这个',
        }),
      ),
    );

    // decode 只看载荷（有 mentions 就先放过），需要网络的 @ 判定在 enrich
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(await adapter.enrich(r.message)).toBeNull();
  });

  it('同时 @ 了机器人和别人 → 仍然处理', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [
            { key: '@_user_1', id: { open_id: 'ou_someone' } },
            { key: '@_user_2', id: { open_id: botOpenId } },
          ],
        }),
      ),
    );

    expect(r.kind).toBe('ok');
  });

  it('拿不到自身 open_id → fail-open，不因此把群消息全丢掉', async () => {
    mockBotOpenId.mockResolvedValue(null);

    const r = await adapter.decode(
      makeReq(
        makeEvent({
          mentions: [{ key: '@_user_1', id: { open_id: 'ou_someone' } }],
        }),
      ),
    );

    expect(r.kind).toBe('ok');
  });

  it('单聊不做这层判定（本来就没有 mentions）', async () => {
    mockBotOpenId.mockResolvedValue(botOpenId);

    const r = await adapter.decode(
      makeReq(
        makeEvent({ chatType: 'p2p', mentions: [], text: '查一下项目 A' }),
      ),
    );

    expect(r.kind).toBe('ok');
  });
});

describe('ack 前的查询并发发出，不叠加超时（P2）', () => {
  it('单聊不查机器人自身 open_id', async () => {
    mockBotOpenId.mockResolvedValue('ou_bot');

    const r = await adapter.decode(
      makeReq(
        makeEvent({ chatType: 'p2p', mentions: [], text: '查一下项目 A' }),
      ),
    );

    expect(r.kind).toBe('ok');
    expect(mockBotOpenId).not.toHaveBeenCalled();
  });

  it('群聊里三个查询并发发出（互不等待）', async () => {
    const order: string[] = [];
    const gate = (tag: string, ms: number) => async () => {
      order.push(`${tag}:start`);
      await new Promise((res) => setTimeout(res, ms));
      order.push(`${tag}:end`);
      return tag;
    };
    mockBotOpenId.mockImplementation(gate('bot', 20));
    mockUserName.mockImplementation(gate('user', 10));
    mockChatName.mockImplementation(gate('chat', 10));

    const r = await adapter.decode(makeReq(makeEvent({})));
    if (r.kind !== 'ok') throw new Error('expected ok');
    await adapter.enrich(r.message);

    // 串行的话 order 会是 start/end 交替；并发时三个 start 先挤在一起
    expect(order.slice(0, 3)).toEqual([
      'bot:start',
      'user:start',
      'chat:start',
    ]);
  });
});

describe('FeishuChannelAdapter.decode — 重放窗口（无签名头）', () => {
  it('★ 陈旧事件不被处理 —— 抓到的回调不能过了幂等 TTL 就无限重放', async () => {
    // 回归：飞书曾是三家里唯一既不验签、也不查时间戳的。
    // verification_token 是个静态密钥，body 原样重放照样通过，
    // 于是幂等 TTL(5min) 一过，一条 CREATE 重放一次就多写一条记录。
    const stale = String(Date.now() - REPLAY_TOLERANCE_MS - 1000);
    const r = await adapter.decode(makeReq(makeEvent({ createTime: stale })));
    expect(r.kind).toBe('ignored');
  });

  it('★ 陈旧事件回 ignored(200) 而不是 403 —— 403 会把事件订阅搞没', async () => {
    // 飞书把非 2xx 当投递失败会不断重试，连续失败还会**自动摘掉事件订阅**
    // （bot-engine 里"停用平台也回 200"就是为了这个）。而"太旧了"是重试
    // 永远修不好的一类失败：服务器时钟漂移超过窗口时每条事件都会 403，
    // 正好凑成"连续失败"，代价从"丢几条消息"升级成"订阅没了要人工重配"。
    // 安全性不受影响 —— 两种答复下这条事件都不会被处理。
    const stale = String(Date.now() - REPLAY_TOLERANCE_MS - 1000);
    const r = await adapter.decode(makeReq(makeEvent({ createTime: stale })));
    expect(r.kind).not.toBe('reject');
  });

  it('陈旧事件必须留日志 —— ignored 不落审计日志，不打就查无可查', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stale = String(Date.now() - REPLAY_TOLERANCE_MS - 1000);
    await adapter.decode(makeReq(makeEvent({ createTime: stale })));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('窗口内的事件正常处理', async () => {
    const fresh = String(Date.now() - 60 * 1000);
    const r = await adapter.decode(makeReq(makeEvent({ createTime: fresh })));
    expect(r.kind).toBe('ok');
  });

  it('未来时刻超窗同样不处理（时钟跑飞的伪造请求）', async () => {
    const future = String(Date.now() + REPLAY_TOLERANCE_MS + 1000);
    const r = await adapter.decode(makeReq(makeEvent({ createTime: future })));
    expect(r.kind).toBe('ignored');
  });

  it('★ create_time 缺失或形状变了 → 放行，不能因此让整个平台失联', async () => {
    // 这个字段不是协议要求我们校验的东西。fail-closed 的话，飞书哪天
    // 把它改成 ISO 串，现象就是"机器人一条消息都不回"且无从查起。
    for (const createTime of ['', 'not-a-number', '2026-09-06T10:00:00Z']) {
      const r = await adapter.decode(makeReq(makeEvent({ createTime })));
      expect(r.kind, `createTime=${createTime}`).toBe('ok');
    }
    const noHeaderTime = makeEvent({});
    delete (noHeaderTime.header as { create_time?: string }).create_time;
    expect((await adapter.decode(makeReq(noHeaderTime))).kind).toBe('ok');
  });
});

describe('FeishuChannelAdapter.decode — X-Lark-Signature 验签', () => {
  const ENCRYPT_KEY = 'test-encrypt-key';

  beforeEach(() => {
    mockCreds.mockResolvedValue({
      appId: 'a',
      appSecret: 'b',
      encryptKey: ENCRYPT_KEY,
      verificationToken: 'good-token',
    });
  });

  /** 按飞书协议签一个请求：sha256(timestamp + nonce + encryptKey + body原文) */
  function makeSignedReq(
    rawBody: string,
    opts: {
      timestamp?: string;
      nonce?: string;
      signature?: string;
      encryptKey?: string;
    } = {},
  ): Request {
    // 飞书这个头是**秒**
    const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = opts.nonce ?? 'nonce-1';
    const signature =
      opts.signature ??
      eventSignature(timestamp, nonce, opts.encryptKey ?? ENCRYPT_KEY, rawBody);
    return new Request('https://example.com/api/bot/feishu/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lark-Request-Timestamp': timestamp,
        'X-Lark-Request-Nonce': nonce,
        'X-Lark-Signature': signature,
      },
      body: rawBody,
    });
  }

  it('签名正确 → 正常处理', async () => {
    const raw = JSON.stringify(makeEvent({}));
    const r = await adapter.decode(makeSignedReq(raw));
    expect(r.kind).toBe('ok');
  });

  it('★ 签名错误 → reject 403', async () => {
    const raw = JSON.stringify(makeEvent({}));
    const r = await adapter.decode(
      makeSignedReq(raw, { signature: 'a'.repeat(64) }),
    );
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.status).toBe(403);
    expect(r.kind === 'reject' && r.reason).toContain('验签失败');
  });

  it('★ body 被改过一个字节就通不过 —— 签名覆盖的是请求体本身', async () => {
    const raw = JSON.stringify(makeEvent({ text: '@_user_1 新增项目 A' }));
    const signature = eventSignature(
      String(Math.floor(Date.now() / 1000)),
      'nonce-1',
      ENCRYPT_KEY,
      raw,
    );
    // 拿着为原文算出的签名，去发一个被篡改过的 body
    const tampered = raw.replace('新增项目 A', '删除项目 A');
    const r = await adapter.decode(makeSignedReq(tampered, { signature }));
    expect(r.kind).toBe('reject');
  });

  it('★ 验签用的是请求体原文，不是 parse 再 stringify 的结果', async () => {
    // 回归：实现里一旦写成 `JSON.stringify(await req.json())`，
    // 键序 / 空白 / Unicode 转义任何一处不同都会让签名恒不通过，
    // 而表现是「所有事件都被拒收」，不是报错。
    const ev = makeEvent({});
    const raw = `{\n  "event": ${JSON.stringify(ev.event)},\n  "header": ${JSON.stringify(ev.header)}\n}`;
    expect(raw).not.toBe(JSON.stringify(JSON.parse(raw)));
    const r = await adapter.decode(makeSignedReq(raw));
    expect(r.kind).toBe('ok');
  });

  it('★ 签名时间戳超窗 → 不处理（这个头是秒，别当成毫秒）', async () => {
    const raw = JSON.stringify(makeEvent({}));
    const staleSec = String(
      Math.floor((Date.now() - REPLAY_TOLERANCE_MS - 5000) / 1000),
    );
    const r = await adapter.decode(makeSignedReq(raw, { timestamp: staleSec }));
    // 同样走 ignored(200)：陈旧不是平台能靠重试修好的事，
    // 而连续 403 会让飞书摘掉订阅
    expect(r.kind).toBe('ignored');
    expect(r.kind === 'ignored' && r.reason).toContain('时间戳');
  });

  it('带签名头却没配 encryptKey → reject，不能假装验过', async () => {
    mockCreds.mockResolvedValue({
      appId: 'a',
      appSecret: 'b',
      verificationToken: 'good-token',
    });
    const raw = JSON.stringify(makeEvent({}));
    const r = await adapter.decode(makeSignedReq(raw));
    expect(r.kind).toBe('reject');
    expect(r.kind === 'reject' && r.reason).toContain('encryptKey');
  });

  it('★ 验过签之后不再拿 create_time 二次判窗 —— 两个时钟不该各拒一次', async () => {
    // 签名头的时间戳是新鲜的，事件体里的 create_time 是旧的：
    // 已经有一道基于签名时钟的窗口了，再用另一个字段拒一次只会平白
    // 多一种"莫名其妙收不到消息"的原因。
    const stale = String(Date.now() - REPLAY_TOLERANCE_MS - 60_000);
    const raw = JSON.stringify(makeEvent({ createTime: stale }));
    const r = await adapter.decode(makeSignedReq(raw));
    expect(r.kind).toBe('ok');
  });

  it('加密事件：签名覆盖的是密文原文，验签在解密之前', async () => {
    const plain = JSON.stringify(makeEvent({}));
    const encrypted = encryptFeishuEvent(plain, ENCRYPT_KEY);
    const raw = JSON.stringify({ encrypt: encrypted });
    const r = await adapter.decode(makeSignedReq(raw));
    expect(r.kind).toBe('ok');
    expect(r.kind === 'ok' && r.message.content).toBe('新增项目 A');
  });

  it('★ 配了 encryptKey 却少发一个头 → 拒绝，不能落回只查 token 的老路', async () => {
    // 回归：这道闸原先的判据是"请求带没带签名头"，而那由**攻击者**说了算
    // —— 少发一个 X-Lark-Request-Nonce 就整个绕过验签，落回只有静态
    // verification_token 的旧路径，验签等于白加。
    // 判据必须是"本地配了 encryptKey"（飞书配了 Encrypt Key 就必带三个头）。
    const raw = JSON.stringify(makeEvent({}));
    for (const headers of [
      { 'X-Lark-Signature': 'whatever' },
      {
        'X-Lark-Signature': 'whatever',
        'X-Lark-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
      },
      {} as Record<string, string>,
    ]) {
      const req = new Request('https://example.com/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: raw,
      });
      const r = await adapter.decode(req);
      expect(r.kind, JSON.stringify(headers)).toBe('reject');
      expect(r.kind === 'reject' && r.status).toBe(403);
    }
  });

  it('★ 但 URL 有效性验证不受这道闸影响 —— 否则管理员配不上回调地址', async () => {
    // challenge 只是把值原样回写，没有任何数据访问和副作用
    const raw = JSON.stringify({ challenge: 'ch-1', type: 'url_verification' });
    const req = new Request('https://example.com/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
    const r = await adapter.decode(req);
    expect(r.kind).toBe('respond');
  });

  it('没配 encryptKey 的存量部署照旧放行（未开加密时飞书不发这些头）', async () => {
    mockCreds.mockResolvedValue({
      appId: 'a',
      appSecret: 'b',
      verificationToken: 'good-token',
    });
    const req = new Request('https://example.com/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeEvent({})),
    });
    expect((await adapter.decode(req)).kind).toBe('ok');
  });
});
