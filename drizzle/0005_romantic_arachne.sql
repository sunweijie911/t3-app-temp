ALTER TABLE "user" DROP CONSTRAINT "user_email_unique";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "email_verified";