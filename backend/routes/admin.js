// routes/admin.js — admin login + protected hub/participant management.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { hubRowToJson, participantRowToJson, geocodeHub } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { readFormSettings } = require('./settings');

const router = express.Router();

const VALID_HUB_STATUSES = ['Approved', 'Rejected'];
const VALID_PARTICIPANT_STATUSES = ['Confirmed', 'Cancelled'];

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
      const coords = await geocodeHub({ address: hub.address, area: hub.area, city: hub.city });
      if (coords) {
        const [lat, lng] = coords;
        await db.run('UPDATE hubs SET lat = $1, lng = $2 WHERE id = $3', [lat, lng, req.params.id]);
      }
    } catch (e) {
      // Best-effort; frontend falls back to city-centre coords if this stays null.
    }
  }

  const updated = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
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

module.exports = router;
