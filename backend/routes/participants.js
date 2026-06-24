// routes/participants.js — public participant registration.
const express = require('express');
const db = require('../db');
const { generateParticipantId } = require('../utils');

const router = express.Router();

const REQUIRED_FIELDS = ['fullName', 'email', 'mobile', 'membership', 'hubId'];

// POST /api/participants — register a participant against an Approved hub.
router.post('/', async (req, res) => {
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

  // Block duplicate registrations: one participant registration per email/mobile.
  const emailIn = String(body.email).trim();
  const mobileIn = String(body.mobile).trim();
  const dupe = await db.get(
    'SELECT id FROM participants WHERE lower(email) = lower($1) OR mobile = $2',
    [emailIn, mobileIn]
  );
  if (dupe) {
    return res.status(409).json({
      error: 'You have already registered with this email or mobile number.',
    });
  }

  const id = generateParticipantId();
  const registeredAt = new Date().toISOString();
  const status = 'Confirmed';

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
  };

  await db.run(
    `INSERT INTO participants (id, registered_at, status, full_name, email, mobile, membership, note, hub_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      participant.id, participant.registered_at, participant.status, participant.full_name,
      participant.email, participant.mobile, participant.membership, participant.note, participant.hub_id,
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
  });
});

module.exports = router;
