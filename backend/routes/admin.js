// routes/admin.js — admin login + protected hub/participant management.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { hubRowToJson, participantRowToJson } = require('../utils');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

const VALID_HUB_STATUSES = ['Approved', 'Rejected'];
const VALID_PARTICIPANT_STATUSES = ['Confirmed', 'Cancelled'];

// POST /api/admin/login — public.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const validEmail = email === process.env.ADMIN_EMAIL;
  const validPassword = validEmail
    ? await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH)
    : false;

  if (!validEmail || !validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// Everything below requires a valid admin JWT.
router.use(requireAdmin);

// GET /api/admin/hubs — all hubs regardless of status.
router.get('/hubs', (req, res) => {
  const rows = db.prepare('SELECT * FROM hubs ORDER BY submitted_at DESC').all();
  res.json(rows.map(hubRowToJson));
});

// PATCH /api/admin/hubs/:id/status
router.patch('/hubs/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!VALID_HUB_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_HUB_STATUSES.join(', ')}` });
  }

  const hub = db.prepare('SELECT * FROM hubs WHERE id = ?').get(req.params.id);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });

  const lastUpdated = new Date().toISOString();
  db.prepare('UPDATE hubs SET status = ?, last_updated = ? WHERE id = ?').run(
    status,
    lastUpdated,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM hubs WHERE id = ?').get(req.params.id);
  res.json(hubRowToJson(updated));
});

// GET /api/admin/participants — all participants, joined with hub fields.
router.get('/participants', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, h.full_name AS hub_leader, h.city AS hub_city, h.area AS hub_area, h.venue_type AS hub_venue
       FROM participants p
       JOIN hubs h ON h.id = p.hub_id
       ORDER BY p.registered_at DESC`
    )
    .all();

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
router.patch('/participants/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!VALID_PARTICIPANT_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${VALID_PARTICIPANT_STATUSES.join(', ')}` });
  }

  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(req.params.id);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  db.prepare('UPDATE participants SET status = ? WHERE id = ?').run(status, req.params.id);

  const updated = db.prepare('SELECT * FROM participants WHERE id = ?').get(req.params.id);
  res.json(participantRowToJson(updated));
});

module.exports = router;
