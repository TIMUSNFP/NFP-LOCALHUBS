// routes/hubs.js — public hub registration + listing endpoints.
const express = require('express');
const db = require('../db');
const { generateHubId, hubRowToJson, geocodeHub } = require('../utils');

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
router.post('/', (req, res) => {
  const body = req.body || {};

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      return res.status(400).json({ error: `${field} is required.` });
    }
  }

  const id = generateHubId();
  const submittedAt = new Date().toISOString();
  const status = 'Pending';

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
    lat: null,
    lng: null,
  };

  db.prepare(
    `INSERT INTO hubs (
      id, submitted_at, last_updated, status, full_name, email, mobile, membership,
      city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency, lat, lng
    ) VALUES (
      @id, @submitted_at, @last_updated, @status, @full_name, @email, @mobile, @membership,
      @city, @area, @address, @pincode, @venue_type, @capacity, @hosted_before, @hosting_frequency, @lat, @lng
    )`
  ).run(hub);

  const created = db.prepare('SELECT * FROM hubs WHERE id = ?').get(id);
  res.status(201).json(hubRowToJson(created));

  // Fire-and-forget geocoding — does not block the response.
  geocodeHub({ address: hub.address, area: hub.area, city: hub.city })
    .then((coords) => {
      if (!coords) return;
      const [lat, lng] = coords;
      db.prepare('UPDATE hubs SET lat = ?, lng = ? WHERE id = ?').run(lat, lng, id);
    })
    .catch(() => {
      // Geocoding is best-effort; ignore failures.
    });
});

// GET /api/hubs?status=Approved,Pending — list hubs, optionally filtered by status.
router.get('/', (req, res) => {
  const { status } = req.query;
  let rows;

  if (status) {
    const statuses = String(status)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 0) {
      rows = db.prepare('SELECT * FROM hubs ORDER BY submitted_at DESC').all();
    } else {
      const placeholders = statuses.map(() => '?').join(',');
      rows = db
        .prepare(`SELECT * FROM hubs WHERE status IN (${placeholders}) ORDER BY submitted_at DESC`)
        .all(...statuses);
    }
  } else {
    rows = db.prepare('SELECT * FROM hubs ORDER BY submitted_at DESC').all();
  }

  res.json(rows.map(hubRowToJson));
});

// GET /api/hubs/:id — single hub.
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM hubs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Hub not found' });
  res.json(hubRowToJson(row));
});

module.exports = router;
