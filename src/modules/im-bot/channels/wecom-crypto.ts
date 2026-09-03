import crypto from 'node:crypto';

/**
 * 企微回调的验签与加解密。
 *
 * 这层单独拆出来的原因：企微的密文格式有几个容易写错的细节
 * （AES key 由 base64(encodingAesKey + '=') 得到、iv 取 key 前 16 字节、
 * 明文前有 16 字节随机前缀 + 4 字节网络序长度、尾部还跟着 receiveid），
 * 任何一处错都只表现为「解出乱码」，很难定位。
 * 因此把加密方向也导出，让单测能做完整往返验证。
 */

/** encodingAesKey 固定 43 位 base64（解出 32 字节 AES-256 密钥） */
export const ENCODING_AES_KEY_LEN = 43;

export function aesKeyFromEncodingAesKey(encodingAesKey: string): Buffer {
  if (encodingAesKey.length !== ENCODING_AES_KEY_LEN) {
    throw new Error(
      `encodingAesKey 长度应为 ${ENCODING_AES_KEY_LEN}，实际 ${encodingAesKey.length}`,
    );
  }
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `encodingAesKey 解出的密钥应为 32 字节，实际 ${key.length}`,
    );
  }
  return key;
}

/**
 * 回调签名：sha1(排序后拼接的 [token, timestamp, nonce, encrypt])。
 * 四个值按字典序排序后直接拼成一个字符串再做 sha1 —— 注意是排序而非固定顺序。
 */
export function callbackSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const joined = [token, timestamp, nonce, encrypt].sort().join('');
  return crypto.createHash('sha1').update(joined).digest('hex');
}

/** 定时安全的签名比对，避免按字节提前返回泄漏信息 */
export function verifySignature(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1] ?? 0;
  // 企微用 32 字节块的 PKCS7 变体；越界值说明密文被破坏
  if (pad < 1 || pad > 32 || pad > buf.length) {
    throw new Error('PKCS7 填充非法，密文可能已损坏或 encodingAesKey 不匹配');
  }
  return buf.subarray(0, buf.length - pad);
}

function pkcs7Pad(buf: Buffer, blockSize = 32): Buffer {
  const padLen = blockSize - (buf.length % blockSize) || blockSize;
  return Buffer.concat([buf, Buffer.alloc(padLen, padLen)]);
}

export interface DecryptedMessage {
  /** 明文正文（企微智能机器人是 JSON，自建应用回调是 XML） */
  payload: string;
  /** 密文尾部携带的接收方标识：corpId 或 suiteId */
  receiveId: string;
}

/**
 * 解密企微回调密文。
 *
 * 明文结构：[16 字节随机][4 字节网络序 msgLen][msgLen 字节正文][receiveId]
 */
export function decryptMessage(
  encrypt: string,
  encodingAesKey: string,
): DecryptedMessage {
  const key = aesKeyFromEncodingAesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const cipherBuf = Buffer.from(encrypt, 'base64');
  if (cipherBuf.length === 0 || cipherBuf.length % 16 !== 0) {
    throw new Error('密文长度非法，不是 16 字节的整数倍');
  }

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false); // 企微用 32 字节块的 PKCS7，需自行去填充
  const padded = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  const plain = pkcs7Unpad(padded);

  if (plain.length < 20) {
    throw new Error('解密后长度不足，无法读出消息头');
  }
  const msgLen = plain.readUInt32BE(16);
  if (msgLen < 0 || 20 + msgLen > plain.length) {
    throw new Error(
      `解密后消息长度字段非法 (msgLen=${msgLen}, 可用=${plain.length - 20})`,
    );
  }
  return {
    payload: plain.subarray(20, 20 + msgLen).toString('utf8'),
    receiveId: plain.subarray(20 + msgLen).toString('utf8'),
  };
}

/**
 * 加密（仅用于单测往返验证，以及 URL 验证时企微要求回写密文的场景）。
 * @param randomPrefix 16 字节随机前缀，测试里可固定以获得确定输出
 */
export function encryptMessage(
  payload: string,
  encodingAesKey: string,
  receiveId: string,
  randomPrefix: Buffer = crypto.randomBytes(16),
): string {
  if (randomPrefix.length !== 16) {
    throw new Error('随机前缀必须是 16 字节');
  }
  const key = aesKeyFromEncodingAesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const msg = Buffer.from(payload, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);

  const plain = pkcs7Pad(
    Buffer.concat([randomPrefix, lenBuf, msg, Buffer.from(receiveId, 'utf8')]),
  );
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString(
    'base64',
  );
}

/**
 * 从企微回调的 XML 信封里取字段。
 *
 * 只取顶层标量字段，够用且不引 XML 解析依赖 —— 信封结构固定为
 * `<xml><ToUserName>..</ToUserName><Encrypt>..</Encrypt><AgentID>..</AgentID></xml>`，
 * 值可能被 CDATA 包裹。
 */
export function readXmlField(xml: string, tag: string): string | null {
  const m = xml.match(
    new RegExp(
      `<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`,
    ),
  );
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').trim() || null;
}
