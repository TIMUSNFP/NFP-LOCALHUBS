// routes/cron.js — Vercel Cron entry point for CRM campaign sending.
//
// Why this exists: routes/crm.js schedules an in-process setInterval when a
// campaign starts, so it keeps sending batches without the admin panel open —
// but that only works for as long as the underlying serverless instance stays
// warm. Vercel can freeze or recycle a function instance the moment its
// response is sent, which silently stalls the timer until something else
// happens to hit that same warm instance (in practice, mostly the admin
// panel's own polling — hence needing a laptop/browser open). A Vercel Cron
// Job calls this route on a fixed schedule regardless of any client, so it's
// the actually-reliable driver; the in-process timer becomes a bonus for
// faster ticks when an instance does stay warm, not the only mechanism.
//
// Requires a `CRON_SECRET` env var set in the Vercel project (Settings →
// Environment Variables) — once set, Vercel automatically signs every cron
// invocation with `Authorization: Bearer <CRON_SECRET>`, which is verified
// below so this endpoint can't be used by anyone who finds the URL.
const express = require('express');
const db = require('../db');
const { runCampaignBatch } = require('./crm');

const router = express.Router();

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// GET /api/cron/crm-campaigns — checks every campaign currently marked
// Sending and runs one batch for each whose own interval_minutes pacing has
// elapsed since its last batch. Sequential, not parallel: the DB pool here is
// deliberately capped at 3 connections (see backend/db.js) and SMTP sends
// shouldn't all fire at once anyway.
router.get('/crm-campaigns', asyncHandler(async (req, res) => {
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured on the server.' });
  }
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const due = await db.all(
    `SELECT id FROM crm_campaigns
     WHERE status = 'Sending'
       AND (last_batch_at IS NULL OR last_batch_at::timestamptz < now() - (interval_minutes || ' minutes')::interval)`
  );

  const results = [];
  for (const row of due) {
    try {
      results.push({ id: row.id, ...(await runCampaignBatch(row.id)) });
    } catch (e) {
      results.push({ id: row.id, error: e.message });
    }
  }
  res.json({ checked: due.length, results });
}));

module.exports = router;
