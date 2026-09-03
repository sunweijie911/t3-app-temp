import type { UnifiedMessage } from '../core/types';
import type { ChannelAdapter, DecodeResult } from './types';

/**
 * 企微 Channel Adapter — 尚未实现。
 *
 * 之所以单独说明：企微的回调协议与飞书差异最大，以前的
 * `verify(req, body) + parse(body)` 两段式**结构上就跑不通**——
 * 调用方先做 `req.json()`，而企微回调是 XML，第一步就 400。
 * 现在 decode(req) 拿到的是原始 Request，可以自己读 text() 再解 XML。
 *
 * 实现时需要：
 * 1. **URL 验证（GET）**：query 带 `msg_signature/timestamp/nonce/echostr`，
 *    校验签名后把 echostr 解密，**原样返回明文**（走 `verifyUrl`）。
 * 2. **消息回调（POST）**：body 是 XML，形如
 *    `<xml><ToUserName>..</ToUserName><Encrypt>..</Encrypt></xml>`；
 *    取 Encrypt 字段用 encodingAesKey 做 AES-256-CBC 解密，
 *    去掉 16 字节随机前缀 + 4 字节网络序长度后才是明文 XML。
 * 3. **签名**：sha1(sort(token, timestamp, nonce, encrypt).join('')).
 * 4. **回复**：企微自建应用用 `message/send` 主动发（需要 corpId + secret 换
 *    access_token），回复目标从明文 XML 的 `FromUserName`/`ChatId` 取，
 *    所以 decode 要把明文 XML 存进 `UnifiedMessage.raw`。
 * 5. 表格侧对应「智能表格 smartsheet」，概念与飞书 bitable 基本可对齐。
 */
export class WecomChannelAdapter implements ChannelAdapter {
  readonly platform = 'wecom' as const;

  async verifyUrl(): Promise<Response | null> {
    return new Response('企微 Channel Adapter 尚未实现', { status: 501 });
  }

  async decode(): Promise<DecodeResult> {
    return {
      kind: 'reject',
      status: 501,
      reason: '企微 Channel Adapter 尚未实现',
    };
  }

  async reply(_msg: UnifiedMessage, _content: string): Promise<void> {
    throw new Error('企微适配器尚未实现');
  }
}
