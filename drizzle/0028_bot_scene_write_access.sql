CREATE TYPE "public"."bot_write_mode" AS ENUM('open', 'whitelist', 'readonly');--> statement-breakpoint
ALTER TABLE "pg-drizzle_bot_scene" RENAME COLUMN "allowedChatIds" TO "allowedChats";--> statement-breakpoint
ALTER TABLE "pg-drizzle_bot_scene" ADD COLUMN "writeMode" "bot_write_mode" DEFAULT 'open' NOT NULL;