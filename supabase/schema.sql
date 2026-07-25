-- Kumar Quant / Wellness schema
-- Run once in Supabase Dashboard -> SQL Editor.

create table if not exists public.tracker_documents (
  owner_id text not null,
  document_key text not null,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, document_key)
);

create table if not exists public.quant_question_progress (
  owner_id text not null,
  question_id text not null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  attempts integer not null default 0 check (attempts >= 0),
  answer text not null default '',
  notes text not null default '',
  assigned_at timestamptz,
  solved_at timestamptz,
  solution_revealed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, question_id)
);

create table if not exists public.skincare_routines (
  owner_id text not null,
  id text not null,
  name text not null,
  period text not null default 'custom',
  reminder_time time,
  days smallint[] not null default '{0,1,2,3,4,5,6}',
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  check (days <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table if not exists public.skincare_steps (
  owner_id text not null,
  id text not null,
  routine_id text not null,
  step_order integer not null check (step_order > 0),
  name text not null,
  product text not null default '',
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  notes text not null default '',
  primary key (owner_id, id),
  foreign key (owner_id, routine_id) references public.skincare_routines(owner_id, id) on delete cascade,
  unique (owner_id, routine_id, step_order)
);

create table if not exists public.gym_plans (
  owner_id text not null,
  id text not null,
  name text not null,
  day_code smallint not null default -1 check (day_code between -1 and 6),
  reminder_time time,
  duration_minutes integer not null default 60 check (duration_minutes between 1 and 600),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.gym_exercises (
  owner_id text not null,
  id text not null,
  plan_id text not null,
  exercise_order integer not null check (exercise_order > 0),
  name text not null,
  sets integer not null default 0 check (sets >= 0),
  reps text not null default '',
  weight_kg numeric(8,2) not null default 0 check (weight_kg >= 0),
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  rest_seconds integer not null default 0 check (rest_seconds >= 0),
  notes text not null default '',
  primary key (owner_id, id),
  foreign key (owner_id, plan_id) references public.gym_plans(owner_id, id) on delete cascade,
  unique (owner_id, plan_id, exercise_order)
);

create table if not exists public.routine_completions (
  owner_id text not null,
  routine_type text not null check (routine_type in ('skin', 'gym')),
  routine_id text not null,
  completed_on date not null,
  completed_at timestamptz not null default now(),
  notes text not null default '',
  primary key (owner_id, routine_type, routine_id, completed_on)
);

create table if not exists public.workout_sessions (
  owner_id text not null,
  id text not null,
  plan_id text not null,
  performed_on date not null,
  started_at timestamptz,
  completed_at timestamptz,
  duration_minutes integer not null default 0,
  notes text not null default '',
  primary key (owner_id, id)
);

-- Historical sessions must survive template edits and deletion.
alter table public.workout_sessions drop constraint if exists workout_sessions_owner_id_plan_id_fkey;

create table if not exists public.workout_set_logs (
  owner_id text not null,
  id text not null,
  session_id text not null,
  exercise_name text not null,
  set_number integer not null default 0,
  reps text not null default '',
  weight_kg numeric(8,2) not null default 0,
  duration_seconds integer not null default 0,
  rest_seconds integer not null default 0,
  notes text not null default '',
  primary key (owner_id, id),
  foreign key (owner_id, session_id) references public.workout_sessions(owner_id, id) on delete cascade
);

create table if not exists public.schedule_events (
  owner_id text not null,
  id text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  reminder_minutes integer not null default 15,
  notify boolean not null default true,
  completed boolean not null default false,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  owner_id text not null,
  activity_type text not null,
  entity_id text,
  occurred_at timestamptz not null default now(),
  duration_seconds integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.focus_sessions (
  owner_id text not null,
  id text not null,
  label text not null default 'Focus session',
  planned_minutes integer not null default 25,
  actual_minutes integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  primary key (owner_id, id)
);

create table if not exists public.contest_calendar_entries (
  owner_id text not null,
  id text not null,
  platform text not null,
  title text not null,
  contest_url text not null default '',
  starts_at timestamptz not null,
  duration_seconds integer not null default 0,
  participation_status text not null default 'interested',
  added_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists public.skincare_products (
  owner_id text not null, id text not null, name text not null, product_type text not null default '',
  opened_on date, expires_on date, notes text not null default '', primary key (owner_id,id)
);
create table if not exists public.daily_reflections (
  owner_id text not null, id text not null, reflected_on date not null, mood text not null default 'okay',
  reflection text not null default '', reconciliation text not null default '', updated_at timestamptz not null default now(),
  primary key(owner_id,id)
);
create table if not exists public.quant_attempt_history (
  owner_id text not null, id text not null, question_id text not null, question_title text not null default '',
  field_name text not null, previous_value text not null default '', new_value text not null default '',
  occurred_at timestamptz not null default now(), primary key(owner_id,id)
);
create table if not exists public.skincare_step_logs (
  owner_id text not null, id text not null, routine_id text not null, step_index integer not null,
  completed_on date not null, completed_at timestamptz not null default now(), primary key(owner_id,id)
);

create index if not exists quant_progress_status_idx on public.quant_question_progress(owner_id, status);
create index if not exists routine_completion_date_idx on public.routine_completions(owner_id, completed_on desc);
create index if not exists activity_log_time_idx on public.activity_log(owner_id, occurred_at desc);
create index if not exists schedule_start_idx on public.schedule_events(owner_id, starts_at);

alter table public.tracker_documents enable row level security;
alter table public.quant_question_progress enable row level security;
alter table public.skincare_routines enable row level security;
alter table public.skincare_steps enable row level security;
alter table public.gym_plans enable row level security;
alter table public.gym_exercises enable row level security;
alter table public.routine_completions enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_set_logs enable row level security;
alter table public.schedule_events enable row level security;
alter table public.activity_log enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.contest_calendar_entries enable row level security;
alter table public.skincare_products enable row level security;
alter table public.daily_reflections enable row level security;
alter table public.quant_attempt_history enable row level security;
alter table public.skincare_step_logs enable row level security;

-- Access is server-only through SUPABASE_SERVICE_ROLE_KEY. RLS remains enabled
-- as defense in depth, and the browser-facing anon role gets no table access.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tracker_documents', 'quant_question_progress', 'skincare_routines',
    'skincare_steps', 'gym_plans', 'gym_exercises', 'routine_completions',
    'workout_sessions', 'workout_set_logs',
    'schedule_events', 'activity_log', 'focus_sessions', 'contest_calendar_entries',
    'skincare_products', 'daily_reflections', 'quant_attempt_history', 'skincare_step_logs'
  ]
  loop
    execute format('drop policy if exists single_owner_access on public.%I', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;

revoke all on all sequences in schema public from anon;
grant usage, select on all sequences in schema public to service_role;
