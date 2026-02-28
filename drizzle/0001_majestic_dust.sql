DROP INDEX "result_attempt_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "result_attempt_idx" ON "pg-drizzle_test_result" USING btree ("attemptId");