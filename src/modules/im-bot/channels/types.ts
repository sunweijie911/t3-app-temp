import type { BotPlatform } from '../constants';
import type { UnifiedMessage } from '../core/types';

/**
 * decode 的四种结局。
 *
 * 取代原来的 `verify(req, body) + parse(body)` 两段式：那套设计要求调用方
 * 先把请求体解析成 JSON 再交给 adapter，而
 * - 企微自建应用回调是 **XML + AES 加密**，`req.json()` 直接失败 → 整个平台无法接入
 * - 企微 URL 验证是 **GET + echostr**，两段式里没有能返回自定义 Response 的位置
 * 所以解码/验签/解密统一下沉到各平台 adapter 自己完成。
 */
export type DecodeResult =
  /** 解析出一条需要处理的业务消息 */
  | { kind: 'ok'; message: UnifiedMessage }
  /** 请求合法但无需处理（非文本消息、群里没 @ 机器人、机器人自己发的消息等） */
  | { kind: 'ignored'; reason?: string }
  /** 平台要求原样回写的响应（飞书 challenge、企微 echostr） */
  | { kind: 'respond'; response: Response }
  /** 验签/解密失败，按 status 拒绝 */
  | { kind: 'reject'; status: number; reason?: string };

export interface ChannelAdapter {
  readonly platform: BotPlatform;

  /**
   * 单条文本消息的 **UTF-8 字节** 上限，由各平台文档给出，取保守值。
   *
   * 必须按平台分别声明：core 侧的 clampReply 是按字符算的单一阈值（面向飞书），
   * 而企微的上限比飞书小一个量级、平台又都按字节计——一个汉字 3 字节。
   * 超限时平台只回业务错误码，用户一条回复都收不到。
   */
  readonly maxReplyBytes: number;

  /**
   * 处理平台的 URL 有效性验证请求（GET）。企微需要；飞书/钉钉走 POST challenge。
   * 返回 null 表示该平台不使用 GET 验证。
   */
  verifyUrl?(req: Request): Promise<Response | null>;

  /**
   * 自行读取并解码请求（JSON / XML / form-urlencoded），完成验签与解密。
   * 实现方需要把平台原始事件体放进 `message.raw`，否则 reply 时拿不到
   * 钉钉 sessionWebhook / 企微 AgentID 这类平台专属上下文。
   */
  decode(req: Request): Promise<DecodeResult>;

  reply(msg: UnifiedMessage, content: string): Promise<void>;
}
