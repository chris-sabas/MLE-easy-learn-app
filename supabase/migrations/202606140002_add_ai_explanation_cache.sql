create table public.ai_explanation_cache (
  question_id integer not null,
  model_provider text not null check (model_provider in ('openai','gemini')),
  model_id text not null,
  explanation text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, model_provider, model_id)
);

create index ai_explanation_cache_model_idx
on public.ai_explanation_cache (model_provider, model_id);

create trigger ai_explanation_cache_set_updated_at
before update on public.ai_explanation_cache
for each row execute function public.set_updated_at();

alter table public.ai_explanation_cache enable row level security;

create policy "ai_explanation_cache_select_authenticated"
on public.ai_explanation_cache for select
using (auth.uid() is not null);

create policy "ai_explanation_cache_insert_authenticated"
on public.ai_explanation_cache for insert
with check (auth.uid() is not null and created_by = auth.uid());

create policy "ai_explanation_cache_update_authenticated"
on public.ai_explanation_cache for update
using (auth.uid() is not null)
with check (auth.uid() is not null);

create table public.ai_question_history (
  id uuid primary key default gen_random_uuid(),
  question_id integer,
  model_provider text not null check (model_provider in ('openai','gemini')),
  model_id text not null,
  mode text not null check (mode in ('custom','followup','general')),
  user_message text not null,
  answer text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index ai_question_history_created_at_idx
on public.ai_question_history (created_at desc);

create index ai_question_history_question_idx
on public.ai_question_history (question_id, created_at desc);

alter table public.ai_question_history enable row level security;

create policy "ai_question_history_select_authenticated"
on public.ai_question_history for select
using (auth.uid() is not null);

create policy "ai_question_history_insert_authenticated"
on public.ai_question_history for insert
with check (auth.uid() is not null and created_by = auth.uid());
