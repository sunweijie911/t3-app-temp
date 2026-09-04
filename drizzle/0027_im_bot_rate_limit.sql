CREATE TABLE "pg-drizzle_bot_rate_limit" (
	"limitKey" varchar(512) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bot_rate_limit_expires_at_idx" ON "pg-drizzle_bot_rate_limit" USING btree ("expiresAt");