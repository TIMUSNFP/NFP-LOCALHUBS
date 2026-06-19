# NFP Circles — Migration Plan: Local → Vercel + Supabase

> **Goal:** Move the whole app off your laptop and onto the internet.
> Three pages + the API run on **Vercel** under `networkfp.com`, and the data lives in a **Supabase** Postgres database.
>
> **Decision locked in:** All-in-one on Vercel (the Express backend becomes "Vercel Functions"). One platform, one domain, one bill, and no CORS to configure.
>
> **Audience:** Written for a beginner. Every step explains the *why* before the *how*.

---

## Table of Contents
1. [The Big Picture](#1-the-big-picture)
2. [Why SQLite Can't Come With You](#2-why-sqlite-cant-come-with-you)
3. [What Changes — At a Glance](#3-what-changes--at-a-glance)
4. [Phase 1 — Set Up Supabase](#phase-1--set-up-supabase)
5. [Phase 2 — Swap the Data Layer (SQLite → Postgres)](#phase-2--swap-the-data-layer-sqlite--postgres)
6. [Phase 3 — Turn Express Into a Vercel Function](#phase-3--turn-express-into-a-vercel-function)
7. [Phase 4 — Deploy to Vercel](#phase-4--deploy-to-vercel)
8. [Phase 5 — Running Migrations in the Future](#phase-5--running-migrations-in-the-future)
9. [Security Checklist](#6-security-checklist)
10. [Final Folder Structure](#7-final-folder-structure)
11. [Quick Reference: Every File That Changes](#8-quick-reference-every-file-that-changes)

---

## 1. The Big Picture

### Right now (local only)
```
Your laptop runs:  Express server (backend/) ──> nfp.sqlite file on your disk
Your pages call:   http://192.168.29.34:4000   (your laptop's local WiFi address)
```
This only works while *your laptop* is on and on the same WiFi. The public cannot reach it.

### After this plan (live on the internet)
```
                  networkfp.com  (everything on Vercel)
                  ┌────────────────────────────────────────┐
  browser ──────> │ /participant      → static page         │
                  │ /circle-leaders   → static page         │
                  │ /admin            → static page          │
                  │ /api/hubs ...     → Vercel Function      │ (your Express code)
                  └───────────────────────┬─────────────────┘
                                          │ SQL over the internet
                                          ▼
                                   Supabase (Postgres database)
```

**Three things move:**
1. **Database:** SQLite file → Supabase Postgres (a real cloud database).
2. **Backend:** your Express server → a "Vercel Function" (same code, new home).
3. **Frontend:** the 3 pages get deployed; their `API_BASE` changes from your laptop's IP to just `/api`.

---

## 2. Why SQLite Can't Come With You

`backend/db.js` uses `better-sqlite3`, which reads and writes a **file** (`nfp.sqlite`) sitting next to your code.

Vercel Functions are **serverless** — they wake up for a fraction of a second to answer one request, then disappear. **Any file they write vanishes with them.** There is no permanent disk.

So a file-based database is impossible there. That is *exactly* why Supabase exists: a database that lives somewhere permanent, which your code talks to over the internet. Your instinct to use Supabase is correct.

---

## 3. What Changes — At a Glance

| Area | Before | After |
|---|---|---|
| Database engine | SQLite file (`better-sqlite3`) | Supabase Postgres (`pg`) |
| Where schema lives | inline in `backend/db.js` | `supabase/schema.sql` in repo + the live Supabase DB |
| DB calls | synchronous (`.get/.all/.run`) | async (`await db.get/all/run`) |
| Placeholders | `?` and `@name` | `$1, $2, $3 …` |
| Backend host | your laptop (`app.listen`) | Vercel Function (`api/index.js`) |
| Frontend host | local files | Vercel static hosting |
| `API_BASE` | `http://192.168.29.34:4000` | `''` (same site → `/api/...`) |
| CORS | needed | **not needed** (same origin) |
| Secrets | `backend/.env` | Vercel Environment Variables |

---

## Phase 1 — Set Up Supabase

> **You do this in the browser.** It also answers "where is the schema stored" and "how do migrations work."

### Step 1.1 — Create the project
1. Go to **supabase.com** → sign up (free) → **New Project**.
2. Name it (e.g. `nfp-circles`). Set a **database password** — **write it down**, you'll need it.
3. Pick a region near your users (e.g. **Mumbai / ap-south-1**).
4. Wait ~2 minutes for it to build.

### Step 1.2 — Create your tables
This is your exact current schema from `backend/db.js`, translated to Postgres (`REAL` → `double precision`; everything else identical).

1. Supabase → **SQL Editor** → **New query**.
2. Paste and **Run**:

```sql
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

create table if not exists pincode_cache (
  pincode text primary key,
  lat double precision not null,
  lng double precision not null,
  cached_at text not null
);
```

3. Check the **Table Editor** — you should see all 3 tables.

> 📁 **Save this SQL in your repo** as `supabase/schema.sql`. That file becomes your written source of truth for the database shape.

### Step 1.3 — Get the connection string (the secret link between code and DB)
1. Supabase → **Project Settings** (gear) → **Database** → **Connection string**.
2. **Choose the "Transaction" pooler tab (port `6543`)** — NOT the direct connection.

   **Why (beginner version):** Vercel Functions pop in and out constantly, each wanting its own phone line to the database. The direct connection has only a few lines and they'd run out instantly. The "pooler" is a receptionist who shares a small set of lines across thousands of quick calls. Serverless **must** use the pooler.
3. Copy the string. It looks like:
   ```
   postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
   ```
   Replace `[YOUR-PASSWORD]` with your Step 1.1 password.
4. **Save it** — this is your `DATABASE_URL`. Never commit it; it goes into Vercel's settings in Phase 4.

---

## Phase 2 — Swap the Data Layer (SQLite → Postgres)

> **This is code work.** Postgres talks over the internet, so every DB call becomes `async`, and placeholders become numbered.

### The 3 mechanical changes
| SQLite (now) | Postgres (after) |
|---|---|
| `db.prepare(sql).get(p)` | `await db.get(sql, [p])` |
| `db.prepare(sql).all(p)` | `await db.all(sql, [p])` |
| `db.prepare(sql).run(p)` | `await db.run(sql, [p])` |
| placeholders `?` and `@name` | `$1`, `$2`, `$3` … |
| each route handler | add `async` before it |

### Step 2.1 — Install the Postgres driver
In the `backend/` folder:
```bash
npm install pg
```

### Step 2.2 — Rewrite `backend/db.js` as a tiny Postgres wrapper
This keeps your routes nearly identical by giving you `get / all / run` helpers:
```js
// backend/db.js — Postgres (Supabase) connection
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  max: 3, // keep small — serverless opens many short-lived connections
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  get:   async (text, params) => (await pool.query(text, params)).rows[0] || null,
  all:   async (text, params) => (await pool.query(text, params)).rows,
  run:   (text, params) => pool.query(text, params),
};
```

### Step 2.3 — Update the 4 route files
Files: `backend/routes/hubs.js`, `participants.js`, `admin.js`, `geo.js`.

Each query gets `await` + numbered placeholders, and the handler becomes `async`.

**Example — `backend/routes/hubs.js` (single hub lookup):**
```js
// BEFORE
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM hubs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Hub not found' });
  res.json(hubRowToJson(row));
});

// AFTER
router.get('/:id', async (req, res) => {
  const row = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Hub not found' });
  res.json(hubRowToJson(row));
});
```

**Example — the big INSERT in `hubs.js`** changes its `@named` values to `$1 … $18`:
```js
// AFTER
await db.run(
  `INSERT INTO hubs (
    id, submitted_at, last_updated, status, full_name, email, mobile, membership,
    city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency, lat, lng
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
  [hub.id, hub.submitted_at, hub.last_updated, hub.status, hub.full_name, hub.email,
   hub.mobile, hub.membership, hub.city, hub.area, hub.address, hub.pincode,
   hub.venue_type, hub.capacity, hub.hosted_before, hub.hosting_frequency, hub.lat, hub.lng]
);
```

There are ~20 such queries across the 4 files. Mechanical but tedious. *(I can do all of these for you — see the end.)*

### Step 2.4 — Fix the "fire-and-forget" geocoding (important gotcha)
`backend/routes/hubs.js` currently geocodes the address *after* sending the response. On a serverless function, **the function freezes the moment it responds**, so that background update would silently never run.

**Fix:** do the geocoding *before* responding — `await` the coordinates, save them, then send the JSON. Hub submission gets slightly slower but actually works.

### Step 2.5 — Remove the SQLite leftovers
- Remove `better-sqlite3` from `backend/package.json`.
- Delete the `backend/data/` folder (the `.sqlite`, `-shm`, `-wal` files).
- Either delete `backend/seed.js` or convert it to a one-time Postgres seed you run manually. Remove its auto-run from the server bootstrap.

---

## Phase 3 — Turn Express Into a Vercel Function

### Step 3.1 — Stop the app from "listening"
On Vercel you don't call `app.listen()` — Vercel calls your app for you.

Split `backend/server.js`:
- Move everything that *builds* the Express app into `backend/app.js`, ending with `module.exports = app;`.
- Keep a tiny local-only `backend/server.js` that imports `app` and calls `app.listen()` so you can still run it on your laptop for testing.

```js
// backend/app.js  (builds and exports the Express app — NO app.listen here)
require('dotenv').config();
const express = require('express');
// ... all your routes/middleware ...
module.exports = app;
```
```js
// backend/server.js  (local testing only)
const app = require('./app');
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Local API on http://localhost:${PORT}`));
```

### Step 3.2 — Create the Vercel function entry point
At the repo root, make a folder `api/` with one file:
```js
// api/index.js — Vercel routes every /api/* request to your Express app
module.exports = require('../backend/app');
```

### Step 3.3 — Arrange folders so paths map to URLs
Move/rename your 3 site folders to the **repo root**, named exactly as the URLs you want:
```
participant/      (from sites/participant)   → networkfp.com/participant
circle-leaders/   (from sites/hub-leader)    → networkfp.com/circle-leaders
admin/            (from sites/admin)         → networkfp.com/admin
```
Putting them at the root means the browser finds `script.js`, images, etc. via simple relative paths — no path headaches.

### Step 3.4 — Add `vercel.json` at the repo root
```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api" }
  ]
}
```
Translation: anything starting with `/api/` goes to your Express function; everything else is served as a static file.

### Step 3.5 — Point the frontend at the new same-origin API
In **both** `participant/script.js` and `admin/script.js`, change the top line:
```js
const API_BASE = 'http://192.168.29.34:4000';   // ❌ your laptop
const API_BASE = '';                              // ✅ same site → calls /api/...
```
Because pages and API now share `networkfp.com`, **CORS disappears entirely.**

---

## Phase 4 — Deploy to Vercel

### Step 4.1 — Push to GitHub
```bash
git add .
git commit -m "Migrate to Vercel + Supabase"
git push
```
⚠️ **Confirm `.env` and `node_modules` are git-ignored** so secrets/junk never upload.

### Step 4.2 — Import into Vercel
1. **vercel.com** → sign in with GitHub → **Add New → Project** → pick your repo.
2. Framework preset: **Other** (plain HTML + a Node function). Click **Deploy**.

### Step 4.3 — Add Environment Variables (your secrets)
Vercel project → **Settings → Environment Variables**, add (same keys as `backend/.env`):

| Key | Value |
|---|---|
| `DATABASE_URL` | the Supabase **pooler** string from Step 1.3 |
| `JWT_SECRET` | a long random string (generate a fresh one) |
| `ADMIN_EMAIL` | your admin login email |
| `ADMIN_PASSWORD_HASH` | the bcrypt hash (same as now) |

Then **redeploy** so they take effect. You can drop `ALLOWED_ORIGINS`/CORS — it's same-origin now.

### Step 4.4 — Connect `networkfp.com`
Project → **Settings → Domains** → add `networkfp.com` → follow Vercel's DNS instructions at your registrar. Once verified, these are live:
- `networkfp.com/participant`
- `networkfp.com/circle-leaders`
- `networkfp.com/admin`

---

## Phase 5 — Running Migrations in the Future

A **migration** = a recorded change to your database's shape (add a column, new table, etc.).

### Option A — Supabase SQL Editor (simplest; use this now)
When you want a change, open **SQL Editor** and run it, e.g.:
```sql
alter table hubs add column whatsapp text;
```
**Always also paste that line into `supabase/schema.sql`** (or a new file like `supabase/migrations/0002_add_whatsapp.sql`) and commit it, so your repo records every change.

### Option B — Supabase CLI (proper migrations; when you grow)
```bash
supabase init
supabase migration new add_whatsapp_to_hubs   # creates a timestamped .sql file
# write your ALTER TABLE inside that file, then:
supabase db push                                # applies it to the cloud DB
```
Supabase tracks which migrations ran in a `schema_migrations` table, so each applies exactly once.

**Recommendation:** Use **Option A** now (changes are rare; it's dead simple). Graduate to **Option B** once changes get frequent or you add a teammate.

### Golden rule
> Whenever you change `xyz` in the database, **write the SQL into a file in your repo and commit it.** The database remembers the *current* shape; your repo remembers *how it got there*. That history is what saves you later.

---

## 6. Security Checklist

- [ ] **Never commit secrets.** `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD_HASH` live only in Vercel's env settings.
- [ ] **Confirm `.env` is git-ignored** (check `backend/.gitignore`).
- [ ] **Rotate `JWT_SECRET`** — generate a fresh random value for production; don't reuse the one in `backend/.env`.
- [ ] **Keep the admin password as a bcrypt hash**, never plain text.
- [ ] After going live, test admin login + a hub submission + a participant signup end-to-end.

---

## 7. Final Folder Structure

```
NFP LOCALHUBS/                 (repo root = Vercel project root)
├── vercel.json                ← rewrites /api/* to the function
├── api/
│   └── index.js               ← entry point: re-exports backend/app.js
├── backend/
│   ├── app.js                 ← builds + exports Express app (NEW split)
│   ├── server.js              ← local testing only (app.listen)
│   ├── db.js                  ← Postgres pool wrapper (REWRITTEN)
│   ├── utils.js               ← unchanged
│   ├── middleware/auth.js     ← unchanged
│   └── routes/
│       ├── hubs.js            ← async + $1 placeholders
│       ├── participants.js    ← async + $1 placeholders
│       ├── admin.js           ← async + $1 placeholders
│       └── geo.js             ← async + $1 placeholders
├── participant/               ← networkfp.com/participant
│   ├── index.html
│   └── script.js              ← API_BASE = ''
├── circle-leaders/            ← networkfp.com/circle-leaders
│   ├── index.html
│   └── script.js
├── admin/                     ← networkfp.com/admin
│   ├── index.html
│   └── script.js              ← API_BASE = ''
└── supabase/
    └── schema.sql             ← source-of-truth DB schema (NEW)
```

---

## 8. Quick Reference: Every File That Changes

| File | What happens |
|---|---|
| `supabase/schema.sql` | **NEW** — your Postgres schema (source of truth) |
| `backend/db.js` | **Rewritten** — SQLite → Postgres `pg` pool |
| `backend/package.json` | Remove `better-sqlite3`, add `pg` |
| `backend/app.js` | **NEW** — Express app without `app.listen` |
| `backend/server.js` | Slimmed to local-only `app.listen` |
| `backend/routes/hubs.js` | async + `$1` placeholders + geocode-before-respond |
| `backend/routes/participants.js` | async + `$1` placeholders |
| `backend/routes/admin.js` | async + `$1` placeholders |
| `backend/routes/geo.js` | async + `$1` placeholders |
| `backend/seed.js` | Convert to manual Postgres seed, or delete |
| `backend/data/` | **Deleted** (SQLite files gone) |
| `api/index.js` | **NEW** — Vercel function entry |
| `vercel.json` | **NEW** — `/api/*` rewrite |
| `participant/` `circle-leaders/` `admin/` | Moved to repo root; `API_BASE = ''` |

---

## Who Does What

- **You (in the browser):** Phase 1 (Supabase), Phase 4 (Vercel dashboard + domain), Phase 5 (future changes).
- **Code work (Phases 2 & 3):** mechanical but fiddly — ~20 query rewrites, the `db.js` swap, splitting `server.js`, the `api/` entry, `vercel.json`, folder moves, and the `API_BASE` change. This can be done for you on a separate branch so you review the diff before pushing.

---

*End of plan.*
