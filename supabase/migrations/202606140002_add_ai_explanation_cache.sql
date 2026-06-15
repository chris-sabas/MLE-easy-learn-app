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
