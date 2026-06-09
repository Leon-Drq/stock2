create table if not exists cron_jobs (
  id text primary key,
  name text not null,
  target_path text not null,
  cron_expr text not null,
  enabled boolean not null default false,
  run_on_enable boolean not null default true,
  timeout_seconds integer not null default 120,
  max_instances integer not null default 1,
  last_run_at timestamptz,
  next_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cron_runs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null references cron_jobs(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null,
  http_status integer,
  error text,
  duration_ms integer
);

create index if not exists cron_runs_job_started_idx on cron_runs (job_id, started_at desc);

insert into cron_jobs (id, name, target_path, cron_expr, enabled, timeout_seconds)
values
  ('radar-cron', 'Radar refresh', '/api/radar/cron', '*/5 1-6 * * 1-5', false, 240),
  ('radar-track', 'Radar tracking', '/api/radar/track', '*/3 1-7 * * 1-5', false, 240),
  ('paper-trading-cron', 'Paper trading refresh', '/api/paper-trading/cron', '5-59/10 1-7 * * 1-5', false, 240),
  ('backtest-data-cron', 'Backtest data warmup', '/api/backtest-data/cron', '*/15 7-15 * * 1-5', false, 600),
  ('strategy-miner-cron', 'Strategy miner', '/api/strategy-miner/cron', '30 8 * * 0', false, 600),
  ('backtest-jobs-cron', 'Backtest jobs', '/api/backtest/jobs/cron', '15 9 * * 1-5', false, 600)
on conflict (id) do update set
  name = excluded.name,
  target_path = excluded.target_path,
  cron_expr = excluded.cron_expr,
  timeout_seconds = excluded.timeout_seconds,
  updated_at = now();
