// routes/hubs.js — public hub registration + listing endpoints.
const express = require('express');
const db = require('../db');
const { generateHubId, hubRowToJson, combinedLeaderName } = require('../utils');
const { readFormSettings } = require('./settings');

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
  try {
    const body = req.body || {};

    // Reject if admin has closed Hub Leader applications.
    const { hubFormOpen, activeEdition } = await readFormSettings();
    if (!hubFormOpen) {
      return res.status(403).json({ error: 'Hub Leader applications are currently closed.' });
    }

    for (const field of REQUIRED_FIELDS) {
      if (!body[field] || !String(body[field]).trim()) {
        return res.status(400).json({ error: `${field} is required.` });
      }
    }

    // Block duplicate applications: one Circle Host registration per email/mobile,
    // scoped to the current edition — a leader from a past edition either gets
    // carried forward by the admin, or is free to apply again fresh.
    const emailIn = String(body.email).trim();
    const mobileIn = String(body.mobile).trim();
    const dupe = await db.get(
      'SELECT id FROM hubs WHERE (lower(email) = lower($1) OR mobile = $2) AND edition = $3',
      [emailIn, mobileIn, activeEdition]
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
      edition: activeEdition,
    };

    await db.run(
      `INSERT INTO hubs (
        id, submitted_at, last_updated, status, full_name, email, mobile, membership,
        city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency, poc_role, lat, lng, edition
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )`,
      [
        hub.id, hub.submitted_at, hub.last_updated, hub.status, hub.full_name, hub.email,
        hub.mobile, hub.membership, hub.city, hub.area, hub.address, hub.pincode,
        hub.venue_type, hub.capacity, hub.hosted_before, hub.hosting_frequency, hub.poc_role, hub.lat, hub.lng,
        hub.edition,
      ]
    );

    const created = await db.get('SELECT * FROM hubs WHERE id = $1', [id]);
    res.status(201).json(hubRowToJson(created));
  } catch (e) {
    console.error('[hubs] POST failed:', e.message);
    res.status(500).json({ error: 'Could not submit your application. Please try again.' });
  }
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

// GET /api/hubs?status=Approved,Pending&edition=2 — list hubs, optionally filtered
// by status and/or edition. Edition defaults to the active edition so the public
// circle-finder only ever shows the current edition's circles; pass edition=all
// to bypass that default (not currently used by the frontend, but keeps this
// endpoint from silently hiding data for any future/internal caller).
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let { edition } = req.query;
    if (edition === undefined) {
      ({ activeEdition: edition } = await readFormSettings());
    } else if (edition === 'all') {
      edition = null;
    } else {
      edition = parseInt(edition, 10);
    }

    let rows;
    const statuses = status
      ? String(status).split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const conditions = [];
    const params = [];
    if (statuses.length) {
      const placeholders = statuses.map((_, i) => `$${params.length + i + 1}`).join(',');
      conditions.push(`status IN (${placeholders})`);
      params.push(...statuses);
    }
    if (Number.isInteger(edition)) {
      params.push(edition);
      conditions.push(`edition = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    rows = await db.all(`SELECT * FROM hubs ${where} ORDER BY submitted_at DESC`, params);

    const counts = await db.all(
      "SELECT hub_id, COUNT(*) as cnt FROM participants WHERE status != 'Cancelled' GROUP BY hub_id"
    );
    const countMap = {};
    counts.forEach(r => { countMap[r.hub_id] = Number(r.cnt); });

    // Circles absorbed into this one via Combine — surfaced as displayName below
    // so participants who knew the closed circle by its old leader's name still
    // recognize it (e.g. "Vishal and Nihar's Circle (Combined)").
    const merges = await db.all(
      `SELECT merged_into_hub_id, full_name FROM hubs WHERE status = 'Merged' AND merged_into_hub_id IS NOT NULL`
    );
    const mergedFromMap = {};
    merges.forEach(m => {
      (mergedFromMap[m.merged_into_hub_id] = mergedFromMap[m.merged_into_hub_id] || []).push(m.full_name);
    });

    res.json(rows.map(row => {
      const mergedFromNames = mergedFromMap[row.id] || [];
      const leaderName = combinedLeaderName(row.full_name, mergedFromNames);
      return {
        ...hubRowToJson(row),
        participantCount: countMap[row.id] || 0,
        displayName: mergedFromNames.length ? `${leaderName} (Combined)` : row.full_name,
      };
    }));
  } catch (e) {
    console.error('[hubs] GET / failed:', e.message);
    res.status(500).json({ error: 'Failed to load circles.' });
  }
});

// GET /api/hubs/:id — single hub.
router.get('/:id', async (req, res) => {
  try {
    const row = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Hub not found' });
    const countRow = await db.get(
      "SELECT COUNT(*) as cnt FROM participants WHERE hub_id = $1 AND status != 'Cancelled'",
      [row.id]
    );
    res.json({ ...hubRowToJson(row), participantCount: countRow ? Number(countRow.cnt) : 0 });
  } catch (e) {
    console.error('[hubs] GET /:id failed:', e.message);
    res.status(500).json({ error: 'Failed to load circle.' });
  }
});

module.exports = router;
