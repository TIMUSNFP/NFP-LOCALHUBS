// poll-app.js — builds and EXPORTS the Express app (no app.listen here).
// Mirrors ../backend/app.js. Imported by api/index.js (Vercel) and
// poll-server.js (local dev).
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');

const leadersRouter = require('./poll-routes/leaders');
const sessionsRouter = require('./poll-routes/sessions');
const questionsRouter = require('./poll-routes/questions');
const hostRouter = require('./poll-routes/host');
const qrRouter = require('./poll-routes/qr');

const app = express();

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

app.use('/api/leaders', leadersRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/host', hostRouter);
app.use('/api/qr', qrRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
