-- NFP Circles — Database schema (Postgres / Supabase)
-- Source of truth for the database shape. Whenever you change the DB,
-- update this file AND commit it, so the repo records how the schema evolved.
--
-- Translated from the original SQLite schema in backend/db.js.
-- Only change: SQLite REAL -> Postgres "double precision".

-- Hub leader registrations
create table if not exists hubs (
  id text primary key,
  submitted_at text not null,
  last_updated text,
  status text not null default 'Pending',
  full_name text not null,
  email text not null,
  mobile text not null,
  membership text not null,
  city text not null,
  area text not null,
  address text,
  pincode text not null,
  venue_type text not null,
  capacity text not null,
  hosted_before text,
  hosting_frequency text,
  lat double precision,
  lng double precision,
  roster_sent_at text,
  poc_role text,
  pending_change_summary jsonb,
  change_notified_at text
);

-- Columns added after the table's initial creation — `alter table ... add column
-- if not exists` so re-running this file against the live DB is a no-op if
-- already applied, but still brings an older DB up to date.
alter table hubs add column if not exists poc_role text;
alter table hubs add column if not exists pending_change_summary jsonb;
alter table hubs add column if not exists change_notified_at text;

-- Participant registrations (each tied to an approved hub)
create table if not exists participants (
  id text primary key,
  registered_at text not null,
  status text not null default 'Confirmed',
  full_name text not null,
  email text not null,
  mobile text not null,
  membership text not null,
  note text,
  hub_id text not null references hubs(id)
);

-- Geocoding cache: pincode -> lat/lng, so we don't re-call the geocoder
create table if not exists pincode_cache (
  pincode text primary key,
  lat double precision not null,
  lng double precision not null,
  cached_at text not null
);

-- Key/value platform settings. Used to open/close the public forms from admin.
-- Keys: 'hub_form_open', 'participant_form_open'  (value: 'true' | 'false')
create table if not exists settings (
  key text primary key,
  value text not null
);
insert into settings (key, value) values
  ('hub_form_open', 'true'),
  ('participant_form_open', 'true')
on conflict (key) do nothing;

-- ── Row Level Security ────────────────────────────────────────────────────────
-- All tables must have RLS enabled because Supabase exposes the public schema
-- via PostgREST. With RLS on and no policies defined, PostgREST's anon/
-- authenticated roles are denied all access by default.
--
-- Our backend connects as the postgres superuser (Transaction Pooler URL),
-- which bypasses RLS — so the API is completely unaffected.
alter table public.hubs            enable row level security;
alter table public.participants     enable row level security;
alter table public.pincode_cache    enable row level security;
alter table public.settings         enable row level security;
