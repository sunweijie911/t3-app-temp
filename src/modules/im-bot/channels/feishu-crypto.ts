import crypto from 'node:crypto';

/**
 * 飞书事件回调的加解密与验签。
 *
 * 单独拆出来的原因与另外两家一致（dingtalk-crypto.ts / wecom-crypto.ts）：
 * 这层是纯函数、能被单测完整往返验证，而写错时的表现只有「解出乱码」或
 * 「签名恒不通过」，很难定位。三家现在都有对位的 crypto 模块。
 *
 * 飞书这套与另外两家的差异：
 * 1. AES key 是 **sha256(encryptKey)**，不是 base64 解码
 * 2. iv 藏在密文**前 16 字节**里，不是从 key 派生
 * 3. 签名是 sha256 的 **hex**，被签内容是
 *    `timestamp + nonce + encryptKey + body原文`（无分隔符、不排序）
 *    —— 与企微的「四元素排序后 sha1」完全不同
 */

/**
 * 解密飞书事件。明文结构：[16 字节 iv][AES-256-CBC 密文]。
 * @param key 后台配置的 Encrypt Key（原文，函数内部会做 sha256）
 */
export function decryptFeishuEvent(encrypt: string, key: string): string {
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const buf = Buffer.from(encrypt, 'base64');
  const iv = buf.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', keyHash, iv);
  let decrypted = decipher.update(buf.subarray(16));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf-8');
}

/**
 * 加密（仅用于单测往返验证）。
 * @param iv 16 字节 iv，测试里可固定以获得确定输出
 */
export function encryptFeishuEvent(
  payload: string,
  key: string,
  iv: Buffer = crypto.randomBytes(16),
): string {
  if (iv.length !== 16) throw new Error('iv 必须是 16 字节');
  const keyHash = crypto.createHash('sha256').update(key).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(payload, 'utf8')),
    cipher.final(),
  ]);
  return Buffer.concat([iv, body]).toString('base64');
}

/**
 * 事件回调签名：`sha256(timestamp + nonce + encryptKey + body)` 的 hex。
 *
 * `body` 必须是**请求体原文**，不能是 `JSON.parse` 再 `JSON.stringify`
 * 回去的结果 —— 键序、空白、Unicode 转义任何一处不同都会让签名恒不通过，
 * 而表现是「所有事件都被拒收」，不是报错。
 */
export function eventSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  body: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`${timestamp}${nonce}${encryptKey}${body}`)
    .digest('hex');
}

/** 定时安全的签名比对，避免按字节提前返回泄漏信息 */
export function verifyEventSignature(
  expected: string,
  actual: string,
): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
