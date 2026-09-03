CREATE TYPE "public"."bot_resource_kind" AS ENUM('table', 'doc', 'file');--> statement-breakpoint
CREATE TABLE "pg-drizzle_bot_resource_binding" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"sceneId" varchar(64) NOT NULL,
	"alias" varchar(64) NOT NULL,
	"kind" "bot_resource_kind" DEFAULT 'table' NOT NULL,
	"provider" "bot_platform" NOT NULL,
	"workspaceId" varchar(256) NOT NULL,
	"resourceId" varchar(256) NOT NULL,
	"fieldMapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uniqueKey" varchar(64),
	"isDefault" boolean DEFAULT true NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone
);
--> statement-breakpoint
-- 搬迁旧表数据：platform 既是消息来源又是数据平台的旧语义，在新表里只保留
-- 「数据所在平台」这一层含义，落到 provider。alias 用平台标签兜一个可读默认值。
INSERT INTO "pg-drizzle_bot_resource_binding" (
	"id", "sceneId", "alias", "kind", "provider",
	"workspaceId", "resourceId", "fieldMapping", "uniqueKey",
	"isDefault", "isActive", "createdAt", "updatedAt"
)
SELECT
	"id",
	"sceneId",
	CASE "platform"
		WHEN 'feishu' THEN '飞书表格'
		WHEN 'dingtalk' THEN '钉钉表格'
		WHEN 'wecom' THEN '企微表格'
	END,
	'table'::"bot_resource_kind",
	"platform",
	"workspaceId",
	"tableId",
	"fieldMapping",
	"uniqueKey",
	-- 旧表一个场景每平台至多一条；迁移后按 sceneId 取第一条作为默认资源
	("platform" = (
		SELECT m2."platform"
		FROM "pg-drizzle_bot_table_mapping" m2
		WHERE m2."sceneId" = m."sceneId"
		ORDER BY m2."createdAt", m2."platform"
		LIMIT 1
	)),
	"isActive",
	"createdAt",
	"updatedAt"
FROM "pg-drizzle_bot_table_mapping" m;
--> statement-breakpoint
DROP TABLE "pg-drizzle_bot_table_mapping" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "bot_resource_binding_scene_alias_idx" ON "pg-drizzle_bot_resource_binding" USING btree ("sceneId","alias");--> statement-breakpoint
CREATE INDEX "bot_resource_binding_scene_id_idx" ON "pg-drizzle_bot_resource_binding" USING btree ("sceneId");
