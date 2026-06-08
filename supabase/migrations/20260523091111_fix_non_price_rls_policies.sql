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
        'raw_market_data',
        'factor_bindings',
        'stock_non_price_factors',
        'stock_events',
        'stock_sentiment',
        'stock_fundamentals',
        'factor_values'
      ]
      loop
        if to_regclass(format('public.%I', table_name)) is not null then
          begin
            execute format('alter table public.%I enable row level security', table_name);
          exception
            when insufficient_privilege then null;
          end;

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
