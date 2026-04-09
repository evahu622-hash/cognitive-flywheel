-- ============================================================
-- Knowledge Summaries (领域编译综述)
-- Karpathy-inspired: 当领域知识积累足够时，编译为综述
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

create index knowledge_summaries_user_domain_idx
  on knowledge_summaries (user_id, domain);

-- RLS
alter table knowledge_summaries enable row level security;

create policy "Users can view own summaries"
  on knowledge_summaries for select
  using (auth.uid() = user_id);

create policy "Users can insert own summaries"
  on knowledge_summaries for insert
  with check (auth.uid() = user_id);

create policy "Users can update own summaries"
  on knowledge_summaries for update
  using (auth.uid() = user_id);
