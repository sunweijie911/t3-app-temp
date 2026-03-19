import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { env } from '@/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * 获取 AES-256 加密密钥（从环境变量派生 32 字节）。
 * 使用 SHA-256 对原始密钥做哈希，确保长度一致。
 */
function getEncryptionKey(): Buffer {
  const raw = env.ID_CARD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ID_CARD_ENCRYPTION_KEY 未配置，无法加密敏感数据');
  }
  return createHash('sha256').update(raw).digest();
}

/**
 * AES-256-GCM 加密。
 * 输出格式：base64(iv + authTag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // iv(12) + authTag(16) + ciphertext
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * AES-256-GCM 解密。
 */
export function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * 生成确定性哈希，用于加密字段的索引查找（如去重）。
 * 使用 HMAC-SHA256 防止彩虹表攻击。
 */
export function hashForLookup(value: string): string {
  const key = getEncryptionKey();
  return createHash('sha256').update(key).update(value).digest('hex');
}
