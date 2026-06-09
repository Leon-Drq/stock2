create table if not exists plans (
  id text primary key,
  name text not null,
  monthly_credits integer not null default 0,
  price_cents integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id text references plans(id),
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount integer not null,
  kind text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  feature text not null,
  amount integer not null default 0,
  status text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into plans (id, name, monthly_credits, price_cents, status)
values ('free', 'Free', 100, 0, 'active')
on conflict (id) do nothing;
