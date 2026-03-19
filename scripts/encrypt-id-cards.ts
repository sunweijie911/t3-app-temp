/**
 * 数据迁移脚本：将已有的明文身份证号加密，并回填 idCardHash。
 *
 * 用法：pnpm db:encrypt-id-cards
 *
 * 运行前提：
 * 1. 已执行 migration 0013（新增 idCardHash 列）
 * 2. 已配置 ID_CARD_ENCRYPTION_KEY 环境变量
 *
 * 运行后需执行：
 * ALTER TABLE "pg-drizzle_info_collect_record" ALTER COLUMN "idCardHash" SET NOT NULL;
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { infoCollectRecords } from '../src/modules/info-collect/schema/index';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL 未配置');
  process.exit(1);
}

const ENCRYPTION_KEY = process.env.ID_CARD_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  console.error('ID_CARD_ENCRYPTION_KEY 未配置');
  process.exit(1);
}

const key = createHash('sha256').update(ENCRYPTION_KEY).digest();

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function hashForLookup(value: string): string {
  return createHash('sha256').update(key).update(value).digest('hex');
}

// 简单判断是否已加密（base64 编码的加密数据长度 > 40，而身份证号只有 18 位）
function isAlreadyEncrypted(value: string): boolean {
  return value.length > 30;
}

async function main() {
  const client = postgres(DATABASE_URL!);
  const db = drizzle(client);

  // 获取所有 idCardHash 为空的记录（即未迁移的）
  const records = await db
    .select({ id: infoCollectRecords.id, idCard: infoCollectRecords.idCard })
    .from(infoCollectRecords)
    .where(isNull(infoCollectRecords.idCardHash));

  console.log(`找到 ${records.length} 条需要迁移的记录`);

  let migrated = 0;
  for (const record of records) {
    // idCardHash 为空的记录一定是明文数据（加密前写入的）
    const encryptedIdCard = isAlreadyEncrypted(record.idCard)
      ? record.idCard
      : encrypt(record.idCard);

    const idCardHash = isAlreadyEncrypted(record.idCard)
      ? createHash('sha256').update(key).update('unknown').digest('hex')
      : hashForLookup(record.idCard);

    await db
      .update(infoCollectRecords)
      .set({ idCard: encryptedIdCard, idCardHash })
      .where(eq(infoCollectRecords.id, record.id));

    migrated++;
  }

  console.log(`成功迁移 ${migrated} 条记录`);
  console.log('请执行以下 SQL 添加 NOT NULL 约束：');
  console.log(
    'ALTER TABLE "pg-drizzle_info_collect_record" ALTER COLUMN "idCardHash" SET NOT NULL;',
  );

  await client.end();
}

main().catch((err) => {
  console.error('迁移失败：', err);
  process.exit(1);
});
