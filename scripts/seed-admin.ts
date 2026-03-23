/**
 * 初始管理员种子脚本
 *
 * 用法:
 *   npx tsx --env-file=.env scripts/seed-admin.ts <email> <password> [name]
 *
 * 示例:
 *   npx tsx --env-file=.env scripts/seed-admin.ts admin@example.com pass1234 Admin
 *
 * 注意: 需要 DATABASE_URL 环境变量（通过 --env-file=.env 加载）
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as authSchema from '@/server/db/auth-schema';

const args = process.argv.slice(2);
const email = args[0];
const password = args[1];
const name = args[2];

if (!email || !password) {
  console.error(
    '用法: npx tsx scripts/seed-admin.ts <email> <password> [name]',
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('错误: 缺少 DATABASE_URL 环境变量');
  process.exit(1);
}
if (!process.env.BETTER_AUTH_SECRET) {
  console.error('错误: 缺少 BETTER_AUTH_SECRET 环境变量');
  process.exit(1);
}

const conn = postgres(process.env.DATABASE_URL);
const db = drizzle(conn, { schema: authSchema });

const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
    },
  }),
});

async function main() {
  console.log(`正在创建管理员用户: ${email}`);

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: email as string,
        password: password as string,
        name: name ?? (email as string).split('@')[0]!,
      },
    });

    console.log('管理员用户创建成功:');
    console.log(`  ID:    ${result.user.id}`);
    console.log(`  Email: ${result.user.email}`);
    console.log(`  Name:  ${result.user.name}`);
    console.log(
      `\n请确保 .env 中 ADMIN_EMAILS 包含此邮箱: ADMIN_EMAILS=${email}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`创建失败: ${message}`);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
