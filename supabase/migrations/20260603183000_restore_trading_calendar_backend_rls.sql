do $$
begin
  if to_regclass('public.trading_calendar') is not null then
    alter table public.trading_calendar enable row level security;

    if exists (select 1 from pg_roles where rolname = 'stock_radar_backend') then
      grant usage on schema public to stock_radar_backend;
      grant select, insert, update, delete on table public.trading_calendar to stock_radar_backend;

      drop policy if exists trading_calendar_backend_access on public.trading_calendar;
      create policy trading_calendar_backend_access
        on public.trading_calendar
        for all
        to stock_radar_backend
        using (true)
        with check (true);
    end if;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      grant usage on schema public to service_role;
      grant select, insert, update, delete on table public.trading_calendar to service_role;

      drop policy if exists trading_calendar_service_role_all on public.trading_calendar;
      create policy trading_calendar_service_role_all
        on public.trading_calendar
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;
end $$;
