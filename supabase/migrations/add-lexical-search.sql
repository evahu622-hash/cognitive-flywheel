-- ============================================================
-- 全文 / 关键词检索增强
-- 1. 用 weighted tsvector 覆盖 title / tags / summary / raw_content
-- 2. 提供 lexical RPC，供 lexical-first 检索链路使用
-- ============================================================

drop index if exists knowledge_items_fts_idx;

create index if not exists knowledge_items_fts_idx on knowledge_items
  using gin (
    (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(left(raw_content, 12000), '')), 'C')
    )
  );

create or replace function search_knowledge_lexical(
  query_text text,
  match_count int default 10,
  filter_domain text default null
)
returns table (
  id uuid,
  type text,
  title text,
  summary text,
  tags text[],
  domain text,
  source_url text,
  raw_content text,
  created_at timestamptz,
  lexical_score float
)
language plpgsql
as $$
declare
  search_query tsquery;
begin
  search_query := websearch_to_tsquery('simple', query_text);

  return query
  with searchable as (
    select
      ki.id,
      ki.type,
      ki.title,
      ki.summary,
      ki.tags,
      ki.domain,
      ki.source_url,
      ki.raw_content,
      ki.created_at,
      setweight(to_tsvector('simple', coalesce(ki.title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(ki.tags, ' '), '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(ki.summary, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(left(ki.raw_content, 12000), '')), 'C') as search_document
    from knowledge_items ki
    where
      ki.user_id = auth.uid()
      and (filter_domain is null or ki.domain = filter_domain)
  )
  select
    searchable.id,
    searchable.type,
    searchable.title,
    searchable.summary,
    searchable.tags,
    searchable.domain,
    searchable.source_url,
    searchable.raw_content,
    searchable.created_at,
    ts_rank_cd(searchable.search_document, search_query) as lexical_score
  from searchable
  where searchable.search_document @@ search_query
  order by lexical_score desc, searchable.created_at desc
  limit match_count;
end;
$$;

create or replace function search_knowledge_lexical_for_eval(
  target_user_id uuid,
  query_text text,
  match_count int default 10,
  filter_domain text default null
)
returns table (
  id uuid,
  type text,
  title text,
  summary text,
  tags text[],
  domain text,
  source_url text,
  raw_content text,
  created_at timestamptz,
  lexical_score float
)
language plpgsql
as $$
declare
  search_query tsquery;
begin
  search_query := websearch_to_tsquery('simple', query_text);

  return query
  with searchable as (
    select
      ki.id,
      ki.type,
      ki.title,
      ki.summary,
      ki.tags,
      ki.domain,
      ki.source_url,
      ki.raw_content,
      ki.created_at,
      setweight(to_tsvector('simple', coalesce(ki.title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(ki.tags, ' '), '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(ki.summary, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(left(ki.raw_content, 12000), '')), 'C') as search_document
    from knowledge_items ki
    where
      ki.user_id = target_user_id
      and (filter_domain is null or ki.domain = filter_domain)
  )
  select
    searchable.id,
    searchable.type,
    searchable.title,
    searchable.summary,
    searchable.tags,
    searchable.domain,
    searchable.source_url,
    searchable.raw_content,
    searchable.created_at,
    ts_rank_cd(searchable.search_document, search_query) as lexical_score
  from searchable
  where searchable.search_document @@ search_query
  order by lexical_score desc, searchable.created_at desc
  limit match_count;
end;
$$;
