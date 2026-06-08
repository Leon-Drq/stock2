do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'stock_radar_cache',
    'stock_daily_bars',
    'stock_daily_indicators',
    'factor_values',
    'data_quality_snapshots',
    'stock_non_price_factors',
    'stock_events',
    'stock_fundamentals',
    'trading_calendar',
    'market_index_bars'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I on public.%I', table_name || '_stock_radar_backend_all', table_name);
    end if;
  end loop;

  if to_regclass('public.radar_signals') is not null then
    alter table public.radar_signals enable row level security;
  end if;
end $$;

do $$
declare
  app_role text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role)
       and to_regclass('public.radar_signals') is not null then
      execute format('grant usage on schema public to %I', app_role);
      execute format('grant select, insert, update, delete on table public.radar_signals to %I', app_role);

      begin
        if app_role = 'stock_radar_backend' then
          execute format(
            'create policy %I on public.radar_signals for all to %I using (true) with check (true)',
            'radar_signals_backend_access',
            app_role
          );
        else
          execute format(
            'create policy %I on public.radar_signals for all to %I using (true) with check (true)',
            'radar_signals_service_role_all',
            app_role
          );
        end if;
      exception
        when duplicate_object then null;
      end;
    end if;
  end loop;
end $$;
