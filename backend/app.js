// app.js — builds and EXPORTS the Express app (no app.listen here).
//
// This file is imported in two places:
//   1) Vercel: api/index.js re-exports it as a serverless function.
//   2) Local dev: server.js imports it and calls app.listen().
//
// Loading .env explicitly from this folder so it works no matter which directory
// the process is started from. (On Vercel, env vars come from the dashboard and
// this file simply has nothing to load.)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const hubsRouter = require('./routes/hubs');
const participantsRouter = require('./routes/participants');
const geoRouter = require('./routes/geo');
const adminRouter = require('./routes/admin');

const app = express();

// CORS: when the frontend is served from the SAME domain as this API (the Vercel
// setup), CORS is not even needed. We keep it permissive by default and allow
// locking down via ALLOWED_ORIGINS for any cross-origin local testing.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  })
);

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// TEMPORARY diagnostic endpoint — reports DB connectivity without leaking secrets.
// Remove this route once the deployment is confirmed working.
app.get('/api/debug/db', async (req, res) => {
  const info = {};
  const url = process.env.DATABASE_URL;
  info.hasDatabaseUrl = !!url;
  if (url) {
    info.rawHasPercent40 = url.includes('%40'); // true = @ correctly encoded
    try {
      const u = new URL(url);
      info.host = u.hostname;
      info.port = u.port;
      info.user = u.username;
    } catch (e) {
      info.urlParseError = e.message;
    }
  }
  info.otherEnv = {
    JWT_SECRET: !!process.env.JWT_SECRET,
    ADMIN_EMAIL: !!process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH: !!process.env.ADMIN_PASSWORD_HASH,
  };
  try {
    const db = require('./db');
    const r = await db.get('SELECT 1 AS ok');
    info.dbQuery = 'OK ' + JSON.stringify(r);
  } catch (e) {
    info.dbQuery = 'ERROR: ' + e.message;
  }
  res.json(info);
});

app.use('/api/hubs', hubsRouter);
app.use('/api/participants', participantsRouter);
app.use('/api/geo', geoRouter);
app.use('/api/admin', adminRouter);

// 404 fallback for unknown API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Generic error handler — never let a raw stack trace leak to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
