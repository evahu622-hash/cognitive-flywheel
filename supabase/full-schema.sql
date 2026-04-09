-- ============================================================
-- Cognitive Flywheel - 完整数据库 Schema
-- 一次性执行，包含所有表、函数、索引、RLS
-- 在 Supabase Dashboard SQL Editor 中执行
-- ============================================================

-- 启用 pgvector 扩展
create extension if not exists vector;

-- ============================================================
-- 1. 知识条目表
-- ============================================================
create table if not exists knowledge_items (
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

create index if not exists knowledge_items_domain_idx on knowledge_items (domain);
create index if not exists knowledge_items_user_id_idx on knowledge_items (user_id);
create index if not exists knowledge_items_created_at_idx on knowledge_items (created_at desc);

-- 全文搜索：不建 GIN 索引（小规模下查询时动态计算 tsvector 足够快）
-- 规模超过 1000 条后可考虑添加 generated column + GIN 索引优化
drop index if exists knowledge_items_fts_idx;

-- ============================================================
-- 2. 知识关联表
-- ============================================================
create table if not exists knowledge_connections (
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

create index if not exists knowledge_connections_from_idx on knowledge_connections (from_id);
create index if not exists knowledge_connections_to_idx on knowledge_connections (to_id);
create index if not exists knowledge_connections_user_id_idx on knowledge_connections (user_id);

-- ============================================================
-- 3. 知识综述表 (领域编译)
-- ============================================================
create table if not exists knowledge_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  domain text not null,
  topic text,
  compiled_content text not null,
  source_ids uuid[] not null default '{}',
  last_compiled_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, domain, topic)
);

create index if not exists knowledge_summaries_user_domain_idx
  on knowledge_summaries (user_id, domain);

-- ============================================================
-- 4. 思考会话表
-- ============================================================
create table if not exists think_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  mode text not null check (mode in ('roundtable', 'coach', 'crossdomain', 'mirror')),
  question text not null,
  responses jsonb not null default '[]',
  insights text[] not null default '{}',
  knowledge_context jsonb default '[]',
  created_at timestamptz not null default now()
);

create index if not exists think_sessions_mode_idx on think_sessions (mode);
create index if not exists think_sessions_created_at_idx on think_sessions (created_at desc);
create index if not exists think_sessions_user_id_idx on think_sessions (user_id);

-- ============================================================
-- 5. 评估追踪表
-- ============================================================
create table if not exists eval_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_point text not null check (entry_point in ('feed', 'memory', 'think', 'save_insight', 'compile', 'lint')),
  trace_status text not null default 'running' check (trace_status in ('running', 'success', 'error', 'partial')),
  source_type text,
  mode text,
  model_name text,
  prompt_version text,
  session_id uuid references think_sessions(id) on delete set null,
  knowledge_item_id uuid references knowledge_items(id) on delete set null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  latency_ms integer
);

-- 更新 entry_point 约束以支持 compile/lint（如果表已存在旧约束）
DO $$ BEGIN
  ALTER TABLE eval_traces DROP CONSTRAINT IF EXISTS eval_traces_entry_point_check;
  ALTER TABLE eval_traces ADD CONSTRAINT eval_traces_entry_point_check
    CHECK (entry_point IN ('feed', 'memory', 'think', 'save_insight', 'compile', 'lint'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

create index if not exists eval_traces_user_id_idx on eval_traces (user_id);
create index if not exists eval_traces_entry_point_idx on eval_traces (entry_point);
create index if not exists eval_traces_status_idx on eval_traces (trace_status);
create index if not exists eval_traces_started_at_idx on eval_traces (started_at desc);

create table if not exists eval_spans (
  id uuid primary key default gen_random_uuid(),
  trace_id uuid not null references eval_traces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  span_name text not null,
  span_status text not null default 'running' check (span_status in ('running', 'success', 'error', 'skipped')),
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  latency_ms integer
);

create index if not exists eval_spans_trace_id_idx on eval_spans (trace_id);
create index if not exists eval_spans_user_id_idx on eval_spans (user_id);
create index if not exists eval_spans_started_at_idx on eval_spans (started_at desc);

create table if not exists eval_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trace_id uuid references eval_traces(id) on delete cascade,
  think_session_id uuid references think_sessions(id) on delete cascade,
  knowledge_item_id uuid references knowledge_items(id) on delete cascade,
  feedback_type text not null check (feedback_type in ('save', 'skip', 'thumb_up', 'thumb_down', 'edit')),
  feedback_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists eval_feedback_user_id_idx on eval_feedback (user_id);
create index if not exists eval_feedback_trace_id_idx on eval_feedback (trace_id);
create index if not exists eval_feedback_created_at_idx on eval_feedback (created_at desc);

create table if not exists eval_labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trace_id uuid not null references eval_traces(id) on delete cascade,
  dataset_name text,
  reviewer text,
  failure_code text,
  pass_fail boolean,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists eval_labels_user_id_idx on eval_labels (user_id);
create index if not exists eval_labels_trace_id_idx on eval_labels (trace_id);
create index if not exists eval_labels_created_at_idx on eval_labels (created_at desc);

create table if not exists eval_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trace_id uuid not null references eval_traces(id) on delete cascade,
  evaluator_name text not null,
  evaluator_type text not null check (evaluator_type in ('code', 'llm_judge', 'human')),
  score float,
  pass_fail boolean,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  run_id text,
  created_at timestamptz not null default now()
);

create index if not exists eval_results_user_id_idx on eval_results (user_id);
create index if not exists eval_results_trace_id_idx on eval_results (trace_id);
create index if not exists eval_results_created_at_idx on eval_results (created_at desc);

-- ============================================================
-- 6. RLS (Row Level Security)
-- ============================================================
alter table knowledge_items enable row level security;
alter table knowledge_connections enable row level security;
alter table knowledge_summaries enable row level security;
alter table think_sessions enable row level security;
alter table eval_traces enable row level security;
alter table eval_spans enable row level security;
alter table eval_feedback enable row level security;
alter table eval_labels enable row level security;
alter table eval_results enable row level security;

-- knowledge_items
drop policy if exists "Users can view own knowledge" on knowledge_items;
drop policy if exists "Users can insert own knowledge" on knowledge_items;
drop policy if exists "Users can update own knowledge" on knowledge_items;
drop policy if exists "Users can delete own knowledge" on knowledge_items;
create policy "Users can view own knowledge" on knowledge_items for select using (auth.uid() = user_id);
create policy "Users can insert own knowledge" on knowledge_items for insert with check (auth.uid() = user_id);
create policy "Users can update own knowledge" on knowledge_items for update using (auth.uid() = user_id);
create policy "Users can delete own knowledge" on knowledge_items for delete using (auth.uid() = user_id);

-- knowledge_connections
drop policy if exists "Users can view own connections" on knowledge_connections;
drop policy if exists "Users can insert own connections" on knowledge_connections;
drop policy if exists "Users can delete own connections" on knowledge_connections;
create policy "Users can view own connections" on knowledge_connections for select using (auth.uid() = user_id);
create policy "Users can insert own connections" on knowledge_connections for insert with check (auth.uid() = user_id);
create policy "Users can delete own connections" on knowledge_connections for delete using (auth.uid() = user_id);

-- knowledge_summaries
drop policy if exists "Users can view own summaries" on knowledge_summaries;
drop policy if exists "Users can insert own summaries" on knowledge_summaries;
drop policy if exists "Users can update own summaries" on knowledge_summaries;
create policy "Users can view own summaries" on knowledge_summaries for select using (auth.uid() = user_id);
create policy "Users can insert own summaries" on knowledge_summaries for insert with check (auth.uid() = user_id);
create policy "Users can update own summaries" on knowledge_summaries for update using (auth.uid() = user_id);

-- think_sessions
drop policy if exists "Users can view own sessions" on think_sessions;
drop policy if exists "Users can insert own sessions" on think_sessions;
create policy "Users can view own sessions" on think_sessions for select using (auth.uid() = user_id);
create policy "Users can insert own sessions" on think_sessions for insert with check (auth.uid() = user_id);

-- eval_traces
drop policy if exists "Users can view own eval traces" on eval_traces;
drop policy if exists "Users can insert own eval traces" on eval_traces;
drop policy if exists "Users can update own eval traces" on eval_traces;
create policy "Users can view own eval traces" on eval_traces for select using (auth.uid() = user_id);
create policy "Users can insert own eval traces" on eval_traces for insert with check (auth.uid() = user_id);
create policy "Users can update own eval traces" on eval_traces for update using (auth.uid() = user_id);

-- eval_spans
drop policy if exists "Users can view own eval spans" on eval_spans;
drop policy if exists "Users can insert own eval spans" on eval_spans;
drop policy if exists "Users can update own eval spans" on eval_spans;
create policy "Users can view own eval spans" on eval_spans for select using (auth.uid() = user_id);
create policy "Users can insert own eval spans" on eval_spans for insert with check (auth.uid() = user_id);
create policy "Users can update own eval spans" on eval_spans for update using (auth.uid() = user_id);

-- eval_feedback
drop policy if exists "Users can view own eval feedback" on eval_feedback;
drop policy if exists "Users can insert own eval feedback" on eval_feedback;
create policy "Users can view own eval feedback" on eval_feedback for select using (auth.uid() = user_id);
create policy "Users can insert own eval feedback" on eval_feedback for insert with check (auth.uid() = user_id);

-- eval_labels
drop policy if exists "Users can view own eval labels" on eval_labels;
drop policy if exists "Users can insert own eval labels" on eval_labels;
create policy "Users can view own eval labels" on eval_labels for select using (auth.uid() = user_id);
create policy "Users can insert own eval labels" on eval_labels for insert with check (auth.uid() = user_id);

-- eval_results
drop policy if exists "Users can view own eval results" on eval_results;
drop policy if exists "Users can insert own eval results" on eval_results;
create policy "Users can view own eval results" on eval_results for select using (auth.uid() = user_id);
create policy "Users can insert own eval results" on eval_results for insert with check (auth.uid() = user_id);

-- ============================================================
-- 7. Functions (RPC)
-- ============================================================

-- 向量相似度搜索
create or replace function match_knowledge(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5,
  filter_domain text default null
)
returns table (
  id uuid, type text, title text, summary text, tags text[],
  domain text, created_at timestamptz, similarity float
)
language plpgsql security definer as $$
begin
  return query
  select ki.id, ki.type, ki.title, ki.summary, ki.tags, ki.domain, ki.created_at,
    1 - (ki.embedding <=> query_embedding) as similarity
  from knowledge_items ki
  where ki.user_id = auth.uid()
    and ki.embedding is not null
    and 1 - (ki.embedding <=> query_embedding) > match_threshold
    and (filter_domain is null or ki.domain = filter_domain)
  order by ki.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 全文搜索
create or replace function search_knowledge_lexical(
  query_text text,
  match_count int default 10,
  filter_domain text default null
)
returns table (
  id uuid, type text, title text, summary text, tags text[],
  domain text, source_url text, raw_content text,
  created_at timestamptz, lexical_score float
)
language plpgsql as $$
declare search_query tsquery;
begin
  search_query := websearch_to_tsquery('simple'::regconfig, query_text);
  return query
  with searchable as (
    select ki.id, ki.type, ki.title, ki.summary, ki.tags, ki.domain,
      ki.source_url, ki.raw_content, ki.created_at,
      setweight(to_tsvector('simple'::regconfig, coalesce(ki.title, '')), 'A') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(ki.tags, ' '), '')), 'A') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(ki.summary, '')), 'B') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(ki.raw_content, '')), 'C') as search_document
    from knowledge_items ki
    where ki.user_id = auth.uid()
      and (filter_domain is null or ki.domain = filter_domain)
  )
  select searchable.id, searchable.type, searchable.title, searchable.summary,
    searchable.tags, searchable.domain, searchable.source_url, searchable.raw_content,
    searchable.created_at,
    ts_rank_cd(searchable.search_document, search_query) as lexical_score
  from searchable
  where searchable.search_document @@ search_query
  order by lexical_score desc, searchable.created_at desc
  limit match_count;
end;
$$;

-- Eval 用全文搜索 (指定 user_id，绕过 RLS)
create or replace function search_knowledge_lexical_for_eval(
  target_user_id uuid,
  query_text text,
  match_count int default 10,
  filter_domain text default null
)
returns table (
  id uuid, type text, title text, summary text, tags text[],
  domain text, source_url text, raw_content text,
  created_at timestamptz, lexical_score float
)
language plpgsql as $$
declare search_query tsquery;
begin
  search_query := websearch_to_tsquery('simple'::regconfig, query_text);
  return query
  with searchable as (
    select ki.id, ki.type, ki.title, ki.summary, ki.tags, ki.domain,
      ki.source_url, ki.raw_content, ki.created_at,
      setweight(to_tsvector('simple'::regconfig, coalesce(ki.title, '')), 'A') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(ki.tags, ' '), '')), 'A') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(ki.summary, '')), 'B') ||
      setweight(to_tsvector('simple'::regconfig, coalesce(ki.raw_content, '')), 'C') as search_document
    from knowledge_items ki
    where ki.user_id = target_user_id
      and (filter_domain is null or ki.domain = filter_domain)
  )
  select searchable.id, searchable.type, searchable.title, searchable.summary,
    searchable.tags, searchable.domain, searchable.source_url, searchable.raw_content,
    searchable.created_at,
    ts_rank_cd(searchable.search_document, search_query) as lexical_score
  from searchable
  where searchable.search_document @@ search_query
  order by lexical_score desc, searchable.created_at desc
  limit match_count;
end;
$$;

-- 认知统计
create or replace function get_cognitive_stats()
returns json
language plpgsql security definer as $$
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
       from (select domain, count(*) as cnt from knowledge_items where user_id = current_user_id group by domain order by cnt desc) d),
      '[]'::json),
    'recentGrowth', coalesce(
      (select json_agg(json_build_object('date', to_char(day, 'MM-DD'), 'items', cnt) order by day)
       from (select date_trunc('day', created_at) as day, count(*) as cnt from knowledge_items where user_id = current_user_id and created_at > now() - interval '7 days' group by day) g),
      '[]'::json)
  ) into result;
  return result;
end;
$$;

-- updated_at 自动更新触发器
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_items_updated_at on knowledge_items;
create trigger knowledge_items_updated_at
  before update on knowledge_items
  for each row execute function update_updated_at();

drop trigger if exists knowledge_summaries_updated_at on knowledge_summaries;
create trigger knowledge_summaries_updated_at
  before update on knowledge_summaries
  for each row execute function update_updated_at();
