-- 本次改动：活动和奖品的 isActive 默认值从 true 改为 false
ALTER TABLE "pg-drizzle_wheel_activity" ALTER COLUMN "isActive" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_prize" ALTER COLUMN "isActive" SET DEFAULT false;--> statement-breakpoint

-- 以下为历史快照漂移修复（已在数据库中生效，加 IF 保护确保幂等）
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "pg-drizzle_wheel_activity" DROP COLUMN IF EXISTS "maxDrawsPerDay";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_email_unique'
  ) THEN
    ALTER TABLE "user" ADD CONSTRAINT "user_email_unique" UNIQUE("email");
  END IF;
END $$;
