create table if not exists stock_radar_cache (
  cache_key text primary key,
  value text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists stock_radar_cache_expires_idx on stock_radar_cache (expires_at);

create table if not exists radar_signals (
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
  updated_at timestamptz not null default now()
);

create index if not exists radar_signals_last_seen_idx on radar_signals (last_seen_at desc);
create index if not exists radar_signals_status_idx on radar_signals (lifecycle_status, last_seen_at desc);

create table if not exists stock_daily_bars (
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
  limit_up double precision,
  limit_down double precision,
  is_limit_up boolean,
  is_limit_down boolean,
  is_suspended boolean,
  source text not null default 'qveris',
  tool_id text,
  fetched_at timestamptz not null default now(),
  primary key (symbol, trade_date)
);

create table if not exists stock_daily_indicators (
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

create table if not exists factor_values (
  factor_id text not null,
  symbol text not null,
  as_of date not null,
  value double precision not null,
  source text not null default 'qveris-derived',
  updated_at timestamptz not null default now(),
  primary key (factor_id, symbol, as_of)
);

create table if not exists factor_recipes (
  factor_id text not null,
  version text not null default 'v1',
  factor_name text not null,
  category text,
  formula text not null,
  implementation text,
  status text not null,
  source text,
  strategy_id text,
  strategy_name text,
  timeframe text,
  required_fields text[] not null default '{}',
  source_ids text[] not null default '{}',
  dsl jsonb not null default '{}'::jsonb,
  binding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (factor_id, version)
);

create table if not exists data_quality_snapshots (
  snapshot_date date primary key,
  generated_at timestamptz not null default now(),
  stock_pool_symbols integer not null,
  covered_symbols integer not null,
  bar_rows integer not null,
  latest_trade_date date,
  field_coverage jsonb not null,
  notes text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb
);

create table if not exists stock_non_price_factors (
  source_id text not null,
  symbol text not null,
  as_of date not null,
  score double precision,
  payload jsonb not null,
  source text not null default 'qveris',
  fetched_at timestamptz not null default now(),
  primary key (source_id, symbol, as_of)
);

create table if not exists stock_events (
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

create table if not exists stock_fundamentals (
  symbol text not null,
  report_period date not null,
  payload jsonb not null,
  source text not null default 'qveris',
  fetched_at timestamptz not null default now(),
  primary key (symbol, report_period)
);

create table if not exists trading_calendar (
  market text not null,
  trade_date date not null,
  is_open boolean not null,
  source text not null default 'derived',
  sample_symbols integer,
  updated_at timestamptz not null default now(),
  primary key (market, trade_date)
);

create table if not exists market_index_bars (
  index_code text not null,
  trade_date date not null,
  name text,
  open double precision,
  high double precision,
  low double precision,
  close double precision,
  volume double precision,
  amount double precision,
  change_pct double precision,
  source text not null default 'qveris',
  tool_id text,
  fetched_at timestamptz not null default now(),
  primary key (index_code, trade_date)
);

create table if not exists qveris_usage_ledger (
  id bigserial primary key,
  execution_id text,
  tool_id text not null,
  search_id text,
  session_id_hash text,
  source text not null default 'unknown',
  category text not null default 'unknown',
  status text not null default 'success',
  success boolean not null default false,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  elapsed_time_ms integer,
  qveris_elapsed_time_ms integer,
  timeout_ms integer,
  max_response_size integer,
  symbols_count integer not null default 0,
  billing_credits double precision,
  cost double precision,
  billing_summary text,
  error_message text,
  parameters_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
