-- ============================================================
-- 迁移：将 embedding 维度从 1536 改为 768（适配 Jina v3）
-- 在 Supabase Dashboard SQL Editor 中执行
-- ============================================================

-- 1. 删除旧索引
drop index if exists knowledge_items_embedding_idx;

-- 2. 删除旧列，添加新维度列
alter table knowledge_items drop column if exists embedding;
alter table knowledge_items add column embedding vector(768);

-- 3. 重建向量索引
create index knowledge_items_embedding_idx on knowledge_items
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. 更新 match_knowledge 函数签名
create or replace function match_knowledge(
  query_embedding vector(768),
  match_threshold float default 0.7,
  match_count int default 5,
  filter_domain text default null
)
returns table (
  id uuid,
  type text,
  title text,
  summary text,
  tags text[],
  domain text,
  created_at timestamptz,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    ki.id,
    ki.type,
    ki.title,
    ki.summary,
    ki.tags,
    ki.domain,
    ki.created_at,
    1 - (ki.embedding <=> query_embedding) as similarity
  from knowledge_items ki
  where
    ki.embedding is not null
    and 1 - (ki.embedding <=> query_embedding) > match_threshold
    and (filter_domain is null or ki.domain = filter_domain)
  order by ki.embedding <=> query_embedding
  limit match_count;
end;
$$;
