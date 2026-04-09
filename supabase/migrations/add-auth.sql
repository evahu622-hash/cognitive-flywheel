-- ============================================================
-- 用户认证 + 数据隔离（Row Level Security）
-- 在 Supabase Dashboard SQL Editor 中执行
-- ============================================================

-- 1. 添加 user_id 列到所有表
alter table knowledge_items add column if not exists user_id uuid references auth.users(id);
alter table knowledge_connections add column if not exists user_id uuid references auth.users(id);
alter table think_sessions add column if not exists user_id uuid references auth.users(id);

-- 2. 创建 user_id 索引
create index if not exists knowledge_items_user_id_idx on knowledge_items (user_id);
create index if not exists knowledge_connections_user_id_idx on knowledge_connections (user_id);
create index if not exists think_sessions_user_id_idx on think_sessions (user_id);

-- 3. 启用 RLS
alter table knowledge_items enable row level security;
alter table knowledge_connections enable row level security;
alter table think_sessions enable row level security;

-- 4. knowledge_items RLS 策略
create policy "Users can view own knowledge"
  on knowledge_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own knowledge"
  on knowledge_items for insert
  with check (auth.uid() = user_id);

create policy "Users can update own knowledge"
  on knowledge_items for update
  using (auth.uid() = user_id);

create policy "Users can delete own knowledge"
  on knowledge_items for delete
  using (auth.uid() = user_id);

-- 5. knowledge_connections RLS 策略
create policy "Users can view own connections"
  on knowledge_connections for select
  using (auth.uid() = user_id);

create policy "Users can insert own connections"
  on knowledge_connections for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own connections"
  on knowledge_connections for delete
  using (auth.uid() = user_id);

-- 6. think_sessions RLS 策略
create policy "Users can view own sessions"
  on think_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on think_sessions for insert
  with check (auth.uid() = user_id);

-- 7. 更新 match_knowledge 函数 — 加入 user_id 过滤
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
security definer
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
    ki.user_id = auth.uid()
    and ki.embedding is not null
    and 1 - (ki.embedding <=> query_embedding) > match_threshold
    and (filter_domain is null or ki.domain = filter_domain)
  order by ki.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 8. 更新 get_cognitive_stats 函数 — 按用户过滤
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

-- 10. 更新 get_cognitive_stats 函数 — 按用户过滤
create or replace function get_cognitive_stats()
returns json
language plpgsql
security definer
as $$
declare
  result json;
  current_user_id uuid := auth.uid();
begin
  select json_build_object(
    'totalKnowledge', (select count(*) from knowledge_items where user_id = current_user_id),
    'totalThoughts', (select count(*) from knowledge_items where user_id = current_user_id and type in ('thought', 'insight')),
    'totalConnections', (select count(*) from knowledge_connections where user_id = current_user_id),
    'flywheelTurns', (select count(*) from knowledge_items where user_id = current_user_id) + (select count(*) from think_sessions where user_id = current_user_id),
    'domains', coalesce(
      (select json_agg(json_build_object('name', domain, 'count', cnt))
       from (
         select domain, count(*) as cnt
         from knowledge_items
         where user_id = current_user_id
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
         where user_id = current_user_id and created_at > now() - interval '7 days'
         group by day
       ) g),
      '[]'::json
    )
  ) into result;
  return result;
end;
$$;
