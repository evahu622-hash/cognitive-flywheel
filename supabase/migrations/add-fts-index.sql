-- 全文搜索：用触发器维护 tsvector 列，避免 IMMUTABLE 限制

-- 1. 添加 tsvector 列
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS fts_document tsvector;

-- 2. 创建更新函数
CREATE OR REPLACE FUNCTION knowledge_items_fts_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.fts_document :=
    setweight(to_tsvector('simple'::regconfig, coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(NEW.tags, ' '), '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(NEW.summary, '')), 'B');
  RETURN NEW;
END;
$$;

-- 3. 创建触发器
DROP TRIGGER IF EXISTS knowledge_items_fts_trigger ON knowledge_items;
CREATE TRIGGER knowledge_items_fts_trigger
  BEFORE INSERT OR UPDATE ON knowledge_items
  FOR EACH ROW EXECUTE FUNCTION knowledge_items_fts_update();

-- 4. 回填已有数据
UPDATE knowledge_items SET fts_document =
  setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(tags, ' '), '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(summary, '')), 'B');

-- 5. 建 GIN 索引
DROP INDEX IF EXISTS knowledge_items_fts_idx;
CREATE INDEX knowledge_items_fts_idx ON knowledge_items USING gin (fts_document);
