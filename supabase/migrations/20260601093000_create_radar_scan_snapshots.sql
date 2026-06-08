create table if not exists public.radar_scan_snapshots (
  snapshot_key text primary key,
  trade_date date not null,
  generated_at timestamptz not null,
  expires_at timestamptz not null,
  scan_universe_size integer,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists radar_scan_snapshots_trade_date_idx
  on public.radar_scan_snapshots (trade_date desc, generated_at desc);

create index if not exists radar_scan_snapshots_expires_at_idx
  on public.radar_scan_snapshots (expires_at);

alter table public.radar_scan_snapshots enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stock_radar_backend') then
    grant select, insert, update, delete on table public.radar_scan_snapshots to stock_radar_backend;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'radar_scan_snapshots'
        and policyname = 'radar_scan_snapshots_backend_access'
    ) then
      create policy radar_scan_snapshots_backend_access
        on public.radar_scan_snapshots
        for all
        to stock_radar_backend
        using (true)
        with check (true);
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.radar_scan_snapshots to service_role;
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'radar_scan_snapshots'
        and policyname = 'radar_scan_snapshots_service_role_all'
    ) then
      create policy radar_scan_snapshots_service_role_all
        on public.radar_scan_snapshots
        for all
        to service_role
        using (true)
        with check (true);
    end if;
  end if;
end $$;
