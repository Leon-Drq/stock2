do $$
begin
  if to_regclass('public.market_index_bars') is not null then
    alter table public.market_index_bars enable row level security;

    if exists (select 1 from pg_roles where rolname = 'stock_radar_backend') then
      grant usage on schema public to stock_radar_backend;
      grant select, insert, update, delete on table public.market_index_bars to stock_radar_backend;

      drop policy if exists market_index_bars_backend_access on public.market_index_bars;
      create policy market_index_bars_backend_access
        on public.market_index_bars
        for all
        to stock_radar_backend
        using (true)
        with check (true);
    end if;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant usage on schema public to service_role;
      grant select, insert, update, delete on table public.market_index_bars to service_role;

      drop policy if exists market_index_bars_service_role_all on public.market_index_bars;
      create policy market_index_bars_service_role_all
        on public.market_index_bars
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;
end $$;
