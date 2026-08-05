// poll-routes/sessions.js — public join + live-state polling endpoints.
const express = require('express');
const db = require('../poll-db');
const {
  generateParticipantId,
  generateDeviceToken,
  sessionRowToJson,
  questionRowToPublicJson,
  participantRowToJson,
} = require('../poll-utils');

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

// POST /api/sessions/:code/join
// body: { deviceToken?, fullName, phone, circleLeaderHubId }. Every attendee
// joins the same way, including a Circle's own leader — they just pick their
// own Circle off the same list. circleLeaderHubId is still the hubs.id of
// the Circle they selected (field name kept for minimal churn).
// Idempotent per device: replaying the same deviceToken for the same session
// returns the same participant instead of creating a duplicate.
router.post('/:code/join', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const body = req.body || {};

  const session = await db.get('SELECT * FROM poll_sessions WHERE code = $1', [code]);
  if (!session) return res.status(404).json({ error: 'No poll found for that code.' });
  if (session.status === 'ended') {
    return res.status(410).json({ error: 'This poll has ended.' });
  }

  const deviceToken = body.deviceToken || generateDeviceToken();

  const existing = await db.get(
    'SELECT * FROM poll_participants WHERE session_id = $1 AND device_token = $2',
    [session.id, deviceToken]
  );
  if (existing) {
    return res.json({
      participant: participantRowToJson(existing),
      deviceToken,
      session: sessionRowToJson(session),
    });
  }

  const fullName = String(body.fullName || '').trim();
  const phone = String(body.phone || '').trim();
  const circleLeaderHubId = body.circleLeaderHubId ? String(body.circleLeaderHubId).trim() : null;

  // Every attendee joins the same way: just name and phone.
  if (!fullName) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  const id = generateParticipantId();
  const result = await db.run(
    `INSERT INTO poll_participants
       (id, session_id, full_name, phone, join_source, circle_leader_hub_id, device_token, joined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      session.id,
      fullName,
      phone,
      'manual',
      circleLeaderHubId,
      deviceToken,
      nowIso(),
    ]
  );

  res.status(201).json({
    participant: participantRowToJson(result.rows[0]),
    deviceToken,
    session: sessionRowToJson(session),
  });
});

// GET /api/sessions/:code/state — polled every ~2s from participant phones.
// Cached briefly at the CDN so hundreds of identical concurrent requests
// collapse into a handful of origin hits instead of hammering Postgres.
router.get('/:code/state', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const session = await db.get('SELECT * FROM poll_sessions WHERE code = $1', [code]);
  if (!session) return res.status(404).json({ error: 'No poll found for that code.' });

  let currentQuestion = null;
  if (session.current_question_id) {
    const q = await db.get('SELECT * FROM poll_questions WHERE id = $1', [session.current_question_id]);
    currentQuestion = q ? questionRowToPublicJson(q) : null;
    if (currentQuestion) delete currentQuestion.correctOption; // never sent to participants
  }
  const { count } = await db.get(
    'SELECT COUNT(*)::int AS count FROM poll_participants WHERE session_id = $1',
    [session.id]
  );

  res.set('Cache-Control', 's-maxage=1, stale-while-revalidate=2');
  res.json({
    status: session.status,
    title: session.title,
    currentQuestion,
    participantCount: count,
  });
});

module.exports = router;
