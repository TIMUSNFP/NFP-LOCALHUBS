// routes/participants.js — public participant registration.
const express = require('express');
const db = require('../db');
const { generateParticipantId, hubRowToJson } = require('../utils');

const router = express.Router();

const REQUIRED_FIELDS = ['fullName', 'email', 'mobile', 'membership', 'hubId'];

// POST /api/participants — register a participant against an Approved hub.
router.post('/', (req, res) => {
  const body = req.body || {};

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || !String(body[field]).trim()) {
      return res.status(400).json({ error: `${field} is required.` });
    }
  }

  const hub = db.prepare('SELECT * FROM hubs WHERE id = ?').get(body.hubId);
  if (!hub) {
    return res.status(404).json({ error: 'Hub not found' });
  }
  if (hub.status !== 'Approved') {
    return res.status(400).json({ error: 'This hub is not open for registration yet.' });
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

  db.prepare(
    `INSERT INTO participants (id, registered_at, status, full_name, email, mobile, membership, note, hub_id)
     VALUES (@id, @registered_at, @status, @full_name, @email, @mobile, @membership, @note, @hub_id)`
  ).run(participant);

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
