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

alter table qveris_usage_ledger add column if not exists execution_id text;
alter table qveris_usage_ledger add column if not exists tool_id text;
alter table qveris_usage_ledger add column if not exists search_id text;
alter table qveris_usage_ledger add column if not exists session_id_hash text;
alter table qveris_usage_ledger add column if not exists source text not null default 'unknown';
alter table qveris_usage_ledger add column if not exists category text not null default 'unknown';
alter table qveris_usage_ledger add column if not exists status text not null default 'success';
alter table qveris_usage_ledger add column if not exists success boolean not null default false;
alter table qveris_usage_ledger add column if not exists started_at timestamptz;
alter table qveris_usage_ledger add column if not exists finished_at timestamptz;
alter table qveris_usage_ledger add column if not exists elapsed_time_ms integer;
alter table qveris_usage_ledger add column if not exists qveris_elapsed_time_ms integer;
alter table qveris_usage_ledger add column if not exists timeout_ms integer;
alter table qveris_usage_ledger add column if not exists max_response_size integer;
alter table qveris_usage_ledger add column if not exists symbols_count integer not null default 0;
alter table qveris_usage_ledger add column if not exists billing_credits double precision;
alter table qveris_usage_ledger add column if not exists cost double precision;
alter table qveris_usage_ledger add column if not exists billing_summary text;
alter table qveris_usage_ledger add column if not exists error_message text;
alter table qveris_usage_ledger add column if not exists parameters_summary jsonb not null default '{}'::jsonb;
alter table qveris_usage_ledger add column if not exists created_at timestamptz not null default now();

update qveris_usage_ledger set tool_id = 'unknown' where tool_id is null;
alter table qveris_usage_ledger alter column tool_id set not null;

update qveris_usage_ledger set started_at = coalesce(started_at, created_at, now()) where started_at is null;
alter table qveris_usage_ledger alter column started_at set not null;

update qveris_usage_ledger set finished_at = coalesce(finished_at, started_at, created_at, now()) where finished_at is null;
alter table qveris_usage_ledger alter column finished_at set not null;

create index if not exists qveris_usage_ledger_created_idx on qveris_usage_ledger (created_at desc);
create index if not exists qveris_usage_ledger_category_idx on qveris_usage_ledger (category, created_at desc);
create index if not exists qveris_usage_ledger_source_idx on qveris_usage_ledger (source, created_at desc);
create index if not exists qveris_usage_ledger_tool_idx on qveris_usage_ledger (tool_id, created_at desc);
