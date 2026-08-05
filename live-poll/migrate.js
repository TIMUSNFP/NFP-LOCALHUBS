// migrate.js — applies the poll_ tables from ../supabase/schema.sql to the
// Supabase database pointed at by DATABASE_URL. Idempotent (IF NOT EXISTS
// everywhere), safe to re-run. Run with: node migrate.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const SQL = `
create table if not exists poll_sessions (
  id text primary key,
  code text unique not null,
  title text not null,
  status text not null default 'draft',
  current_question_id text,
  created_at text not null,
  started_at text,
  ended_at text
);

create table if not exists poll_questions (
  id text primary key,
  session_id text not null references poll_sessions(id),
  order_index integer not null,
  type text not null,
  prompt text not null,
  options jsonb,
  correct_option text,
  status text not null default 'pending',
  revealed boolean not null default false
);
create index if not exists poll_questions_session_idx on poll_questions (session_id, order_index);

create table if not exists poll_participants (
  id text primary key,
  session_id text not null references poll_sessions(id),
  full_name text not null,
  phone text,
  join_source text not null,
  circle_leader_hub_id text references hubs(id),
  device_token text not null,
  joined_at text not null,
  unique (session_id, device_token)
);

create table if not exists poll_votes (
  id text primary key,
  question_id text not null references poll_questions(id),
  participant_id text not null references poll_participants(id),
  answer jsonb not null,
  submitted_at text not null,
  unique (question_id, participant_id)
);
create index if not exists poll_votes_question_idx on poll_votes (question_id);

alter table public.poll_sessions      enable row level security;
alter table public.poll_questions     enable row level security;
alter table public.poll_participants  enable row level security;
alter table public.poll_votes         enable row level security;
`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query(SQL);
    console.log('[migrate] poll_ tables ready.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
