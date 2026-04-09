-- 迁移回 1536 维（适配 MiniMax embo-01）
drop index if exists knowledge_items_embedding_idx;
alter table knowledge_items drop column if exists embedding;
alter table knowledge_items add column embedding vector(1536);
create index knowledge_items_embedding_idx on knowledge_items
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function match_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5,
  filter_domain text default null
)
returns table (
  id uuid, type text, title text, summary text,
  tags text[], domain text, created_at timestamptz, similarity float
)
language plpgsql as $$
begin
  return query
  select ki.id, ki.type, ki.title, ki.summary, ki.tags, ki.domain, ki.created_at,
    1 - (ki.embedding <=> query_embedding) as similarity
  from knowledge_items ki
  where ki.embedding is not null
    and 1 - (ki.embedding <=> query_embedding) > match_threshold
    and (filter_domain is null or ki.domain = filter_domain)
  order by ki.embedding <=> query_embedding
  limit match_count;
end; $$;
