-- ============================================================
-- 评估 / 追踪基础设施
-- 在 Supabase Dashboard SQL Editor 中执行
-- ============================================================

create table if not exists eval_traces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_point text not null check (entry_point in ('feed', 'memory', 'think', 'save_insight')),
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

alter table eval_traces enable row level security;
alter table eval_spans enable row level security;
alter table eval_feedback enable row level security;
alter table eval_labels enable row level security;
alter table eval_results enable row level security;

create policy "Users can view own eval traces"
  on eval_traces for select
  using (auth.uid() = user_id);

create policy "Users can insert own eval traces"
  on eval_traces for insert
  with check (auth.uid() = user_id);

create policy "Users can update own eval traces"
  on eval_traces for update
  using (auth.uid() = user_id);

create policy "Users can view own eval spans"
  on eval_spans for select
  using (auth.uid() = user_id);

create policy "Users can insert own eval spans"
  on eval_spans for insert
  with check (auth.uid() = user_id);

create policy "Users can update own eval spans"
  on eval_spans for update
  using (auth.uid() = user_id);

create policy "Users can view own eval feedback"
  on eval_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert own eval feedback"
  on eval_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can view own eval labels"
  on eval_labels for select
  using (auth.uid() = user_id);

create policy "Users can insert own eval labels"
  on eval_labels for insert
  with check (auth.uid() = user_id);

create policy "Users can view own eval results"
  on eval_results for select
  using (auth.uid() = user_id);

create policy "Users can insert own eval results"
  on eval_results for insert
  with check (auth.uid() = user_id);
