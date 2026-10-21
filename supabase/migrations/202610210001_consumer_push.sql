-- Run after 202610190002_consumer_records.sql. Push endpoints and delivery keys
-- are account-owned and removed automatically when an auth user is deleted.
create table if not exists public.consumer_push_subscriptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_hash text not null check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, endpoint_hash)
);
alter table public.consumer_push_subscriptions enable row level security;
-- No client policies: only the verified API, using the service role, can write
-- subscriptions. This prevents unvalidated push endpoints from bypassing the
-- server-side endpoint allowlist.
drop policy if exists consumer_push_select on public.consumer_push_subscriptions;
drop policy if exists consumer_push_insert on public.consumer_push_subscriptions;
drop policy if exists consumer_push_delete on public.consumer_push_subscriptions;

create table if not exists public.consumer_push_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  occurrence_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, occurrence_key)
);
alter table public.consumer_push_deliveries enable row level security;
-- Only the server's service role may claim and inspect delivery keys.
create index if not exists consumer_push_deliveries_created_idx on public.consumer_push_deliveries (created_at);
