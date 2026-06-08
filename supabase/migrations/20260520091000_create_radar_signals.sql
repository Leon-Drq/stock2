create table if not exists public.radar_signals (
  signal_id text primary key,
  ticker text not null,
  name text,
  exchange text,
  strategy_id text,
  strategy_name text,
  signal_kind text,
  signal_level text,
  buy_point text,
  lifecycle_status text not null default 'open',
  first_triggered_at timestamptz not null,
  last_seen_at timestamptz not null,
  closed_at timestamptz,
  trigger_price double precision not null,
  latest_price double precision,
  return_since_signal_pct double precision,
  mfe_pct double precision,
  mae_pct double precision,
  stop_loss_price double precision,
  target_price double precision,
  close_reason text,
  note text,
  payload text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radar_signals_lifecycle_status_check
    check (lifecycle_status in ('open', 'stopped', 'target-hit', 'expired'))
);

create index if not exists radar_signals_last_seen_idx
  on public.radar_signals (last_seen_at desc);

create index if not exists radar_signals_status_idx
  on public.radar_signals (lifecycle_status, last_seen_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_radar_backend') then
    grant usage on schema public to stock_radar_backend;
    grant select, insert, update, delete on public.radar_signals to stock_radar_backend;
  end if;
end $$;
