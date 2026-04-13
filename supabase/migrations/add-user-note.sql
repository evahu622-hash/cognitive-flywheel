-- ============================================================
-- 为 knowledge_items 添加 user_note 和 key_points 字段
-- user_note: 用户对知识条目的评价、观点、补充笔记
-- key_points: AI 提炼的核心要点（数组），供记忆宫殿展示
-- ============================================================

alter table knowledge_items add column if not exists user_note text;
alter table knowledge_items add column if not exists key_points text[];
