create table if not exists public.stock_daily_bars (
  symbol text not null,
  trade_date date not null,
  name text,
  industry text,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  volume double precision not null,
  amount double precision,
  pre_close double precision,
  change double precision,
  change_pct double precision,
  turnover_ratio double precision,
  adjustment_factor double precision,
  source text not null default 'qveris',
  tool_id text,
  fetched_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create index if not exists stock_daily_bars_trade_date_idx
  on public.stock_daily_bars (trade_date desc);

create table if not exists public.stock_daily_indicators (
  symbol text not null,
  trade_date date not null,
  ma5 double precision,
  ma10 double precision,
  ma20 double precision,
  ma60 double precision,
  ret1 double precision,
  ret5 double precision,
  ret20 double precision,
  ret60 double precision,
  volume_ma20 double precision,
  volume_ratio20 double precision,
  vwap_proxy double precision,
  atr14 double precision,
  volatility20 double precision,
  rsi14 double precision,
  updated_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create table if not exists public.factor_values (
  factor_id text not null,
  symbol text not null,
  as_of date not null,
  value double precision not null,
  source text not null default 'qveris-derived',
  updated_at timestamptz not null default now(),
  primary key (factor_id, symbol, as_of)
);

create index if not exists factor_values_as_of_idx
  on public.factor_values (as_of desc, factor_id);

create table if not exists public.data_quality_snapshots (
  snapshot_date date primary key,
  generated_at timestamptz not null default now(),
  stock_pool_symbols integer not null,
  covered_symbols integer not null,
  bar_rows integer not null,
  latest_trade_date date,
  field_coverage jsonb not null,
  notes text[] not null default '{}',
  payload jsonb not null
);

create table if not exists public.stock_non_price_factors (
  source_id text not null,
  symbol text not null,
  as_of date not null,
  score double precision,
  payload jsonb not null,
  source text not null default 'qveris',
  fetched_at timestamptz not null default now(),
  primary key (source_id, symbol, as_of)
);

create index if not exists stock_non_price_factors_as_of_idx
  on public.stock_non_price_factors (as_of desc, source_id);

create table if not exists public.stock_events (
  event_id text primary key,
  symbol text not null,
  event_time timestamptz not null,
  event_type text not null,
  title text,
  sentiment double precision,
  payload jsonb not null,
  source text not null default 'qveris',
  fetched_at timestamptz not null default now()
);

create index if not exists stock_events_symbol_time_idx
  on public.stock_events (symbol, event_time desc);

create table if not exists public.stock_fundamentals (
  symbol text not null,
  report_period date not null,
  payload jsonb not null,
  source text not null default 'qveris',
  fetched_at timestamptz not null default now(),
  primary key (symbol, report_period)
);

do $$
declare
  app_role text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);
      execute format(
        'grant select, insert, update, delete on table %s to %I',
        'public.stock_daily_bars, public.stock_daily_indicators, public.factor_values, public.data_quality_snapshots, public.stock_non_price_factors, public.stock_events, public.stock_fundamentals',
        app_role
      );
    end if;
  end loop;
end $$;
