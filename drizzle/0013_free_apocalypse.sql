DROP INDEX "info_collect_id_card_idx";--> statement-breakpoint
ALTER TABLE "pg-drizzle_info_collect_record" ALTER COLUMN "idCard" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "pg-drizzle_info_collect_record" ADD COLUMN "idCardHash" varchar(64);--> statement-breakpoint
CREATE INDEX "info_collect_id_card_hash_idx" ON "pg-drizzle_info_collect_record" USING btree ("idCardHash");--> statement-breakpoint
-- 注意：部署后需运行 pnpm db:encrypt-id-cards 回填已有数据的 idCardHash 并加密 idCard
-- 回填完成后执行：ALTER TABLE "pg-drizzle_info_collect_record" ALTER COLUMN "idCardHash" SET NOT NULL;
