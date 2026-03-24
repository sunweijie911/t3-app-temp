CREATE TABLE "pg-drizzle_admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_email" text,
	"action" text NOT NULL,
	"input" jsonb,
	"result" text NOT NULL,
	"error_message" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "pg-drizzle_admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "pg-drizzle_admin_audit_log" USING btree ("action");