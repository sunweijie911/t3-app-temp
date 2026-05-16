ALTER TABLE "pg-drizzle_battery_swap_package" ADD COLUMN "buttons" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "pg-drizzle_battery_swap_package"
   SET "buttons" = jsonb_build_array(
         jsonb_build_object('label', '立即购买', 'link', "purchaseLink")
       )
 WHERE "purchaseLink" IS NOT NULL AND "purchaseLink" <> '';
--> statement-breakpoint
ALTER TABLE "pg-drizzle_battery_swap_package" DROP COLUMN "purchaseLink";
