create table if not exists public.strategy_registry (
  strategy_id text primary key,
  name text not null,
  source text not null,
  status text not null,
  admission_status text,
  admission_gate text,
  score double precision not null default 0,
  annual_return double precision,
  max_drawdown double precision,
  sharpe double precision,
  win_rate double precision,
  last_backtest_job_id text,
  last_backtested_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint strategy_registry_source_check
    check (source in ('catalog', 'miner', 'lab')),
  constraint strategy_registry_status_check
    check (status in ('queued', 'running', 'radar-ready', 'watchlist', 'blocked', 'failed'))
);

create index if not exists strategy_registry_status_idx
  on public.strategy_registry (status, score desc);

create index if not exists strategy_registry_source_idx
  on public.strategy_registry (source, updated_at desc);

create table if not exists public.strategy_backtest_jobs (
  job_id text primary key,
  kind text not null,
  strategy_id text not null,
  strategy_name text,
  source text not null,
  status text not null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  summary text,
  report_count integer,
  report_payload jsonb,
  updated_at timestamptz not null default now(),
  constraint strategy_backtest_jobs_kind_check
    check (kind in ('catalog', 'mine')),
  constraint strategy_backtest_jobs_source_check
    check (source in ('catalog', 'miner', 'lab')),
  constraint strategy_backtest_jobs_status_check
    check (status in ('queued', 'running', 'succeeded', 'failed'))
);

create index if not exists strategy_backtest_jobs_status_idx
  on public.strategy_backtest_jobs (status, requested_at desc);

create index if not exists strategy_backtest_jobs_strategy_idx
  on public.strategy_backtest_jobs (strategy_id, requested_at desc);

alter table public.strategy_registry enable row level security;
alter table public.strategy_backtest_jobs enable row level security;

do $$
declare
  app_role text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);
      execute format('grant select, insert, update, delete on table public.strategy_registry to %I', app_role);
      execute format('grant select, insert, update, delete on table public.strategy_backtest_jobs to %I', app_role);
      execute format('drop policy if exists %I on public.strategy_registry', app_role || '_strategy_registry_all');
      execute format('drop policy if exists %I on public.strategy_backtest_jobs', app_role || '_strategy_backtest_jobs_all');
      execute format(
        'create policy %I on public.strategy_registry for all to %I using (true) with check (true)',
        app_role || '_strategy_registry_all',
        app_role
      );
      execute format(
        'create policy %I on public.strategy_backtest_jobs for all to %I using (true) with check (true)',
        app_role || '_strategy_backtest_jobs_all',
        app_role
      );
    end if;
  end loop;
end $$;
