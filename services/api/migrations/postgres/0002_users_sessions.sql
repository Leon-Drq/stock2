create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_check check (role in ('admin', 'user')),
  constraint users_status_check check (status in ('active', 'disabled'))
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id, expires_at desc);
create index if not exists sessions_active_idx on sessions (expires_at desc) where revoked_at is null;

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  resource text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
