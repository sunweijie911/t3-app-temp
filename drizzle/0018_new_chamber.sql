CREATE TYPE "public"."bot_event_result" AS ENUM('success', 'error', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."bot_platform" AS ENUM('feishu', 'dingtalk', 'wecom');--> statement-breakpoint
CREATE TABLE "pg-drizzle_bot_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" "bot_platform" NOT NULL,
	"eventId" varchar(128) NOT NULL,
	"chatId" varchar(128),
	"chatName" varchar(256),
	"senderId" varchar(128),
	"senderName" varchar(64),
	"content" text,
	"sceneId" varchar(64),
	"intent" varchar(16),
	"result" "bot_event_result" NOT NULL,
	"resultData" jsonb,
	"errorMsg" text,
	"costMs" integer,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_bot_platform" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"platform" "bot_platform" NOT NULL,
	"name" varchar(64) NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"isActive" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone,
	CONSTRAINT "pg-drizzle_bot_platform_platform_unique" UNIQUE("platform")
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_bot_scene" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"sceneId" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"keywords" text,
	"systemPrompt" text,
	"fieldSchema" jsonb,
	"replyTemplate" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone,
	CONSTRAINT "pg-drizzle_bot_scene_sceneId_unique" UNIQUE("sceneId")
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_bot_table_mapping" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"sceneId" varchar(64) NOT NULL,
	"platform" "bot_platform" NOT NULL,
	"workspaceId" varchar(256) NOT NULL,
	"tableId" varchar(256) NOT NULL,
	"fieldMapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "bot_event_log_created_at_idx" ON "pg-drizzle_bot_event_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "bot_event_log_event_id_idx" ON "pg-drizzle_bot_event_log" USING btree ("eventId");--> statement-breakpoint
CREATE INDEX "bot_event_log_scene_id_idx" ON "pg-drizzle_bot_event_log" USING btree ("sceneId");--> statement-breakpoint
CREATE INDEX "bot_event_log_platform_idx" ON "pg-drizzle_bot_event_log" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "bot_scene_scene_id_idx" ON "pg-drizzle_bot_scene" USING btree ("sceneId");--> statement-breakpoint
CREATE INDEX "bot_scene_is_active_idx" ON "pg-drizzle_bot_scene" USING btree ("isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "bot_table_mapping_scene_platform_idx" ON "pg-drizzle_bot_table_mapping" USING btree ("sceneId","platform");