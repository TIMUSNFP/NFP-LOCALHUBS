// routes/hubs.js — public hub registration + listing endpoints.
const express = require('express');
const db = require('../db');
const { generateHubId, hubRowToJson } = require('../utils');

const router = express.Router();

const REQUIRED_FIELDS = [
  'fullName',
  'email',
  'mobile',
  'membership',
  'city',
  'area',
  'pincode',
  'venueType',
  'capacity',
];

// POST /api/hubs — submit a new hub registration.
router.post('/', async (req, res) => {
  const body = req.body || {};

  // Reject if admin has closed Hub Leader applications.
  const setting = await db.get("SELECT value FROM settings WHERE key = 'hub_form_open'");
  if (setting && setting.value === 'false') {
    return res.status(403).json({ error: 'Hub Leader applications are currently closed.' });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      return res.status(400).json({ error: `${field} is required.` });
    }
  }

  // Block duplicate applications: one Circle Host registration per email/mobile.
  const emailIn = String(body.email).trim();
  const mobileIn = String(body.mobile).trim();
  const dupe = await db.get(
    'SELECT id FROM hubs WHERE lower(email) = lower($1) OR mobile = $2',
    [emailIn, mobileIn]
  );
  if (dupe) {
    return res.status(409).json({
      error: 'You have already registered as a Circle Host with this email or mobile number.',
    });
  }

  const id = generateHubId();
  const submittedAt = new Date().toISOString();
  const status = 'Pending';

  // NOTE: we deliberately do NOT geocode here. Geocoding made hub submission slow
  // (multiple network lookups before responding), which caused a laggy submit and
  // accidental double-submissions. Coordinates are filled in later when an admin
  // approves the hub (see routes/admin.js) — which is the only time the map needs
  // a precise pin. Pending hubs fall back to city-centre coords on the frontend.
  const hub = {
    id,
    submitted_at: submittedAt,
    last_updated: null,
    status,
    full_name: String(body.fullName).trim(),
    email: String(body.email).trim(),
    mobile: String(body.mobile).trim(),
    membership: body.membership,
    city: String(body.city).trim(),
    area: String(body.area).trim(),
    address: body.address ? String(body.address).trim() : null,
    pincode: String(body.pincode).trim(),
    venue_type: body.venueType,
    capacity: body.capacity,
    hosted_before: body.hostedBefore || 'No',
    hosting_frequency: body.hostingFrequency || 'One Time Only',
    poc_role: body.pocRole || 'self',
    lat: null,
    lng: null,
  };

  await db.run(
    `INSERT INTO hubs (
      id, submitted_at, last_updated, status, full_name, email, mobile, membership,
      city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency, poc_role, lat, lng
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    )`,
    [
      hub.id, hub.submitted_at, hub.last_updated, hub.status, hub.full_name, hub.email,
      hub.mobile, hub.membership, hub.city, hub.area, hub.address, hub.pincode,
      hub.venue_type, hub.capacity, hub.hosted_before, hub.hosting_frequency, hub.poc_role, hub.lat, hub.lng,
    ]
  );

  const created = await db.get('SELECT * FROM hubs WHERE id = $1', [id]);
  res.status(201).json(hubRowToJson(created));
});

// GET /api/hubs/check — real-time duplicate check before submit (called on field blur).
// Returns { emailExists, mobileExists } without exposing any personal data.
router.get('/check', async (req, res) => {
  const { email, mobile } = req.query;
  const result = { emailExists: false, mobileExists: false };
  try {
    if (email && String(email).trim()) {
      const row = await db.get('SELECT id FROM hubs WHERE lower(email) = lower($1)', [String(email).trim()]);
      result.emailExists = !!row;
    }
    if (mobile && String(mobile).trim()) {
      const row = await db.get('SELECT id FROM hubs WHERE mobile = $1', [String(mobile).trim()]);
      result.mobileExists = !!row;
    }
  } catch (e) { /* DB error — return false so we never block a legitimate new user */ }
  res.json(result);
});

// GET /api/hubs?status=Approved,Pending — list hubs, optionally filtered by status.
router.get('/', async (req, res) => {
  const { status } = req.query;
  let rows;

  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 0) {
      rows = await db.all('SELECT * FROM hubs ORDER BY submitted_at DESC');
    } else {
      const placeholders = statuses.map((_, i) => `$${i + 1}`).join(',');
      rows = await db.all(
        `SELECT * FROM hubs WHERE status IN (${placeholders}) ORDER BY submitted_at DESC`,
        statuses
      );
    }
  } else {
    rows = await db.all('SELECT * FROM hubs ORDER BY submitted_at DESC');
  }

  res.json(rows.map(hubRowToJson));
});

// GET /api/hubs/:id — single hub.
router.get('/:id', async (req, res) => {
  const row = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Hub not found' });
  res.json(hubRowToJson(row));
});

module.exports = router;
