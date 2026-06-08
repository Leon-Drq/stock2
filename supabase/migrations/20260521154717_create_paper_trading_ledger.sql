create table if not exists public.paper_accounts (
  account_id text primary key,
  account_scope text not null default 'default',
  strategy_id text not null,
  strategy_name text not null,
  admission_status text,
  admission_score integer not null default 0,
  initial_capital double precision not null default 1000000,
  started_at timestamptz not null,
  status text not null default 'active',
  last_synced_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_scope, strategy_id),
  constraint paper_accounts_status_check
    check (status in ('active', 'paused', 'closed'))
);

create table if not exists public.paper_equity_curve (
  account_id text not null references public.paper_accounts(account_id) on delete cascade,
  as_of date not null,
  equity double precision not null,
  cash double precision not null,
  invested_value double precision not null,
  benchmark_equity double precision,
  return_pct double precision not null default 0,
  drawdown_pct double precision not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, as_of)
);

create table if not exists public.paper_positions (
  account_id text not null references public.paper_accounts(account_id) on delete cascade,
  symbol text not null,
  name text not null,
  shares double precision not null default 0,
  weight_pct double precision not null default 0,
  cost_price double precision not null default 0,
  current_price double precision not null default 0,
  market_value double precision not null default 0,
  unrealized_pnl double precision not null default 0,
  pnl_pct double precision not null default 0,
  holding_days integer not null default 0,
  opened_at date,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (account_id, symbol)
);

create table if not exists public.paper_orders (
  order_id text primary key,
  account_id text not null references public.paper_accounts(account_id) on delete cascade,
  strategy_id text,
  source_signal_id text,
  symbol text not null,
  name text,
  side text not null,
  order_type text not null default 'market',
  status text not null default 'pending',
  requested_qty double precision,
  filled_qty double precision,
  limit_price double precision,
  filled_price double precision,
  submitted_at timestamptz not null default now(),
  filled_at timestamptz,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_orders_side_check
    check (side in ('buy', 'sell')),
  constraint paper_orders_status_check
    check (status in ('pending', 'filled', 'cancelled', 'rejected'))
);

create table if not exists public.paper_trades (
  trade_id text primary key,
  account_id text not null references public.paper_accounts(account_id) on delete cascade,
  order_id text references public.paper_orders(order_id) on delete set null,
  symbol text not null,
  name text,
  side text not null,
  qty double precision,
  price double precision,
  amount double precision,
  commission double precision not null default 0,
  trade_time timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint paper_trades_side_check
    check (side in ('buy', 'sell'))
);

create index if not exists paper_accounts_strategy_idx
  on public.paper_accounts (strategy_id, status);

create index if not exists paper_equity_curve_as_of_idx
  on public.paper_equity_curve (account_id, as_of desc);

create index if not exists paper_orders_account_status_idx
  on public.paper_orders (account_id, status, submitted_at desc);

create index if not exists paper_trades_account_time_idx
  on public.paper_trades (account_id, trade_time desc);

alter table public.paper_accounts enable row level security;
alter table public.paper_equity_curve enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_orders enable row level security;
alter table public.paper_trades enable row level security;

do $$
declare
  app_role text;
  table_name text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);

      foreach table_name in array array[
        'paper_accounts',
        'paper_equity_curve',
        'paper_positions',
        'paper_orders',
        'paper_trades'
      ]
      loop
        execute format('grant select, insert, update, delete on table public.%I to %I', table_name, app_role);
        execute format('drop policy if exists %I on public.%I', app_role || '_all', table_name);
        execute format(
          'create policy %I on public.%I for all to %I using (true) with check (true)',
          app_role || '_all',
          table_name,
          app_role
        );
      end loop;
    end if;
  end loop;
end $$;
