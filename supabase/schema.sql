-- DreamTeam Manager — license tables (run once in the Supabase SQL editor).
-- The shipped app never reads these tables directly; only the Edge Functions (service role) do.
-- Row Level Security is on with NO public policy, so the shipped anon key cannot read or write them.

create table if not exists public.licenses (
  key              text primary key,
  label            text,                         -- who this key is for (your note)
  edition          text not null default 'basic' check (edition in ('pro','basic')),
  expires_at       timestamptz,                  -- null = perpetual; a date = time-limited
  revoked          boolean not null default false,
  max_machines     int not null default 1,       -- 1 = one PC per key (anti-sharing)
  require_approval boolean not null default false,-- true = a new PC must be approved in the panel first
  created_at       timestamptz not null default now()
);

create table if not exists public.machines (
  id           uuid primary key default gen_random_uuid(),
  key          text not null references public.licenses(key) on delete cascade,
  machine      text not null,                 -- the app's anonymous fingerprint (no personal data)
  label        text,                          -- a name YOU type in the panel ("Ali - laptop")
  edition      text,                          -- the edition this PC last reported
  blocked      boolean not null default false,-- you blocked this PC
  approved     boolean not null default false,-- you approved this PC (matters when require_approval)
  user_ids     text[] default '{}',           -- the game account ids seen on this PC
  app_version  text,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  unique (key, machine)
);

alter table public.licenses enable row level security;
alter table public.machines enable row level security;
-- (no policies on purpose: anon/public cannot touch these; the Edge Functions bypass RLS)

-- To make a key:        insert into licenses (key, label, edition) values ('ABCD-1234', 'Ali', 'pro');
-- To make a monthly key: insert into licenses (key, label, edition, expires_at) values ('...', 'Veli', 'basic', now() + interval '30 days');
-- To block someone:      update licenses set revoked = true where key = '...';
-- To free a machine:     delete from machines where key = '...';
-- (the full-edition panel does all of this for you through the license-admin function)

-- Some projects create these tables without the Supabase role grants ("permission denied for
-- table"). Run this too; RLS still keeps anon/authenticated out (no policy), service_role bypasses it.
grant all privileges on table public.licenses to service_role, anon, authenticated;
grant all privileges on table public.machines to service_role, anon, authenticated;
