-- bot_platform.is_active 此前只有后台在写、运行时无人读，所以已配好的平台
-- 绝大多数停在默认值 false 上却一直在正常收消息。这次让 webhook 真正消费
-- 这一列，必须先把「填过凭证 = 在用」的存量行补成启用，否则升级瞬间三个
-- 平台会一起失联。
UPDATE "pg-drizzle_bot_platform"
SET "isActive" = true
WHERE "isActive" = false
  AND "credentials" IS NOT NULL
  AND "credentials"::text NOT IN ('{}', 'null');
