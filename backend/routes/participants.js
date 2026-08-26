// routes/participants.js — public participant registration.
const express = require('express');
const db = require('../db');
const { generateParticipantId, combinedLeaderName } = require('../utils');
const { readFormSettings } = require('./settings');

const router = express.Router();

const REQUIRED_FIELDS = ['fullName', 'email', 'mobile', 'membership', 'hubId'];

// GET /api/participants/check — real-time duplicate check before submit (called on field blur).
router.get('/check', async (req, res) => {
  const { email, mobile } = req.query;
  const result = { emailExists: false, mobileExists: false };
  try {
    if (email && String(email).trim()) {
      const row = await db.get('SELECT id FROM participants WHERE lower(email) = lower($1)', [String(email).trim()]);
      result.emailExists = !!row;
    }
    if (mobile && String(mobile).trim()) {
      const row = await db.get('SELECT id FROM participants WHERE mobile = $1', [String(mobile).trim()]);
      result.mobileExists = !!row;
    }
  } catch (e) { /* DB error — return false so we never block a legitimate new user */ }
  res.json(result);
});

// GET /api/participants/public — public roster for the participant site's
// "Meet Our Participants" tab. Only safe fields (no email/mobile/note),
// excludes Cancelled registrations.
router.get('/public', async (req, res) => {
  try {
    const { activeEdition } = await readFormSettings();
    const rows = await db.all(
      `SELECT p.full_name, p.membership, p.status,
              h.id AS hub_id, h.full_name AS hub_leader, h.city AS hub_city
       FROM participants p
       JOIN hubs h ON h.id = p.hub_id
       WHERE p.status != 'Cancelled' AND p.edition = $1
       ORDER BY p.registered_at DESC`,
      [activeEdition]
    );

    // Circles absorbed into a surviving one via Combine — so a participant whose
    // circle was closed still recognizes it in the combined name, same as the
    // Find a Circle map/list (see routes/hubs.js).
    const merges = await db.all(
      `SELECT merged_into_hub_id, full_name FROM hubs WHERE status = 'Merged' AND merged_into_hub_id IS NOT NULL`
    );
    const mergedFromMap = {};
    merges.forEach(m => {
      (mergedFromMap[m.merged_into_hub_id] = mergedFromMap[m.merged_into_hub_id] || []).push(m.full_name);
    });

    res.json(rows.map(r => {
      const mergedFromNames = mergedFromMap[r.hub_id] || [];
      const leaderName = combinedLeaderName(r.hub_leader, mergedFromNames);
      return {
        fullName: r.full_name,
        membership: r.membership,
        status: r.status,
        city: r.hub_city,
        circleName: `${leaderName}'s Circle${mergedFromNames.length ? ' (Combined)' : ''}`,
      };
    }));
  } catch (e) {
    console.error('[participants] GET /public failed:', e.message);
    res.status(500).json({ error: 'Failed to load participants.' });
  }
});

// POST /api/participants — register a participant against an Approved hub.
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};

    // Reject if admin has closed participant registrations.
    const setting = await db.get("SELECT value FROM settings WHERE key = 'participant_form_open'");
    if (setting && setting.value === 'false') {
      return res.status(403).json({ error: 'Circle registrations are currently closed.' });
    }

    for (const field of REQUIRED_FIELDS) {
      if (!body[field] || !String(body[field]).trim()) {
        return res.status(400).json({ error: `${field} is required.` });
      }
    }

    const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [body.hubId]);
    if (!hub) {
      return res.status(404).json({ error: 'Hub not found' });
    }
    if (hub.status !== 'Approved') {
      return res.status(400).json({ error: 'This hub is not open for registration yet.' });
    }

    const { activeEdition } = await readFormSettings();

    // Block duplicate registrations: one participant registration per email/mobile,
    // scoped to the current edition — participants register fresh each edition, so
    // an email/mobile used in a past edition must not block re-registration now.
    const emailIn = String(body.email).trim();
    const mobileIn = String(body.mobile).trim();
    const dupe = await db.get(
      'SELECT id FROM participants WHERE (lower(email) = lower($1) OR mobile = $2) AND edition = $3',
      [emailIn, mobileIn, activeEdition]
    );
    if (dupe) {
      return res.status(409).json({
        error: 'You have already registered with this email or mobile number.',
      });
    }

    // Capacity check — parse the numeric limit from strings like "10 People".
    // If parsing fails for any reason, skip the check so no valid registration is blocked.
    // Counts Pending + Confirmed registrations (Cancelled excluded) — a slot is
    // reserved first-come-first-served at registration time and verified afterward,
    // so the circle shouldn't advertise a spot that's already spoken for, but a
    // Cancelled registration genuinely frees that spot back up for someone else.
    const capacityLimit = parseInt(hub.capacity, 10);
    if (!isNaN(capacityLimit) && capacityLimit > 0) {
      const countRow = await db.get(
        "SELECT COUNT(*) as cnt FROM participants WHERE hub_id = $1 AND status != 'Cancelled'",
        [hub.id]
      );
      const currentCount = countRow ? Number(countRow.cnt) : 0;
      if (currentCount >= capacityLimit) {
        return res.status(409).json({ error: 'This Circle is fully booked. No spots remaining.' });
      }
    }

    const id = generateParticipantId();
    const registeredAt = new Date().toISOString();
    // Registrations now require manual admin review — the confirmation email fires
    // when an admin approves, not at signup (see routes/admin.js).
    const status = 'Pending';

    const participant = {
      id,
      registered_at: registeredAt,
      status,
      full_name: String(body.fullName).trim(),
      email: String(body.email).trim(),
      mobile: String(body.mobile).trim(),
      membership: body.membership,
      note: body.note ? String(body.note).trim() : null,
      hub_id: hub.id,
      edition: activeEdition,
    };

    await db.run(
      `INSERT INTO participants (id, registered_at, status, full_name, email, mobile, membership, note, hub_id, edition)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        participant.id, participant.registered_at, participant.status, participant.full_name,
        participant.email, participant.mobile, participant.membership, participant.note, participant.hub_id,
        participant.edition,
      ]
    );

    res.status(201).json({
      id,
      registeredAt,
      status,
      fullName: participant.full_name,
      email: participant.email,
      mobile: participant.mobile,
      membership: participant.membership,
      note: participant.note,
      hubId: hub.id,
      hubLeader: hub.full_name,
      hubCity: hub.city,
      hubArea: hub.area,
      hubVenue: hub.venue_type,
      edition: participant.edition,
    });
  } catch (e) {
    console.error('[participants] POST failed:', e.message);
    res.status(500).json({ error: 'Could not submit your registration. Please try again.' });
  }
});

module.exports = router;
