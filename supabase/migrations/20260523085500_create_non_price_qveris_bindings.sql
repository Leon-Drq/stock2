create table if not exists public.raw_market_data (
  source_id text not null,
  symbol text not null,
  as_of date not null,
  provider text not null default 'qveris',
  tool_id text,
  tool_name text,
  query text,
  params jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  payload_hash text,
  fetched_at timestamptz not null default now(),
  primary key (source_id, symbol, as_of, provider)
);

create index if not exists raw_market_data_source_date_idx
  on public.raw_market_data (source_id, as_of desc);

create table if not exists public.factor_bindings (
  factor_id text not null,
  source_id text not null,
  provider text not null default 'qveris',
  tool_id text not null,
  tool_name text,
  query text not null,
  required_fields text[] not null default '{}',
  params_schema jsonb not null default '[]'::jsonb,
  sample_params jsonb not null default '{}'::jsonb,
  sample_payload jsonb,
  status text not null default 'discovered',
  confidence double precision not null default 0,
  error text,
  last_discovered_at timestamptz not null default now(),
  last_sampled_at timestamptz,
  primary key (factor_id, source_id, provider, tool_id)
);

create index if not exists factor_bindings_source_status_idx
  on public.factor_bindings (source_id, status, last_discovered_at desc);

create table if not exists public.stock_sentiment (
  symbol text not null,
  event_time timestamptz not null,
  source_id text not null default 'news',
  sentiment double precision,
  title text,
  payload jsonb not null,
  source text not null default 'qveris',
  fetched_at timestamptz not null default now(),
  primary key (symbol, event_time, source_id)
);

create index if not exists stock_sentiment_symbol_time_idx
  on public.stock_sentiment (symbol, event_time desc);

do $$
declare
  app_role text;
  table_name text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);

      foreach table_name in array array['raw_market_data', 'factor_bindings', 'stock_sentiment']
      loop
        if to_regclass(format('public.%I', table_name)) is not null then
          execute format('grant select, insert, update, delete on table public.%I to %I', table_name, app_role);

          begin
            if app_role = 'stock_radar_backend' then
              execute format(
                'create policy %I on public.%I for all to %I using (true) with check (true)',
                table_name || '_backend_access',
                table_name,
                app_role
              );
            else
              execute format(
                'create policy %I on public.%I for all to %I using (true) with check (true)',
                table_name || '_service_role_all',
                table_name,
                app_role
              );
            end if;
          exception
            when duplicate_object then null;
          end;
        end if;
      end loop;
    end if;
  end loop;
end $$;

alter table public.raw_market_data enable row level security;
alter table public.factor_bindings enable row level security;
alter table public.stock_sentiment enable row level security;
