// poll-routes/questions.js — public vote submission + live aggregated results.
// Results are ALWAYS aggregate-only — no participant identity is ever
// returned here. Per-participant answers are only readable via the
// authenticated host export (poll-routes/host.js).
const express = require('express');
const db = require('../poll-db');
const { generateVoteId } = require('../poll-utils');

const router = express.Router();

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'of',
  'in', 'on', 'for', 'with', 'it', 'this', 'that', 'i', 'we', 'you', 'they',
  'be', 'as', 'at', 'by', 'my', 'our', 'their', 'his', 'her',
]);

// POST /api/questions/:id/vote — body: { deviceToken, answer }
router.post('/:id/vote', async (req, res) => {
  const { id } = req.params;
  const { deviceToken, answer } = req.body || {};

  if (!deviceToken || answer === undefined || answer === null) {
    return res.status(400).json({ error: 'deviceToken and answer are required.' });
  }

  const question = await db.get('SELECT * FROM poll_questions WHERE id = $1', [id]);
  if (!question) return res.status(404).json({ error: 'Question not found.' });
  if (question.status !== 'live') {
    return res.status(409).json({ error: 'This question is not currently open for voting.' });
  }

  const participant = await db.get(
    'SELECT * FROM poll_participants WHERE session_id = $1 AND device_token = $2',
    [question.session_id, deviceToken]
  );
  if (!participant) {
    return res.status(401).json({ error: 'Join the poll before voting.' });
  }

  await db.run(
    `INSERT INTO poll_votes (id, question_id, participant_id, answer, submitted_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (question_id, participant_id)
     DO UPDATE SET answer = EXCLUDED.answer, submitted_at = EXCLUDED.submitted_at`,
    [generateVoteId(), question.id, participant.id, JSON.stringify(answer), new Date().toISOString()]
  );

  res.status(201).json({ ok: true });
});

// GET /api/questions/:id/results — aggregated, shape depends on question type.
router.get('/:id/results', async (req, res) => {
  const { id } = req.params;
  const question = await db.get('SELECT * FROM poll_questions WHERE id = $1', [id]);
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  const votes = await db.all('SELECT answer FROM poll_votes WHERE question_id = $1 ORDER BY submitted_at ASC', [id]);
  const total = votes.length;

  let results;
  if (question.type === 'multiple_choice' || question.type === 'true_false' || question.type === 'quiz') {
    const options = Array.isArray(question.options?.choices) ? question.options.choices : [];
    const counts = Object.fromEntries(options.map((o) => [o, 0]));
    for (const v of votes) {
      const opt = v.answer?.option;
      if (opt !== undefined && counts[opt] !== undefined) counts[opt] += 1;
    }
    results = { type: question.type, total, counts };
    if (question.type === 'quiz') {
      results.correctOption = question.revealed ? question.correct_option : null;
    }
  } else if (question.type === 'rating') {
    const min = question.options?.min ?? 1;
    const max = question.options?.max ?? 5;
    const counts = {};
    for (let i = min; i <= max; i++) counts[i] = 0;
    let sum = 0;
    let n = 0;
    for (const v of votes) {
      const val = Number(v.answer?.value);
      if (Number.isFinite(val) && counts[val] !== undefined) {
        counts[val] += 1;
        sum += val;
        n += 1;
      }
    }
    results = { type: 'rating', total, counts, average: n ? +(sum / n).toFixed(2) : null, min, max };
  } else if (question.type === 'open_text') {
    // Full free-text answers, most recent first — read individually rather
    // than reduced to word frequency (that's what word_cloud is for).
    // Capped so a 700-person burst doesn't blow up the payload; the host CSV
    // export still has every single response regardless of this cap.
    const responses = votes
      .map((v) => String(v.answer?.text || '').trim())
      .filter(Boolean)
      .reverse()
      .slice(0, 60);
    results = { type: 'open_text', total, responses };
  } else if (question.type === 'word_cloud') {
    const freq = new Map();
    for (const v of votes) {
      const text = String(v.answer?.text || '').toLowerCase();
      const words = text.match(/[a-z0-9']+/g) || [];
      for (const w of words) {
        if (w.length < 2 || STOPWORDS.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    const words = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([text, count]) => ({ text, count }));
    results = { type: 'word_cloud', total, words };
  } else if (question.type === 'ranking') {
    const items = Array.isArray(question.options?.items) ? question.options.items : [];
    // Borda-count-style aggregate: each item scores (N - position) points per ballot.
    const scores = Object.fromEntries(items.map((i) => [i, 0]));
    for (const v of votes) {
      const order = Array.isArray(v.answer?.order) ? v.answer.order : [];
      order.forEach((item, idx) => {
        if (scores[item] !== undefined) scores[item] += order.length - idx;
      });
    }
    const standings = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    results = { type: 'ranking', total, standings };
  } else if (question.type === 'pulse') {
    const options = Array.isArray(question.options?.choices) ? question.options.choices : ['up', 'neutral', 'down'];
    const counts = Object.fromEntries(options.map((o) => [o, 0]));
    for (const v of votes) {
      const opt = v.answer?.option;
      if (opt !== undefined && counts[opt] !== undefined) counts[opt] += 1;
    }
    results = { type: 'pulse', total, counts };
  } else {
    results = { type: question.type, total };
  }

  res.set('Cache-Control', 's-maxage=1, stale-while-revalidate=2');
  res.json(results);
});

module.exports = router;
