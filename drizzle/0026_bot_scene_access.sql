-- 场景作用域：以前没有任何权限概念，机器人被拉进第二个群，
-- 那个群立刻能对绑定的表做全量 CRUD。两列都用空数组表示不限制，
-- 保证历史场景行为不变。
ALTER TABLE "pg-drizzle_bot_scene" ADD COLUMN "allowedChatIds" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pg-drizzle_bot_scene" ADD COLUMN "writerIds" jsonb DEFAULT '[]'::jsonb NOT NULL;