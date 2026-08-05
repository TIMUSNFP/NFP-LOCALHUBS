// poll-db.js — Postgres (Supabase) connection + tiny query helpers.
//
// Same pattern as ../backend/db.js: this app is a SEPARATE Vercel project
// from the main NFP Circles backend (isolates 700-phone polling load from
// hub/participant registration traffic), but talks to the SAME Supabase
// Postgres database via the same DATABASE_URL, just its own poll_ tables.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    '[poll-db] DATABASE_URL is not set. Set it in live-poll/.env (local) or Vercel env vars (prod).'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Kept tiny like the main backend — each serverless invocation opens its own
  // pool, and the Supabase pooler caps total connections across every project
  // sharing this database.
  max: 3,
  connectionTimeoutMillis: 8000,
});

pool.on('error', (err) => {
  console.error('[poll-db] idle pool client error:', err.message);
});

function query(text, params) {
  return pool.query(text, params);
}

async function get(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

async function all(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

function run(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, get, all, run };
