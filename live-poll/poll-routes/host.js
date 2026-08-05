// poll-routes/host.js — host login + protected session/question control + export.
// Login reuses the exact same credentials as the main NFP Circles admin panel
// (ADMIN_EMAIL / ADMIN_PASSWORD_HASH / JWT_SECRET) — see backend/routes/admin.js,
// which this mirrors.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../poll-db');
const { requireAdmin } = require('../poll-middleware');
const {
  generateSessionId,
  generateQuestionId,
  generateJoinCode,
  sessionRowToJson,
  questionRowToJson,
} = require('../poll-utils');

const router = express.Router();

const VALID_TYPES = ['multiple_choice', 'true_false', 'rating', 'word_cloud', 'open_text', 'quiz', 'ranking', 'pulse'];

function nowIso() {
  return new Date().toISOString();
}

// POST /api/host/login — public.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

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

// GET /api/host/sessions — list all sessions, most recent first.
router.get('/sessions', async (req, res) => {
  const rows = await db.all('SELECT * FROM poll_sessions ORDER BY created_at DESC');
  res.json(rows.map(sessionRowToJson));
});

// Uppercase letters/digits only, so it works in the join-code text input and
// in a QR-encoded URL without escaping. 4-24 chars — long enough to allow a
// memorable code like "NFPCIRCLE2026", short enough to still fit on the
// presenter screen and be typed on a phone.
function normalizeCustomCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

// POST /api/host/sessions — body: { title, code? } -> creates a draft
// session. If `code` is given (e.g. "NFPCIRCLE2026") it's used as the join
// code after normalizing and checking it's free; otherwise a fresh random
// 6-digit code is generated (retried on the rare collision).
router.post('/sessions', async (req, res) => {
  const title = String((req.body || {}).title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required.' });

  const id = generateSessionId();
  const requestedCode = normalizeCustomCode((req.body || {}).code);
  let code;

  if (requestedCode) {
    if (requestedCode.length < 4) {
      return res.status(400).json({ error: 'Custom code must be at least 4 characters.' });
    }
    const clash = await db.get('SELECT id FROM poll_sessions WHERE code = $1', [requestedCode]);
    if (clash) return res.status(409).json({ error: `Code "${requestedCode}" is already in use by another poll.` });
    code = requestedCode;
  } else {
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = generateJoinCode();
      const clash = await db.get('SELECT id FROM poll_sessions WHERE code = $1', [candidate]);
      if (!clash) {
        code = candidate;
        break;
      }
    }
    if (!code) return res.status(500).json({ error: 'Could not generate a unique join code, try again.' });
  }

  const result = await db.run(
    `INSERT INTO poll_sessions (id, code, title, status, created_at)
     VALUES ($1, $2, $3, 'draft', $4) RETURNING *`,
    [id, code, title, nowIso()]
  );
  res.status(201).json(sessionRowToJson(result.rows[0]));
});

// POST /api/host/sessions/:id/code — body: { code } -> changes an existing
// session's join code (any status: draft/live/ended). Lets a host rebrand a
// random default code to something memorable after the fact.
router.post('/sessions/:id/code', async (req, res) => {
  const session = await db.get('SELECT * FROM poll_sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const newCode = normalizeCustomCode((req.body || {}).code);
  if (newCode.length < 4) {
    return res.status(400).json({ error: 'Code must be at least 4 characters.' });
  }
  const clash = await db.get('SELECT id FROM poll_sessions WHERE code = $1 AND id != $2', [newCode, session.id]);
  if (clash) return res.status(409).json({ error: `Code "${newCode}" is already in use by another poll.` });

  const result = await db.run('UPDATE poll_sessions SET code = $1 WHERE id = $2 RETURNING *', [newCode, session.id]);
  res.json(sessionRowToJson(result.rows[0]));
});

// GET /api/host/sessions/:id — full detail incl. every question (with correct
// answers) and a live participant count, for the host console.
router.get('/sessions/:id', async (req, res) => {
  const session = await db.get('SELECT * FROM poll_sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const questions = await db.all(
    'SELECT * FROM poll_questions WHERE session_id = $1 ORDER BY order_index ASC',
    [session.id]
  );
  const { count } = await db.get(
    'SELECT COUNT(*)::int AS count FROM poll_participants WHERE session_id = $1',
    [session.id]
  );

  res.json({
    ...sessionRowToJson(session),
    participantCount: count,
    questions: questions.map(questionRowToJson),
  });
});

// POST /api/host/sessions/:id/questions — body: { type, prompt, options, correctOption }
router.post('/sessions/:id/questions', async (req, res) => {
  const session = await db.get('SELECT * FROM poll_sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const { type, prompt, options, correctOption } = req.body || {};
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (!String(prompt || '').trim()) {
    return res.status(400).json({ error: 'prompt is required.' });
  }

  const { max } = await db.get(
    'SELECT COALESCE(MAX(order_index), 0) AS max FROM poll_questions WHERE session_id = $1',
    [session.id]
  );

  const id = generateQuestionId();
  const result = await db.run(
    `INSERT INTO poll_questions (id, session_id, order_index, type, prompt, options, correct_option, status, revealed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', false) RETURNING *`,
    [id, session.id, max + 1, type, String(prompt).trim(), JSON.stringify(options || {}), correctOption || null]
  );
  res.status(201).json(questionRowToJson(result.rows[0]));
});

// DELETE /api/host/sessions/:id/questions/:qid — only while still pending
// (not yet shown live), so a mid-session cleanup can't corrupt collected votes.
router.delete('/sessions/:id/questions/:qid', async (req, res) => {
  const question = await db.get('SELECT * FROM poll_questions WHERE id = $1 AND session_id = $2', [
    req.params.qid,
    req.params.id,
  ]);
  if (!question) return res.status(404).json({ error: 'Question not found.' });
  if (question.status !== 'pending') {
    return res.status(409).json({ error: 'Only a question that has not gone live yet can be deleted.' });
  }
  await db.run('DELETE FROM poll_questions WHERE id = $1', [question.id]);
  res.json({ ok: true });
});

// POST /api/host/sessions/:id/start — draft -> live.
router.post('/sessions/:id/start', async (req, res) => {
  const result = await db.run(
    `UPDATE poll_sessions SET status = 'live', started_at = $2 WHERE id = $1 AND status = 'draft' RETURNING *`,
    [req.params.id, nowIso()]
  );
  if (result.rowCount === 0) return res.status(409).json({ error: 'Session cannot be started from its current state.' });
  res.json(sessionRowToJson(result.rows[0]));
});

// POST /api/host/sessions/:id/questions/:qid/open — makes this question the
// live one; closes whatever question was previously live in this session.
router.post('/sessions/:id/questions/:qid/open', async (req, res) => {
  const session = await db.get('SELECT * FROM poll_sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const question = await db.get('SELECT * FROM poll_questions WHERE id = $1 AND session_id = $2', [
    req.params.qid,
    session.id,
  ]);
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  await db.run(
    `UPDATE poll_questions SET status = 'closed', revealed = true
     WHERE session_id = $1 AND status = 'live' AND id != $2`,
    [session.id, question.id]
  );
  const result = await db.run(
    `UPDATE poll_questions SET status = 'live' WHERE id = $1 RETURNING *`,
    [question.id]
  );
  await db.run('UPDATE poll_sessions SET current_question_id = $1 WHERE id = $2', [question.id, session.id]);

  res.json(questionRowToJson(result.rows[0]));
});

// POST /api/host/sessions/:id/questions/:qid/close — stops new votes and
// reveals the correct answer (quiz) / final tally to the presenter screen.
router.post('/sessions/:id/questions/:qid/close', async (req, res) => {
  const result = await db.run(
    `UPDATE poll_questions SET status = 'closed', revealed = true
     WHERE id = $1 AND session_id = $2 RETURNING *`,
    [req.params.qid, req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Question not found.' });
  res.json(questionRowToJson(result.rows[0]));
});

// POST /api/host/sessions/:id/next — clears the current question, returning
// participant phones and the presenter screen to a "waiting" state until the
// host opens the next question.
router.post('/sessions/:id/next', async (req, res) => {
  await db.run(
    `UPDATE poll_questions SET status = 'closed', revealed = true WHERE session_id = $1 AND status = 'live'`,
    [req.params.id]
  );
  const result = await db.run(
    `UPDATE poll_sessions SET current_question_id = NULL WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found.' });
  res.json(sessionRowToJson(result.rows[0]));
});

// POST /api/host/sessions/:id/restart — resets this session back to a clean
// draft so the SAME question set can be run again (e.g. a rehearsal run,
// then the real event). Destructive: wipes every participant and vote
// collected so far under this session, so results from the previous run
// don't bleed into the next one. Export the CSV first if that data matters.
router.post('/sessions/:id/restart', async (req, res) => {
  const session = await db.get('SELECT * FROM poll_sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  await db.run(
    `DELETE FROM poll_votes WHERE question_id IN (SELECT id FROM poll_questions WHERE session_id = $1)`,
    [session.id]
  );
  await db.run('DELETE FROM poll_participants WHERE session_id = $1', [session.id]);
  await db.run(
    `UPDATE poll_questions SET status = 'pending', revealed = false WHERE session_id = $1`,
    [session.id]
  );
  const result = await db.run(
    `UPDATE poll_sessions
     SET status = 'draft', current_question_id = NULL, started_at = NULL, ended_at = NULL
     WHERE id = $1 RETURNING *`,
    [session.id]
  );
  res.json(sessionRowToJson(result.rows[0]));
});

// POST /api/host/sessions/:id/end — live -> ended.
router.post('/sessions/:id/end', async (req, res) => {
  await db.run(
    `UPDATE poll_questions SET status = 'closed', revealed = true WHERE session_id = $1 AND status = 'live'`,
    [req.params.id]
  );
  const result = await db.run(
    `UPDATE poll_sessions SET status = 'ended', ended_at = $2, current_question_id = NULL
     WHERE id = $1 RETURNING *`,
    [req.params.id, nowIso()]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found.' });
  res.json(sessionRowToJson(result.rows[0]));
});

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// GET /api/host/sessions/:id/export.csv — every vote, WITH participant
// identity. This is the only place in the whole app where an answer and a
// name are ever joined together.
router.get('/sessions/:id/export.csv', async (req, res) => {
  const session = await db.get('SELECT * FROM poll_sessions WHERE id = $1', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  const rows = await db.all(
    `SELECT q.order_index, q.type, q.prompt, p.full_name, p.phone,
            h.full_name AS circle_name, h.city AS circle_city,
            v.answer, v.submitted_at
     FROM poll_votes v
     JOIN poll_questions q ON q.id = v.question_id
     JOIN poll_participants p ON p.id = v.participant_id
     LEFT JOIN hubs h ON h.id = p.circle_leader_hub_id
     WHERE q.session_id = $1
     ORDER BY q.order_index ASC, v.submitted_at ASC`,
    [session.id]
  );

  const header = ['Question #', 'Type', 'Question', 'Participant Name', 'Phone', 'Circle', 'Answer', 'Submitted At'];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    const answer =
      r.answer?.text ?? r.answer?.option ?? r.answer?.value ??
      (Array.isArray(r.answer?.order) ? r.answer.order.join(' > ') : JSON.stringify(r.answer));
    const circle = r.circle_name ? `${r.circle_name}${r.circle_city ? ` — ${r.circle_city}` : ''}` : '';
    lines.push(
      [
        r.order_index,
        r.type,
        r.prompt,
        r.full_name,
        r.phone || '',
        circle,
        answer,
        r.submitted_at,
      ]
        .map(csvEscape)
        .join(',')
    );
  }

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${session.code}-poll-results.csv"`);
  res.send(lines.join('\n'));
});

module.exports = router;
