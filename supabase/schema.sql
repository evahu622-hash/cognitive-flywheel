-- ============================================================
-- Cognitive Flywheel - Database Schema
-- 在 Supabase Dashboard SQL Editor 中执行此文件
-- 执行完本文件后，再执行 supabase/migrations/add-evals.sql
-- ============================================================

-- 启用 pgvector 扩展
create extension if not exists vector;

-- ============================================================
-- 知识条目表
-- ============================================================
create table knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('article', 'thought', 'insight')),
  title text not null,
  summary text not null,
  tags text[] not null default '{}',
  domain text not null,
  source_url text,
  source_type text check (source_type in ('url', 'text', 'thought')),
  raw_content text,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 向量相似度索引 (IVFFlat，适合 < 100k 行；数据量大后可切 HNSW)
create index knowledge_items_embedding_idx on knowledge_items
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 领域筛选索引
create index knowledge_items_domain_idx on knowledge_items (domain);
create index knowledge_items_user_id_idx on knowledge_items (user_id);

-- 创建时间索引
create index knowledge_items_created_at_idx on knowledge_items (created_at desc);

-- 全文搜索索引（标题/标签权重最高，正文做补充召回）
create index knowledge_items_fts_idx on knowledge_items
  using gin (
    (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(array_to_string(tags, ' '), '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(left(raw_content, 12000), '')), 'C')
    )
  );

-- ============================================================
-- 知识关联表
-- ============================================================
create table knowledge_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  from_id uuid not null references knowledge_items(id) on delete cascade,
  to_id uuid not null references knowledge_items(id) on delete cascade,
  connection_type text not null default 'similarity',
  similarity_score float,
  reason text,
  created_at timestamptz not null default now(),
  unique(from_id, to_id)
);

create index knowledge_connections_from_idx on knowledge_connections (from_id);
create index knowledge_connections_to_idx on knowledge_connections (to_id);
create index knowledge_connections_user_id_idx on knowledge_connections (user_id);

-- ============================================================
-- 思考会话表
-- ============================================================
create table think_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  mode text not null check (mode in ('roundtable', 'coach', 'crossdomain', 'mirror')),
  question text not null,
  responses jsonb not null default '[]',
  insights text[] not null default '{}',
  knowledge_context jsonb default '[]',
  created_at timestamptz not null default now()
);

create index think_sessions_mode_idx on think_sessions (mode);
create index think_sessions_created_at_idx on think_sessions (created_at desc);
create index think_sessions_user_id_idx on think_sessions (user_id);

-- ============================================================
-- RPC: 向量相似度搜索
-- ============================================================
create or replace function match_knowledge(
  query_embedding vector(1536),
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

-- ============================================================
-- RPC: 全文 / 关键词搜索
-- ============================================================
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
    where filter_domain is null or ki.domain = filter_domain
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

-- ============================================================
-- RPC: Eval helper - 按 user_id 执行全文 / 关键词搜索
-- 仅用于离线 retrieval eval，避免依赖 auth.uid()
-- ============================================================
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

-- ============================================================
-- RPC: 认知统计
-- ============================================================
create or replace function get_cognitive_stats()
returns json
language plpgsql
as $$
declare
  result json;
begin
  select json_build_object(
    'totalKnowledge', (select count(*) from knowledge_items),
    'totalThoughts', (select count(*) from knowledge_items where type in ('thought', 'insight')),
    'totalConnections', (select count(*) from knowledge_connections),
    'flywheelTurns', (select count(*) from knowledge_items) + (select count(*) from think_sessions),
    'domains', coalesce(
      (select json_agg(json_build_object('name', domain, 'count', cnt))
       from (
         select domain, count(*) as cnt
         from knowledge_items
         group by domain
         order by cnt desc
       ) d),
      '[]'::json
    ),
    'recentGrowth', coalesce(
      (select json_agg(json_build_object('date', to_char(day, 'MM-DD'), 'items', cnt) order by day)
       from (
         select date_trunc('day', created_at) as day, count(*) as cnt
         from knowledge_items
         where created_at > now() - interval '7 days'
         group by day
       ) g),
      '[]'::json
    )
  ) into result;
  return result;
end;
$$;

-- ============================================================
-- 自动更新 updated_at 触发器
-- ============================================================
create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger knowledge_items_updated_at
  before update on knowledge_items
  for each row
  execute function update_updated_at();
