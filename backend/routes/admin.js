// routes/admin.js — admin login + protected hub/participant management.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { hubRowToJson, participantRowToJson, geocodeHub } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { readFormSettings } = require('./settings');
const { sendHubApproved, sendHubRejected, sendParticipantConfirmed, sendParticipantCancelled, sendHubRosterUpdate } = require('../mailer');

const router = express.Router();

const VALID_HUB_STATUSES = ['Approved', 'Rejected', 'Pending'];
const VALID_PARTICIPANT_STATUSES = ['Confirmed', 'Cancelled', 'Pending'];

// POST /api/admin/login — public.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Trim the env values — Vercel/.env values often pick up a trailing newline,
  // which would otherwise make a perfectly correct bcrypt hash fail to match.
  const validEmail = email === (process.env.ADMIN_EMAIL || '').trim();
  const validPassword = validEmail
    ? await bcrypt.compare(password, (process.env.ADMIN_PASSWORD_HASH || '').trim())
    : false;

  if (!validEmail || !validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// Everything below requires a valid admin JWT.
router.use(requireAdmin);

// GET /api/admin/settings — current open/closed state of the public forms.
router.get('/settings', async (req, res) => {
  res.json(await readFormSettings());
});

// PATCH /api/admin/settings — open or close the public forms.
// Body: { hubFormOpen?: boolean, participantFormOpen?: boolean }
router.patch('/settings', async (req, res) => {
  const { hubFormOpen, participantFormOpen } = req.body || {};

  const upsert = (key, val) =>
    db.run(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, val ? 'true' : 'false']
    );

  if (typeof hubFormOpen === 'boolean') await upsert('hub_form_open', hubFormOpen);
  if (typeof participantFormOpen === 'boolean') await upsert('participant_form_open', participantFormOpen);

  res.json(await readFormSettings());
});

// GET /api/admin/hubs — all hubs regardless of status.
router.get('/hubs', async (req, res) => {
  const rows = await db.all('SELECT * FROM hubs ORDER BY submitted_at DESC');
  res.json(rows.map(hubRowToJson));
});

// PATCH /api/admin/hubs/:id/status
router.patch('/hubs/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_HUB_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_HUB_STATUSES.join(', ')}` });
  }

  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });

  const lastUpdated = new Date().toISOString();
  await db.run('UPDATE hubs SET status = $1, last_updated = $2 WHERE id = $3', [
    status,
    lastUpdated,
    req.params.id,
  ]);

  // Geocode on approval (only if coords are missing). This is the moment the hub
  // becomes visible on the map and in the PIN-code nearby search, so it's the right
  // time to resolve a precise pin — and it keeps public submission fast.
  if (status === 'Approved' && (hub.lat == null || hub.lng == null)) {
    try {
      const coords = await geocodeHub({ address: hub.address, area: hub.area, city: hub.city, pincode: hub.pincode });
      if (coords) {
        const [lat, lng] = coords;
        await db.run('UPDATE hubs SET lat = $1, lng = $2 WHERE id = $3', [lat, lng, req.params.id]);
      }
    } catch (e) {
      // Best-effort; frontend falls back to city-centre coords if this stays null.
    }
  }

  const updated = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);

  // Fire approval/rejection email — non-blocking, errors are swallowed in mailer.
  // Resetting back to Pending is silent (no email) — it's an internal correction,
  // not a decision the applicant needs to hear about.
  if (status === 'Approved') sendHubApproved(updated);
  else if (status === 'Rejected') sendHubRejected(updated);

  res.json(hubRowToJson(updated));
});

// GET /api/admin/participants — all participants, joined with hub fields.
router.get('/participants', async (req, res) => {
  const rows = await db.all(
    `SELECT p.*, h.full_name AS hub_leader, h.city AS hub_city, h.area AS hub_area, h.venue_type AS hub_venue
     FROM participants p
     JOIN hubs h ON h.id = p.hub_id
     ORDER BY p.registered_at DESC`
  );

  res.json(
    rows.map((row) => ({
      ...participantRowToJson(row),
      hubLeader: row.hub_leader,
      hubCity: row.hub_city,
      hubArea: row.hub_area,
      hubVenue: row.hub_venue,
    }))
  );
});

// POST /api/admin/hubs/:id/send-roster — email an approved Circle Leader their
// current list of Confirmed participants (name + mobile). On-demand only, not
// tied to a status change, so it can be re-sent as new participants confirm.
router.post('/hubs/:id/send-roster', async (req, res) => {
  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });
  if (hub.status !== 'Approved') {
    return res.status(400).json({ error: 'Only approved circles can receive a roster email.' });
  }

  const participants = await db.all(
    "SELECT * FROM participants WHERE hub_id = $1 AND status = 'Confirmed' ORDER BY registered_at ASC",
    [req.params.id]
  );

  await sendHubRosterUpdate(hub, participants);

  const rosterSentAt = new Date().toISOString();
  await db.run('UPDATE hubs SET roster_sent_at = $1 WHERE id = $2', [rosterSentAt, req.params.id]);

  res.json({ ok: true, participantCount: participants.length, rosterSentAt });
});

// DELETE /api/admin/hubs/:id — permanently remove a hub leader application. This is
// how an admin frees up an email/mobile so the person can apply again. Blocked if
// the circle already has participants registered under it — those must be moved
// or deleted first so a hub delete never silently orphans participant data.
router.delete('/hubs/:id', async (req, res) => {
  const existing = await db.get('SELECT id FROM hubs WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Hub not found' });

  const countRow = await db.get('SELECT COUNT(*) as cnt FROM participants WHERE hub_id = $1', [req.params.id]);
  if (countRow && Number(countRow.cnt) > 0) {
    return res.status(409).json({
      error: `This circle has ${countRow.cnt} participant(s) registered. Remove or reassign them before deleting the hub.`,
    });
  }

  await db.run('DELETE FROM hubs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// PATCH /api/admin/participants/:id/status
router.patch('/participants/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_PARTICIPANT_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${VALID_PARTICIPANT_STATUSES.join(', ')}` });
  }

  const participant = await db.get('SELECT * FROM participants WHERE id = $1', [req.params.id]);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  await db.run('UPDATE participants SET status = $1 WHERE id = $2', [status, req.params.id]);

  const updated = await db.get('SELECT * FROM participants WHERE id = $1', [req.params.id]);

  // Fire confirmation/cancellation email — non-blocking, errors are swallowed in mailer.
  // Resetting back to Pending is silent (no email) — same convention as hubs.
  if (status === 'Confirmed' || status === 'Cancelled') {
    const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [updated.hub_id]);
    if (status === 'Confirmed') sendParticipantConfirmed(updated, hub);
    else sendParticipantCancelled(updated, hub);
  }

  res.json(participantRowToJson(updated));
});

// DELETE /api/admin/participants/:id — permanently remove a participant. This is
// how an admin frees up an email/mobile so the person can register again.
router.delete('/participants/:id', async (req, res) => {
  const existing = await db.get('SELECT id FROM participants WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Participant not found' });
  await db.run('DELETE FROM participants WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/admin/sync-sheets — push hub leaders or participants to Google Sheets
// via a Google Apps Script webhook. Set SHEETS_WEBHOOK_URL in your environment.
// Body: { type: 'hubs' | 'participants' }
router.post('/sync-sheets', async (req, res) => {
  const webhookUrl = (process.env.SHEETS_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return res.status(503).json({ error: 'SHEETS_WEBHOOK_URL is not configured in environment variables.' });
  }

  const { type } = req.body || {};
  if (!['hubs', 'participants'].includes(type)) {
    return res.status(400).json({ error: 'type must be "hubs" or "participants"' });
  }

  // Manual formatting — avoids locale/ICU availability issues in serverless envs.
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const date = `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const h = d.getHours();
    const time = `${String(h % 12 || 12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    return `${date} ${time}`;
  };

  try {
    let rows;
    if (type === 'hubs') {
      const dbRows = await db.all('SELECT * FROM hubs ORDER BY submitted_at ASC');
      rows = dbRows.map(hubRowToJson).map(r => [
        r.id, r.fullName, r.email, r.mobile, r.membership,
        r.city, r.area, r.address || '', r.pincode || '',
        r.venueType, r.capacity, r.hostedBefore, r.hostingFrequency || '',
        r.pocRole === 'assign' ? 'Will assign someone else' : 'Self',
        fmt(r.submittedAt), r.status,
      ]);
    } else {
      const dbRows = await db.all(
        `SELECT p.*, h.full_name AS hub_leader, h.city AS hub_city, h.area AS hub_area, h.venue_type AS hub_venue
         FROM participants p JOIN hubs h ON h.id = p.hub_id ORDER BY p.registered_at ASC`
      );
      rows = dbRows.map(row => {
        const p = { ...participantRowToJson(row), hubLeader: row.hub_leader, hubCity: row.hub_city, hubArea: row.hub_area };
        return [
          p.id, p.fullName, p.email, p.mobile, p.membership,
          p.hubLeader, p.hubCity, p.hubArea, p.note || '',
          fmt(p.registeredAt), p.status,
        ];
      });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, rows }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res.status(502).json({ error: `Sheets webhook returned ${response.status}: ${text}` });
    }
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    res.status(502).json({ error: `Could not reach Sheets webhook: ${e.message}` });
  }
});

module.exports = router;
