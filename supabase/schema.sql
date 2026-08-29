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
-- 'Merged' is a valid status value alongside Pending/Approved/Rejected — set when
-- an admin combines this circle into another (see routes/admin.js's /combine route).
alter table hubs add column if not exists merged_into_hub_id text references hubs(id);
alter table hubs add column if not exists merged_at text;
-- Editions: each hub belongs to the edition it registered for (default 1 for
-- rows created before the Editions feature). carried_over_from_hub_id /
-- carried_over_to_hub_id link a leader's hub row across editions when an
-- admin uses "Move to Next Edition" (routes/admin.js) — mirrors
-- merged_into_hub_id above but across editions instead of within one.
alter table hubs add column if not exists edition integer not null default 1;
alter table hubs add column if not exists carried_over_from_hub_id text references hubs(id);
alter table hubs add column if not exists carried_over_to_hub_id text references hubs(id);

-- One row per /hubs/:id/combine call — records exactly which participants moved
-- so a later "Undo Merge" can move back precisely those still sitting in the
-- surviving hub (not anyone who joined it independently since, and not anyone
-- who's since been manually transferred elsewhere). reverted_at IS NULL means
-- this merge is still in effect; at most one such row per closing hub at a time
-- (the "Combine" action is only offered on Approved hubs, and a hub already
-- Merged can't be combined again until it's reverted).
create table if not exists hub_merges (
  id text primary key,
  closing_hub_id text not null references hubs(id),
  target_hub_id text not null references hubs(id),
  participant_ids jsonb not null default '[]'::jsonb,
  merged_at text not null,
  reverted_at text
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
  hub_id text not null references hubs(id),
  confirmation_sent_at text
);
alter table participants add column if not exists confirmation_sent_at text;
alter table participants add column if not exists edition integer not null default 1;
alter table participants add column if not exists event_reminder_sent_at text;

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
  ('participant_form_open', 'true'),
  ('active_edition', '1')
on conflict (key) do nothing;

-- One row per edition, holding the theme/event details captured when an admin
-- starts that edition (routes/admin.js POST /editions/start, PATCH
-- /editions/:edition). The active edition number itself lives in `settings`
-- (key 'active_edition') — this table is edition metadata, not the pointer.
create table if not exists editions (
  edition integer primary key,
  theme_title text,
  theme_tagline text,
  event_date text,
  event_time_start text,
  event_time_end text
);

-- ── NFP Circle CRM ─────────────────────────────────────────────────────────────
-- Cold-outreach contact list (NFP Members / QPFP Certificants) and the campaigns
-- used to email them, city by city, about open Circles. Deliberately separate from
-- hubs/participants — these are people who have not registered for anything yet.

create table if not exists crm_contacts (
  id text primary key,                 -- NFP-CRM-YYYYMMDD-NNNN
  full_name text not null,
  email text not null,
  mobile text,
  city text,
  city_key text,                       -- normalized key, used for campaign matching
  membership text,                     -- 'Member' | 'QPFP' | 'Member + QPFP'
  batch text,                          -- "Their Batch" (QPFP batch), nullable
  batch_status text,                   -- "Batch Status" from the sheet — 'Running' | 'Closed', nullable
  source text,                         -- e.g. filename of the import
  imported_at text not null,
  unsubscribed_at text,
  created_at text not null,
  updated_at text not null
);
create unique index if not exists crm_contacts_email_idx on crm_contacts (lower(email));
create index if not exists crm_contacts_city_key_idx on crm_contacts (city_key);
alter table crm_contacts add column if not exists batch_status text;

create table if not exists crm_campaigns (
  id text primary key,                 -- NFP-CRMC-YYYYMMDD-NNNN
  name text not null,
  status text not null default 'Draft',   -- Draft | Sending | Paused | Completed | Cancelled
  target_mode text not null default 'manual', -- manual (fixed target_cities/hub_ids for everyone) | auto (each recipient gets their own city's open circles)
  target_cities jsonb not null,        -- manual mode only: raw city strings selected from crm_contacts
  hub_ids jsonb not null,              -- manual mode only: hubs featured in the email
  target_batches jsonb not null default '[]'::jsonb,      -- optional narrowing filter, e.g. ["Batch 11","Batch 12"] — applies in both manual and auto mode; empty = no batch restriction
  target_memberships jsonb not null default '[]'::jsonb,  -- optional narrowing filter, e.g. ["QPFP"] — empty = no membership restriction
  target_batch_statuses jsonb not null default '[]'::jsonb, -- optional narrowing filter, e.g. ["Running"] — empty = no batch-status restriction
  subject text not null,
  intro_html text,                     -- optional override of the default "what/why" blurb
  batch_size integer not null default 25,
  interval_minutes integer not null default 15,
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at text not null,
  started_at text,
  completed_at text,
  last_batch_at text
);
alter table crm_campaigns add column if not exists target_mode text not null default 'manual';
alter table crm_campaigns add column if not exists target_batches jsonb not null default '[]'::jsonb;
alter table crm_campaigns add column if not exists target_memberships jsonb not null default '[]'::jsonb;
alter table crm_campaigns add column if not exists target_batch_statuses jsonb not null default '[]'::jsonb;
alter table crm_campaigns add column if not exists exclude_hub_leaders boolean not null default true;
alter table crm_campaigns add column if not exists exclude_registered_participants boolean not null default true;

create table if not exists crm_campaign_recipients (
  id bigserial primary key,
  campaign_id text not null references crm_campaigns(id) on delete cascade,
  contact_id text not null references crm_contacts(id) on delete cascade,
  status text not null default 'Pending',  -- Pending | Claimed | Sent | Failed | Skipped
  sent_at text,
  error text,
  unique (campaign_id, contact_id)
);
alter table crm_campaign_recipients add column if not exists claimed_at timestamptz;

-- ── NFP Live Poll ──────────────────────────────────────────────────────────────
-- Real-time audience polling for live NFP Circle events. Deliberately separate
-- from the hubs/participants CRM tables above — a live-poll participant may or
-- may not be a registered Circle participant. Served by the `live-poll/` app,
-- a SEPARATE Vercel project from the main NFP Circles backend (isolates a
-- 700-phone polling spike from hub/participant registration traffic), but the
-- SAME Supabase Postgres database via the same DATABASE_URL.

create table if not exists poll_sessions (
  id text primary key,                    -- NFP-POLL-YYYYMMDD-NNNN
  code text unique not null,              -- 6-digit join code shown on the presenter screen / QR
  title text not null,
  status text not null default 'draft',   -- draft | live | ended
  current_question_id text,
  created_at text not null,
  started_at text,
  ended_at text
);

create table if not exists poll_questions (
  id text primary key,                    -- NFP-PQ-YYYYMMDD-NNNN
  session_id text not null references poll_sessions(id),
  order_index integer not null,
  type text not null,                     -- multiple_choice | true_false | rating | word_cloud | quiz | ranking | pulse
  prompt text not null,
  options jsonb,                          -- choice list / rating bounds / ranking items — shape depends on type
  correct_option text,                    -- quiz only
  status text not null default 'pending', -- pending | live | closed
  revealed boolean not null default false
);
create index if not exists poll_questions_session_idx on poll_questions (session_id, order_index);

-- One row per person who joins a session (via the join screen). Re-identified
-- across page reloads by device_token (random, stored in the browser), not a
-- login — so a participant can leave and come back to the same session as the
-- same person without re-entering their details.
create table if not exists poll_participants (
  id text primary key,                    -- NFP-PP-YYYYMMDD-NNNN
  session_id text not null references poll_sessions(id),
  full_name text not null,
  phone text,
  join_source text not null,              -- manual | circle_leader
  circle_leader_hub_id text references hubs(id),
  device_token text not null,
  joined_at text not null,
  unique (session_id, device_token)
);

-- One vote per participant per question — the unique constraint is the
-- vote-integrity backbone (a repeat POST from the same device just no-ops
-- rather than double-counting). `answer` is intentionally never joined back
-- to full_name/phone in any PUBLIC endpoint response — only the host export
-- (authenticated) reads across poll_votes + poll_participants together.
create table if not exists poll_votes (
  id text primary key,                    -- NFP-PV-YYYYMMDD-NNNN
  question_id text not null references poll_questions(id),
  participant_id text not null references poll_participants(id),
  answer jsonb not null,
  submitted_at text not null,
  unique (question_id, participant_id)
);
create index if not exists poll_votes_question_idx on poll_votes (question_id);

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
alter table public.crm_contacts             enable row level security;
alter table public.crm_campaigns            enable row level security;
alter table public.crm_campaign_recipients  enable row level security;
alter table public.hub_merges               enable row level security;
alter table public.editions                 enable row level security;
alter table public.poll_sessions      enable row level security;
alter table public.poll_questions     enable row level security;
alter table public.poll_participants  enable row level security;
alter table public.poll_votes         enable row level security;
