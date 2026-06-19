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
  lng double precision
);

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
