create table if not exists public.factor_recipes (
  factor_id text not null,
  version text not null default 'v1',
  factor_name text not null,
  category text,
  formula text not null,
  implementation text not null,
  status text not null default 'real',
  source text not null default 'strategy-lab',
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

create index if not exists factor_recipes_strategy_idx
  on public.factor_recipes (strategy_id, updated_at desc);

alter table public.factor_recipes enable row level security;

do $$
declare
  app_role text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);
      execute format('grant select, insert, update, delete on table public.factor_recipes to %I', app_role);

      begin
        if app_role = 'stock_radar_backend' then
          execute format(
            'create policy %I on public.factor_recipes for all to %I using (true) with check (true)',
            'factor_recipes_backend_access',
            app_role
          );
        else
          execute format(
            'create policy %I on public.factor_recipes for all to %I using (true) with check (true)',
            'factor_recipes_service_role_all',
            app_role
          );
        end if;
      exception
        when duplicate_object then null;
      end;
    end if;
  end loop;
end $$;
