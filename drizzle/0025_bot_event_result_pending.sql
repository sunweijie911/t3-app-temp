-- 二次确认（DELETE / 单条 UPDATE / uniqueKey 撞车）是破坏性操作的设计正路，
-- 原先统一记成 error，导致一次全成功的会话在统计面板上也显示高错误率。
ALTER TYPE "public"."bot_event_result" ADD VALUE 'pending';
