// db.js — Postgres (Supabase) connection + tiny query helpers.
//
// Replaces the old better-sqlite3 file-based database. Postgres talks over the
// network, so every helper here is ASYNC — callers must `await` them.
//
// Connection comes from the DATABASE_URL env var (the Supabase "Transaction"
// pooler string, port 6543). Locally, set it in backend/.env; on Vercel, set it
// in Project Settings → Environment Variables.
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    '[db] DATABASE_URL is not set. Set it in backend/.env (local) or Vercel env vars (prod).'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requires SSL. The pooler presents a cert that Node does not have in
  // its default trust store, so we disable strict verification for the connection.
  ssl: { rejectUnauthorized: false },
  // Keep the pool tiny: serverless functions each open their own pool, and the
  // Supabase pooler caps total connections. A small max avoids exhausting it.
  max: 3,
  // Fail fast instead of hanging forever if the DB can't be reached (e.g. a
  // missing/wrong DATABASE_URL). Without this, a bad connection makes the whole
  // serverless function time out silently.
  connectionTimeoutMillis: 8000,
});

// Surface idle-client errors instead of crashing the function process.
pool.on('error', (err) => {
  console.error('[db] idle pool client error:', err.message);
});

// Run a raw query. Returns the full pg result ({ rows, rowCount, ... }).
function query(text, params) {
  return pool.query(text, params);
}

// Return the first row, or null if there are none. Mirrors better-sqlite3 .get().
async function get(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

// Return all rows as an array. Mirrors better-sqlite3 .all().
async function all(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Run a write (INSERT/UPDATE/DELETE). Mirrors better-sqlite3 .run().
function run(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, get, all, run };
