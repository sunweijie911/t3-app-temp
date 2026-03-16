CREATE TABLE "pg-drizzle_info_collect_record" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(50) NOT NULL,
	"phone" varchar(20) NOT NULL,
	"idCard" varchar(18) NOT NULL,
	"proofImageUrl" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"rejectReason" text,
	"trackingNumber" varchar(100),
	"shippedAt" timestamp with time zone,
	"remark" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "info_collect_phone_idx" ON "pg-drizzle_info_collect_record" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "info_collect_status_idx" ON "pg-drizzle_info_collect_record" USING btree ("status");--> statement-breakpoint
CREATE INDEX "info_collect_id_card_idx" ON "pg-drizzle_info_collect_record" USING btree ("idCard");