-- Core health and fitness tables. Safe to re-run; legacy JSON remains intact.
-- Apply after the existing supabase/schema.sql.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Kolkata',
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  distance_unit text not null default 'km' check (distance_unit in ('km', 'mi')),
  height_cm numeric(6,2),
  dashboard_layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_catalogue (
  canonical_id text primary key,
  name text not null,
  category text not null,
  equipment text,
  tracking_mode text not null,
  supported_metrics text[] not null default '{}',
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null references public.exercise_catalogue(canonical_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

create table if not exists public.exercise_workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null references public.exercise_catalogue(canonical_id),
  performed_on date not null,
  started_at timestamptz,
  ended_at timestamptz,
  title text not null default '',
  notes text not null default '',
  status text not null default 'completed' check (status in ('planned', 'in_progress', 'completed', 'cancelled')),
  source text not null default 'manual',
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, legacy_id)
);

create table if not exists public.exercise_workout_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.exercise_workout_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  set_order integer not null check (set_order > 0),
  weight_kg numeric(10,3),
  external_load_kg numeric(10,3),
  bodyweight_kg numeric(10,3),
  reps integer check (reps is null or reps >= 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  distance_km numeric(12,5) check (distance_km is null or distance_km >= 0),
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),
  rpe numeric(3,1) check (rpe is null or (rpe >= 0 and rpe <= 10)),
  is_warmup boolean not null default false,
  is_complete boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, set_order)
);

create table if not exists public.health_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_sample_id text not null,
  metric_type text not null,
  value numeric,
  unit text not null,
  sample_start timestamptz not null,
  sample_end timestamptz not null,
  source_bundle_id text,
  source_name text,
  device_metadata jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_sample_id, metric_type)
);

create table if not exists public.health_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_workout_id text not null,
  activity_type text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  active_energy_kcal numeric,
  distance_km numeric,
  average_heart_rate numeric,
  max_heart_rate numeric,
  source_bundle_id text,
  source_name text,
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_workout_id)
);

create table if not exists public.health_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_type text not null,
  target_value numeric not null check (target_value >= 0),
  unit text not null,
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly')),
  effective_from date not null,
  effective_to date,
  source text not null default 'app',
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create table if not exists public.daily_health_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_date date not null,
  timezone text not null,
  steps integer,
  active_energy_kcal numeric,
  exercise_minutes numeric,
  stand_hours numeric,
  sleep_seconds numeric,
  resting_heart_rate numeric,
  hrv_ms numeric,
  source_status jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  primary key (user_id, summary_date, timezone)
);

create table if not exists public.nutrition_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null,
  meal_name text not null default '',
  calories_kcal numeric,
  protein_g numeric,
  carbohydrates_g numeric,
  fat_g numeric,
  water_ml numeric,
  caffeine_mg numeric,
  source text not null default 'manual',
  source_entry_id text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, source, source_entry_id)
);

create table if not exists public.health_sync_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  metric_type text not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  deleted_count integer not null default 0,
  last_error text,
  anchor_blob text,
  primary key (user_id, device_id, metric_type)
);

create index if not exists exercise_sessions_user_date_idx on public.exercise_workout_sessions(user_id, performed_on desc);
create index if not exists exercise_sessions_exercise_date_idx on public.exercise_workout_sessions(user_id, exercise_id, performed_on desc);
create index if not exists exercise_sets_session_order_idx on public.exercise_workout_sets(session_id, set_order);
create index if not exists health_samples_user_metric_time_idx on public.health_samples(user_id, metric_type, sample_start desc);
create index if not exists health_workouts_user_start_idx on public.health_workouts(user_id, started_at desc);
create index if not exists daily_health_user_date_idx on public.daily_health_summaries(user_id, summary_date desc);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_profiles', 'exercise_favorites', 'exercise_workout_sessions',
    'exercise_workout_sets', 'health_samples', 'health_workouts',
    'health_targets', 'daily_health_summaries', 'nutrition_entries', 'health_sync_state'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists owner_select on public.%I', table_name);
    execute format('drop policy if exists owner_insert on public.%I', table_name);
    execute format('drop policy if exists owner_update on public.%I', table_name);
    execute format('drop policy if exists owner_delete on public.%I', table_name);
    execute format('create policy owner_select on public.%I for select using (auth.uid() = user_id)', table_name);
    execute format('create policy owner_insert on public.%I for insert with check (auth.uid() = user_id)', table_name);
    execute format('create policy owner_update on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', table_name);
    execute format('create policy owner_delete on public.%I for delete using (auth.uid() = user_id)', table_name);
  end loop;
end $$;

alter table public.exercise_catalogue enable row level security;
drop policy if exists catalogue_read on public.exercise_catalogue;
create policy catalogue_read on public.exercise_catalogue for select using (true);
