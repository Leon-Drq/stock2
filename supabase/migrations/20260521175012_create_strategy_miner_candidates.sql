create table if not exists public.strategy_miner_candidates (
  candidate_id text primary key,
  strategy_id text not null,
  strategy_name text not null,
  source_kind text not null,
  source_name text not null,
  source_url text,
  source_query text,
  source_stars integer,
  source_language text,
  source_license text,
  hypothesis text not null,
  factors text[] not null default '{}',
  frequency text not null,
  dsl jsonb not null default '{}'::jsonb,
  status text not null default 'untested',
  annual_return double precision,
  max_drawdown double precision,
  sharpe double precision,
  win_rate double precision,
  admission_status text,
  admission_score integer,
  admission_reason text,
  report_payload jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null,
  backtested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint strategy_miner_candidates_status_check
    check (status in ('promoted', 'watchlist', 'rejected', 'untested'))
);

create index if not exists strategy_miner_candidates_status_idx
  on public.strategy_miner_candidates (status, admission_score desc, annual_return desc);

create index if not exists strategy_miner_candidates_source_idx
  on public.strategy_miner_candidates (source_kind, source_stars desc nulls last);

alter table public.strategy_miner_candidates enable row level security;

do $$
declare
  app_role text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);
      execute format('grant select, insert, update, delete on table public.strategy_miner_candidates to %I', app_role);
      execute format('drop policy if exists %I on public.strategy_miner_candidates', app_role || '_all');
      execute format(
        'create policy %I on public.strategy_miner_candidates for all to %I using (true) with check (true)',
        app_role || '_all',
        app_role
      );
    end if;
  end loop;
end $$;
