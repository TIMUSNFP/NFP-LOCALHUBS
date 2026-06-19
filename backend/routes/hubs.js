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
router.post('/', async (req, res) => {
  const body = req.body || {};

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      return res.status(400).json({ error: `${field} is required.` });
    }
  }

  const id = generateHubId();
  const submittedAt = new Date().toISOString();
  const status = 'Pending';

  // Geocode BEFORE responding. On serverless the function freezes the instant it
  // responds, so the old fire-and-forget UPDATE would never run. We resolve coords
  // up front (best-effort — null on failure) and insert them with the row.
  let lat = null;
  let lng = null;
  try {
    const coords = await geocodeHub({
      address: body.address ? String(body.address).trim() : null,
      area: String(body.area).trim(),
      city: String(body.city).trim(),
    });
    if (coords) [lat, lng] = coords;
  } catch (e) {
    // Geocoding is best-effort; ignore failures and store null coords.
  }

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
    lat,
    lng,
  };

  await db.run(
    `INSERT INTO hubs (
      id, submitted_at, last_updated, status, full_name, email, mobile, membership,
      city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency, lat, lng
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )`,
    [
      hub.id, hub.submitted_at, hub.last_updated, hub.status, hub.full_name, hub.email,
      hub.mobile, hub.membership, hub.city, hub.area, hub.address, hub.pincode,
      hub.venue_type, hub.capacity, hub.hosted_before, hub.hosting_frequency, hub.lat, hub.lng,
    ]
  );

  const created = await db.get('SELECT * FROM hubs WHERE id = $1', [id]);
  res.status(201).json(hubRowToJson(created));
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
