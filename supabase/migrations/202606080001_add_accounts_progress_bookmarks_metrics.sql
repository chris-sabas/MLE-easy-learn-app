create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  last_question_id integer,
  metrics_range_start integer not null default 1,
  metrics_range_end integer not null default 285,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_metrics_range_check check (metrics_range_start <= metrics_range_end)
);

create table public.question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id integer not null,
  selected_answer text not null,
  result text not null check (result in ('correct','incorrect','ungraded')),
  answered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create table public.bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

create index profiles_username_idx on public.profiles (username);
create index question_progress_user_answered_at_idx on public.question_progress (user_id, answered_at desc);
create index question_progress_user_result_idx on public.question_progress (user_id, result);
create index bookmarks_user_created_at_idx on public.bookmarks (user_id, created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger question_progress_set_updated_at
before update on public.question_progress
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.question_progress enable row level security;
alter table public.bookmarks enable row level security;

create policy "profiles_select_own"
on public.profiles for select
using (id = auth.uid());

create policy "profiles_insert_own"
on public.profiles for insert
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "question_progress_select_own"
on public.question_progress for select
using (user_id = auth.uid());

create policy "question_progress_insert_own"
on public.question_progress for insert
with check (user_id = auth.uid());

create policy "question_progress_update_own"
on public.question_progress for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "question_progress_delete_own"
on public.question_progress for delete
using (user_id = auth.uid());

create policy "bookmarks_select_own"
on public.bookmarks for select
using (user_id = auth.uid());

create policy "bookmarks_insert_own"
on public.bookmarks for insert
with check (user_id = auth.uid());

create policy "bookmarks_delete_own"
on public.bookmarks for delete
using (user_id = auth.uid());

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
begin
  requested_username = nullif(trim(new.raw_user_meta_data ->> 'username'), '');

  if requested_username is null then
    raise exception 'Username is required.';
  end if;

  insert into public.profiles (id, username)
  values (new.id, requested_username);

  return new;
exception
  when unique_violation then
    raise exception 'Username is already taken.';
end;
$$;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();
