CREATE TABLE "pg-drizzle_bot_event_dedup" (
	"dedupKey" varchar(256) PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_bot_pending_action" (
	"pendingKey" varchar(512) PRIMARY KEY NOT NULL,
	"sceneId" varchar(64) NOT NULL,
	"bindingAlias" varchar(64) NOT NULL,
	"type" varchar(32) NOT NULL,
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" jsonb NOT NULL,
	"updateFields" jsonb,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_event_dedup_expires_at_idx" ON "pg-drizzle_bot_event_dedup" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "bot_pending_action_expires_at_idx" ON "pg-drizzle_bot_pending_action" USING btree ("expiresAt");
