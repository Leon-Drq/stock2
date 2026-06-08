create table if not exists public.qveris_usage_ledger (
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

create index if not exists qveris_usage_ledger_created_idx on public.qveris_usage_ledger (created_at desc);
create index if not exists qveris_usage_ledger_category_idx on public.qveris_usage_ledger (category, created_at desc);
create index if not exists qveris_usage_ledger_source_idx on public.qveris_usage_ledger (source, created_at desc);
create index if not exists qveris_usage_ledger_tool_idx on public.qveris_usage_ledger (tool_id, created_at desc);

alter table public.qveris_usage_ledger enable row level security;

do $$
declare
  app_role text;
  policy_name text;
begin
  foreach app_role in array array['stock_radar_backend', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = app_role) then
      execute format('grant usage on schema public to %I', app_role);
      execute format('grant select, insert, update, delete on table public.qveris_usage_ledger to %I', app_role);
      execute format('grant usage, select on sequence public.qveris_usage_ledger_id_seq to %I', app_role);

      if app_role = 'stock_radar_backend' then
        policy_name := 'qveris_usage_ledger_backend_access';
      else
        policy_name := 'qveris_usage_ledger_service_role_all';
      end if;

      if not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'qveris_usage_ledger'
          and policyname = policy_name
      ) then
        execute format(
          'create policy %I on public.qveris_usage_ledger for all to %I using (true) with check (true)',
          policy_name,
          app_role
        );
      end if;
    end if;
  end loop;
end $$;
