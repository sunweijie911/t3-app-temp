CREATE TYPE "public"."attempt_status" AS ENUM('in_progress', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."question_source" AS ENUM('preset', 'ai_generated');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('pending', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scoring_strategy" AS ENUM('dimension', 'category', 'scale', 'composite');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_ai_report" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"resultId" varchar(36) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"status" "report_status" DEFAULT 'pending' NOT NULL,
	"content" text,
	"modelUsed" varchar(128),
	"promptTokens" integer,
	"completionTokens" integer,
	"generationTimeMs" integer,
	"errorMessage" text,
	"createdAt" timestamp with time zone NOT NULL,
	"completedAt" timestamp with time zone,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_order" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"resultId" varchar(36) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'CNY' NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"paymentMethod" varchar(64),
	"paymentId" varchar(256),
	"paidAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_question" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"testTypeId" varchar(36) NOT NULL,
	"text" text NOT NULL,
	"description" text,
	"options" jsonb NOT NULL,
	"dimension" varchar(64),
	"weight" numeric(5, 2) DEFAULT '1.00' NOT NULL,
	"source" "question_source" DEFAULT 'preset' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_system_config" (
	"key" varchar(256) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updatedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_test_answer" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"attemptId" varchar(36) NOT NULL,
	"questionId" varchar(36) NOT NULL,
	"selectedValue" text NOT NULL,
	"scoreContribution" jsonb,
	"answeredAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_test_attempt" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"testTypeId" varchar(36) NOT NULL,
	"status" "attempt_status" DEFAULT 'in_progress' NOT NULL,
	"currentQuestionIndex" integer DEFAULT 0 NOT NULL,
	"totalQuestions" integer NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_test_result" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"attemptId" varchar(36) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"testTypeId" varchar(36) NOT NULL,
	"resultCode" varchar(64) NOT NULL,
	"resultLabel" varchar(256) NOT NULL,
	"dimensionScores" jsonb NOT NULL,
	"summary" text NOT NULL,
	"shareToken" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pg-drizzle_test_type" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(128) NOT NULL,
	"description" text NOT NULL,
	"shortDescription" varchar(512) NOT NULL,
	"iconUrl" text,
	"coverImageUrl" text,
	"scoringStrategy" "scoring_strategy" NOT NULL,
	"scoringConfig" jsonb NOT NULL,
	"resultDefinitions" jsonb NOT NULL,
	"questionCount" integer DEFAULT 0 NOT NULL,
	"estimatedMinutes" integer DEFAULT 10 NOT NULL,
	"isFeatured" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"reportPrice" numeric(10, 2) DEFAULT '9.90' NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_ai_report" ADD CONSTRAINT "pg-drizzle_ai_report_resultId_pg-drizzle_test_result_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."pg-drizzle_test_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_ai_report" ADD CONSTRAINT "pg-drizzle_ai_report_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD CONSTRAINT "pg-drizzle_order_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_order" ADD CONSTRAINT "pg-drizzle_order_resultId_pg-drizzle_test_result_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."pg-drizzle_test_result"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_question" ADD CONSTRAINT "pg-drizzle_question_testTypeId_pg-drizzle_test_type_id_fk" FOREIGN KEY ("testTypeId") REFERENCES "public"."pg-drizzle_test_type"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_answer" ADD CONSTRAINT "pg-drizzle_test_answer_attemptId_pg-drizzle_test_attempt_id_fk" FOREIGN KEY ("attemptId") REFERENCES "public"."pg-drizzle_test_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_answer" ADD CONSTRAINT "pg-drizzle_test_answer_questionId_pg-drizzle_question_id_fk" FOREIGN KEY ("questionId") REFERENCES "public"."pg-drizzle_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_attempt" ADD CONSTRAINT "pg-drizzle_test_attempt_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_attempt" ADD CONSTRAINT "pg-drizzle_test_attempt_testTypeId_pg-drizzle_test_type_id_fk" FOREIGN KEY ("testTypeId") REFERENCES "public"."pg-drizzle_test_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_result" ADD CONSTRAINT "pg-drizzle_test_result_attemptId_pg-drizzle_test_attempt_id_fk" FOREIGN KEY ("attemptId") REFERENCES "public"."pg-drizzle_test_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_result" ADD CONSTRAINT "pg-drizzle_test_result_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pg-drizzle_test_result" ADD CONSTRAINT "pg-drizzle_test_result_testTypeId_pg-drizzle_test_type_id_fk" FOREIGN KEY ("testTypeId") REFERENCES "public"."pg-drizzle_test_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_result_idx" ON "pg-drizzle_ai_report" USING btree ("resultId");--> statement-breakpoint
CREATE INDEX "report_user_idx" ON "pg-drizzle_ai_report" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "pg-drizzle_ai_report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "order_user_idx" ON "pg-drizzle_order" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "order_result_idx" ON "pg-drizzle_order" USING btree ("resultId");--> statement-breakpoint
CREATE INDEX "order_status_idx" ON "pg-drizzle_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX "question_test_type_idx" ON "pg-drizzle_question" USING btree ("testTypeId");--> statement-breakpoint
CREATE INDEX "question_source_idx" ON "pg-drizzle_question" USING btree ("source");--> statement-breakpoint
CREATE INDEX "answer_attempt_idx" ON "pg-drizzle_test_answer" USING btree ("attemptId");--> statement-breakpoint
CREATE INDEX "answer_question_idx" ON "pg-drizzle_test_answer" USING btree ("questionId");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_attempt_question_idx" ON "pg-drizzle_test_answer" USING btree ("attemptId","questionId");--> statement-breakpoint
CREATE INDEX "attempt_user_idx" ON "pg-drizzle_test_attempt" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "attempt_test_type_idx" ON "pg-drizzle_test_attempt" USING btree ("testTypeId");--> statement-breakpoint
CREATE INDEX "attempt_status_idx" ON "pg-drizzle_test_attempt" USING btree ("status");--> statement-breakpoint
CREATE INDEX "result_user_idx" ON "pg-drizzle_test_result" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "result_attempt_idx" ON "pg-drizzle_test_result" USING btree ("attemptId");--> statement-breakpoint
CREATE UNIQUE INDEX "result_share_token_idx" ON "pg-drizzle_test_result" USING btree ("shareToken");--> statement-breakpoint
CREATE UNIQUE INDEX "test_type_slug_idx" ON "pg-drizzle_test_type" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "test_type_active_idx" ON "pg-drizzle_test_type" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "test_type_featured_idx" ON "pg-drizzle_test_type" USING btree ("isFeatured");