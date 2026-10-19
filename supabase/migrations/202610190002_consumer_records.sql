-- Apply after 202610190001_health_fitness_core.sql.
-- Account-owned records for the first consumer web vertical slice.
create table if not exists public.consumer_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  kind text not null check (kind in ('profile', 'workout', 'routine', 'water', 'care_item', 'care_log', 'health_sample', 'favorite', 'custom_exercise')),
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_id)
);
alter table public.consumer_records add column if not exists revision integer not null default 1;
alter table public.consumer_records drop constraint if exists consumer_records_kind_check;
alter table public.consumer_records add constraint consumer_records_kind_check
  check (kind in ('profile', 'workout', 'routine', 'water', 'care_item', 'care_log', 'health_sample', 'favorite', 'custom_exercise'));
create index if not exists consumer_records_history_idx
  on public.consumer_records (user_id, kind, occurred_at desc);
alter table public.consumer_records enable row level security;
drop policy if exists consumer_select on public.consumer_records;
drop policy if exists consumer_insert on public.consumer_records;
drop policy if exists consumer_update on public.consumer_records;
drop policy if exists consumer_delete on public.consumer_records;
create policy consumer_select on public.consumer_records for select using (auth.uid() = user_id);
create policy consumer_insert on public.consumer_records for insert with check (auth.uid() = user_id);
create policy consumer_update on public.consumer_records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy consumer_delete on public.consumer_records for delete using (auth.uid() = user_id);
