-- messages
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  content text not null,
  created_at timestamptz default now(),
  dos boolean default false
);

-- notes
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  password_hash text not null,
  created_at timestamptz default now()
);

-- admin passwords (main + duress rows)
create table if not exists admin_passwords (
  id uuid primary key default gen_random_uuid(),
  password_hash text not null,
  is_main boolean default false,
  is_duress boolean default false,
  requires_change boolean default false
);

-- duress events log
create table if not exists duress_events (
  id uuid primary key default gen_random_uuid(),
  triggered_at timestamptz default now(),
  resolved boolean default false
);

-- banned users
create table if not exists banned_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  reason text,
  banned_at timestamptz default now()
);

-- app_settings: generic key/value config
-- Trigger a forced admin password reset:
--   UPDATE app_settings SET value = 'true' WHERE key = 'force_password_reset';
-- On next successful login the admin will be routed to the change-password screen
-- and this flag is automatically cleared.
create table if not exists app_settings (
  key text primary key,
  value text not null
);

-- seed the force_password_reset flag (default off)
insert into app_settings (key, value)
values ('force_password_reset', 'false')
on conflict (key) do nothing;
