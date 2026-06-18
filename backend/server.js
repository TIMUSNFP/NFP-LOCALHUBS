// server.js — NFP Circles backend entry point.
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const db = require('./db');
const hubsRouter = require('./routes/hubs');
const participantsRouter = require('./routes/participants');
const geoRouter = require('./routes/geo');
const adminRouter = require('./routes/admin');

// Auto-seed demo data on boot if the hubs table is empty, so `npm start`
// alone is enough to get a working API on a fresh clone.
const runSeed = require('./seed');
runSeed();

const app = express();

// CORS: reflect any origin by default for local dev. Lock this down to specific
// frontend origins (via ALLOWED_ORIGINS) before going to real production.
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

app.use('/api/hubs', hubsRouter);
app.use('/api/participants', participantsRouter);
app.use('/api/geo', geoRouter);
app.use('/api/admin', adminRouter);

// 404 fallback for unknown API routes.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Generic error handler — never let a raw stack trace leak to clients.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`NFP Circles backend listening on http://localhost:${PORT}`);
});

module.exports = app;
