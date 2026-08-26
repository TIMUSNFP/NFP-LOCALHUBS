// routes/admin.js — admin login + protected hub/participant management.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { hubRowToJson, participantRowToJson, geocodeHub, generateHubMergeId, generateHubId } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { readFormSettings } = require('./settings');
const {
  sendHubApproved,
  sendHubCarriedToNextEdition,
  sendHubRejected,
  sendParticipantConfirmed,
  sendParticipantCancelled,
  sendHubRosterUpdate,
  sendHubDetailsUpdated,
  sendParticipantTransferred,
  sendParticipantEventReminder,
  sendParticipantCircleCombined,
  sendHubLeaderCircleMerged,
  sendParticipantCircleMergeReverted,
  sendHubLeaderCircleMergeReverted,
} = require('../mailer');

const router = express.Router();

const VALID_HUB_STATUSES = ['Approved', 'Rejected', 'Pending'];
const VALID_PARTICIPANT_STATUSES = ['Confirmed', 'Cancelled', 'Pending'];

// Fields an admin may correct on a hub, camelCase (API/body) -> DB column.
const EDITABLE_HUB_FIELDS = {
  fullName: 'full_name',
  email: 'email',
  mobile: 'mobile',
  membership: 'membership',
  city: 'city',
  area: 'area',
  address: 'address',
  pincode: 'pincode',
  venueType: 'venue_type',
  capacity: 'capacity',
  hostedBefore: 'hosted_before',
  hostingFrequency: 'hosting_frequency',
  pocRole: 'poc_role',
};

// Subset of EDITABLE_HUB_FIELDS worth telling participants about when changed —
// e.g. a corrected email or "hosted before?" answer isn't their concern, but the
// venue address or leader's contact number is.
const NOTIFY_HUB_FIELDS = {
  fullName: 'Circle Leader Name',
  mobile: 'Circle Leader Mobile Number',
  city: 'City',
  area: 'Area / Locality',
  address: 'Address',
  pincode: 'PIN Code',
  venueType: 'Venue Type',
  capacity: 'Hosting Capacity',
};

// POST /api/admin/login — public.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Trim the env values — Vercel/.env values often pick up a trailing newline,
  // which would otherwise make a perfectly correct bcrypt hash fail to match.
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

// GET /api/admin/settings — current open/closed state of the public forms.
router.get('/settings', async (req, res) => {
  res.json(await readFormSettings());
});

// PATCH /api/admin/settings — open or close the public forms, or change which
// edition new public submissions get tagged with.
// Body: { hubFormOpen?: boolean, participantFormOpen?: boolean, activeEdition?: number }
router.patch('/settings', async (req, res) => {
  try {
    const { hubFormOpen, participantFormOpen, activeEdition } = req.body || {};

    const upsert = (key, val) =>
      db.run(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, val]
      );

    if (typeof hubFormOpen === 'boolean') await upsert('hub_form_open', hubFormOpen ? 'true' : 'false');
    if (typeof participantFormOpen === 'boolean') await upsert('participant_form_open', participantFormOpen ? 'true' : 'false');
    if (Number.isInteger(activeEdition) && activeEdition > 0) await upsert('active_edition', String(activeEdition));

    res.json(await readFormSettings());
  } catch (e) {
    console.error('[admin/settings] PATCH failed:', e.message);
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

// GET /api/admin/hubs — all hubs regardless of status. Optional ?edition=N scopes
// to one edition; omitted returns every edition (admin can always see everything).
router.get('/hubs', async (req, res) => {
  try {
    const edition = parseInt(req.query.edition, 10);
    const rows = Number.isInteger(edition)
      ? await db.all('SELECT * FROM hubs WHERE edition = $1 ORDER BY submitted_at DESC', [edition])
      : await db.all('SELECT * FROM hubs ORDER BY submitted_at DESC');
    res.json(rows.map(hubRowToJson));
  } catch (e) {
    // Express 4 doesn't catch a rejected promise from an async handler on its
    // own — without this, a DB error here (e.g. a migration not yet applied)
    // leaves the request hanging until Vercel's own timeout kills it with an
    // opaque 504, instead of failing fast with a readable error.
    console.error('[admin/hubs] GET failed:', e.message);
    res.status(500).json({ error: 'Failed to load applications.' });
  }
});

// PATCH /api/admin/hubs/:id/status
router.patch('/hubs/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_HUB_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_HUB_STATUSES.join(', ')}` });
  }

  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });

  const lastUpdated = new Date().toISOString();
  await db.run('UPDATE hubs SET status = $1, last_updated = $2 WHERE id = $3', [
    status,
    lastUpdated,
    req.params.id,
  ]);

  // Geocode on approval (only if coords are missing). This is the moment the hub
  // becomes visible on the map and in the PIN-code nearby search, so it's the right
  // time to resolve a precise pin — and it keeps public submission fast.
  // geocodeHub can chain up to ~8 fallback attempts (each with its own 4s
  // timeout), so a run of misses can otherwise hold this response open for
  // 20-30s+. Cap the whole chain at 5s here — an admin click must never wait
  // on a third-party geocoder; a miss just leaves lat/lng null for now (the
  // frontend already falls back to city-centre coords in that case).
  if (status === 'Approved' && (hub.lat == null || hub.lng == null)) {
    try {
      const coords = await Promise.race([
        geocodeHub({ address: hub.address, area: hub.area, city: hub.city, pincode: hub.pincode }),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);
      if (coords) {
        const [lat, lng] = coords;
        await db.run('UPDATE hubs SET lat = $1, lng = $2 WHERE id = $3', [lat, lng, req.params.id]);
      }
    } catch (e) {
      // Best-effort; frontend falls back to city-centre coords if this stays null.
    }
  }

  const updated = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);

  // Fire approval/rejection email — non-blocking, errors are swallowed in mailer.
  // Resetting back to Pending is silent (no email) — it's an internal correction,
  // not a decision the applicant needs to hear about.
  if (status === 'Approved') sendHubApproved(updated);
  else if (status === 'Rejected') sendHubRejected(updated);

  res.json(hubRowToJson(updated));
});

// PATCH /api/admin/hubs/:id — correct a Circle Leader's own details (address,
// city, venue, etc). Only whitelisted fields are accepted. Any change to a
// participant-relevant field (NOTIFY_HUB_FIELDS) is accumulated into
// pending_change_summary so an admin can later email affected participants via
// POST /hubs/:id/notify-update — it does not send anything itself.
router.patch('/hubs/:id', async (req, res) => {
  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });

  const body = req.body || {};
  const setClauses = [];
  const values = [];
  const notifyDiff = [];
  const LOCATION_FIELDS = ['address', 'area', 'city', 'pincode'];
  let locationChanged = false;

  for (const [field, column] of Object.entries(EDITABLE_HUB_FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const newValue = body[field];
    const oldValue = hub[column];
    if (newValue === oldValue) continue;

    values.push(newValue);
    setClauses.push(`${column} = $${values.length}`);

    if (LOCATION_FIELDS.includes(field)) locationChanged = true;
    if (NOTIFY_HUB_FIELDS[field]) {
      notifyDiff.push({ field, label: NOTIFY_HUB_FIELDS[field], oldValue, newValue });
    }
  }

  if (setClauses.length === 0) {
    return res.json(hubRowToJson(hub));
  }

  // Merge this save's diff into any still-unnotified changes: a field already
  // pending keeps its original oldValue (the value participants last saw), only
  // its newValue advances — so several edits before a notify collapse into one
  // net change instead of overwriting each other.
  const existingSummary = Array.isArray(hub.pending_change_summary) ? hub.pending_change_summary : [];
  const mergedByField = new Map(existingSummary.map((entry) => [entry.field, entry]));
  for (const entry of notifyDiff) {
    const prior = mergedByField.get(entry.field);
    mergedByField.set(entry.field, prior ? { ...entry, oldValue: prior.oldValue } : entry);
  }
  const mergedSummary = Array.from(mergedByField.values());

  values.push(JSON.stringify(mergedSummary));
  setClauses.push(`pending_change_summary = $${values.length}`);

  values.push(new Date().toISOString());
  setClauses.push(`last_updated = $${values.length}`);

  values.push(req.params.id);
  await db.run(`UPDATE hubs SET ${setClauses.join(', ')} WHERE id = $${values.length}`, values);

  let updated = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);

  // The map pin is only ever set once, at approval time — if an admin corrects
  // the address/area/city/pincode afterward, re-geocode now so the pin doesn't
  // silently keep pointing at the old (or wrong) location. Best-effort, same
  // as the approval-time geocode: a geocoder hiccup should never break the save.
  if (locationChanged) {
    try {
      const coords = await geocodeHub({
        address: updated.address,
        area: updated.area,
        city: updated.city,
        pincode: updated.pincode,
      });
      if (coords) {
        const [lat, lng] = coords;
        await db.run('UPDATE hubs SET lat = $1, lng = $2 WHERE id = $3', [lat, lng, req.params.id]);
        updated = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
      }
    } catch (e) {
      // Best-effort; existing lat/lng (however stale) is left untouched.
    }
  }

  res.json(hubRowToJson(updated));
});

// GET /api/admin/participants — all participants, joined with hub fields.
// Optional ?edition=N scopes to one edition (matching the participant's own
// edition, not the hub's — a participant always belongs to whichever edition
// they registered for).
router.get('/participants', async (req, res) => {
  try {
    const edition = parseInt(req.query.edition, 10);
    const rows = Number.isInteger(edition)
      ? await db.all(
          `SELECT p.*, h.full_name AS hub_leader, h.city AS hub_city, h.area AS hub_area, h.venue_type AS hub_venue
           FROM participants p
           JOIN hubs h ON h.id = p.hub_id
           WHERE p.edition = $1
           ORDER BY p.registered_at DESC`,
          [edition]
        )
      : await db.all(
          `SELECT p.*, h.full_name AS hub_leader, h.city AS hub_city, h.area AS hub_area, h.venue_type AS hub_venue
           FROM participants p
           JOIN hubs h ON h.id = p.hub_id
           ORDER BY p.registered_at DESC`
        );

    res.json(
      rows.map((row) => ({
        ...participantRowToJson(row),
        hubLeader: row.hub_leader,
        hubCity: row.hub_city,
        hubArea: row.hub_area,
        hubVenue: row.hub_venue,
      }))
    );
  } catch (e) {
    console.error('[admin/participants] GET failed:', e.message);
    res.status(500).json({ error: 'Failed to load participants.' });
  }
});

// POST /api/admin/hubs/:id/send-roster — email an approved Circle Leader their
// current list of Confirmed participants (name + mobile). On-demand only, not
// tied to a status change, so it can be re-sent as new participants confirm.
router.post('/hubs/:id/send-roster', async (req, res) => {
  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });
  if (hub.status !== 'Approved') {
    return res.status(400).json({ error: 'Only approved circles can receive a roster email.' });
  }

  const participants = await db.all(
    "SELECT * FROM participants WHERE hub_id = $1 AND status = 'Confirmed' ORDER BY registered_at ASC",
    [req.params.id]
  );

  await sendHubRosterUpdate(hub, participants);

  const rosterSentAt = new Date().toISOString();
  await db.run('UPDATE hubs SET roster_sent_at = $1 WHERE id = $2', [rosterSentAt, req.params.id]);

  res.json({ ok: true, participantCount: participants.length, rosterSentAt });
});

// POST /api/admin/hubs/:id/notify-update — email every Confirmed participant
// about the hub's pending_change_summary (set by PATCH /hubs/:id), then clear it.
// Separate, explicit action from saving an edit so an admin can review the diff
// (and batch several edits) before anyone gets emailed.
router.post('/hubs/:id/notify-update', async (req, res) => {
  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [req.params.id]);
  if (!hub) return res.status(404).json({ error: 'Hub not found' });

  const changes = Array.isArray(hub.pending_change_summary) ? hub.pending_change_summary : [];
  if (changes.length === 0) {
    return res.status(400).json({ error: 'No pending changes to notify participants about.' });
  }

  const participants = await db.all(
    "SELECT * FROM participants WHERE hub_id = $1 AND status = 'Confirmed' ORDER BY registered_at ASC",
    [req.params.id]
  );

  await Promise.all(participants.map((p) => sendHubDetailsUpdated(p, hub, changes)));

  const changeNotifiedAt = new Date().toISOString();
  await db.run('UPDATE hubs SET pending_change_summary = NULL, change_notified_at = $1 WHERE id = $2', [
    changeNotifiedAt,
    req.params.id,
  ]);

  res.json({ ok: true, participantCount: participants.length, changeNotifiedAt });
});

// DELETE /api/admin/hubs/:id — permanently remove a hub leader application. This is
// how an admin frees up an email/mobile so the person can apply again. Blocked if
// the circle already has participants registered under it — those must be moved
// or deleted first so a hub delete never silently orphans participant data.
router.delete('/hubs/:id', async (req, res) => {
  const existing = await db.get('SELECT id FROM hubs WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Hub not found' });

  const countRow = await db.get('SELECT COUNT(*) as cnt FROM participants WHERE hub_id = $1', [req.params.id]);
  if (countRow && Number(countRow.cnt) > 0) {
    return res.status(409).json({
      error: `This circle has ${countRow.cnt} participant(s) registered. Remove or reassign them before deleting the hub.`,
    });
  }

  await db.run('DELETE FROM hubs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// PATCH /api/admin/participants/:id/status
router.patch('/participants/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_PARTICIPANT_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ error: `status must be one of: ${VALID_PARTICIPANT_STATUSES.join(', ')}` });
  }

  const participant = await db.get('SELECT * FROM participants WHERE id = $1', [req.params.id]);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });

  if (status === 'Confirmed') {
    // Marked sent at the same moment the email is fired below — this is what
    // lets "Send Confirmation to Never-Sent" tell a normal confirm apart from
    // a participant who's Confirmed but never actually got the email (e.g.
    // imported/bulk-transferred data, or an earlier send that predates this
    // column existing).
    await db.run(
      'UPDATE participants SET status = $1, confirmation_sent_at = $2 WHERE id = $3',
      [status, new Date().toISOString(), req.params.id]
    );
  } else {
    await db.run('UPDATE participants SET status = $1 WHERE id = $2', [status, req.params.id]);
  }

  const updated = await db.get('SELECT * FROM participants WHERE id = $1', [req.params.id]);

  // Fire confirmation/cancellation email — non-blocking, errors are swallowed in mailer.
  // Resetting back to Pending is silent (no email) — same convention as hubs.
  if (status === 'Confirmed' || status === 'Cancelled') {
    const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [updated.hub_id]);
    if (status === 'Confirmed') sendParticipantConfirmed(updated, hub);
    else sendParticipantCancelled(updated, hub);
  }

  res.json(participantRowToJson(updated));
});

// POST /api/admin/participants/:id/send-confirmation — (re)send the "Registration
// Confirmed" email to a single Confirmed participant, on demand. Not tied to a
// status change, so it doubles as a reminder/resend — e.g. for someone who
// never actually got the original email (bounced, wrong inbox, imported data),
// or who just wants it back in their inbox.
router.post('/participants/:id/send-confirmation', async (req, res) => {
  const participant = await db.get('SELECT * FROM participants WHERE id = $1', [req.params.id]);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });
  if (participant.status !== 'Confirmed') {
    return res.status(400).json({ error: 'Only Confirmed participants can receive a confirmation email.' });
  }

  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [participant.hub_id]);
  await sendParticipantConfirmed(participant, hub);

  const confirmationSentAt = new Date().toISOString();
  await db.run('UPDATE participants SET confirmation_sent_at = $1 WHERE id = $2', [confirmationSentAt, req.params.id]);

  res.json({ ok: true, confirmationSentAt });
});

// POST /api/admin/participants/:id/send-event-reminder — the "5 days to go"
// reminder (schedule image + circle leader's contact for anyone not yet in the
// WhatsApp group), sent on demand to a single Confirmed participant. Same
// on-demand/resend convention as send-confirmation above.
router.post('/participants/:id/send-event-reminder', async (req, res) => {
  const participant = await db.get('SELECT * FROM participants WHERE id = $1', [req.params.id]);
  if (!participant) return res.status(404).json({ error: 'Participant not found' });
  if (participant.status !== 'Confirmed') {
    return res.status(400).json({ error: 'Only Confirmed participants can receive an event reminder.' });
  }

  const hub = await db.get('SELECT * FROM hubs WHERE id = $1', [participant.hub_id]);
  await sendParticipantEventReminder(participant, hub);

  const eventReminderSentAt = new Date().toISOString();
  await db.run('UPDATE participants SET event_reminder_sent_at = $1 WHERE id = $2', [eventReminderSentAt, req.params.id]);

  res.json({ ok: true, eventReminderSentAt });
});

// POST /api/admin/participants/transfer — moves one or more participants to a
// different Approved circle (e.g. their original circle is full, cancelled, or
// a better-located one opened up) and emails each of them showing their old and
// new Circle Leader/venue. Deliberately does not enforce the destination
// circle's capacity — an admin-initiated transfer is an override, not a public
// registration subject to the normal capacity check in routes/participants.js.
router.post('/participants/transfer', async (req, res) => {
  const { participantIds, newHubId } = req.body || {};
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'participantIds[] is required.' });
  }
  if (!newHubId) {
    return res.status(400).json({ error: 'newHubId is required.' });
  }

  const newHub = await db.get('SELECT * FROM hubs WHERE id = $1', [newHubId]);
  if (!newHub) return res.status(404).json({ error: 'Destination circle not found.' });
  if (newHub.status !== 'Approved') {
    return res.status(400).json({ error: 'Destination circle must be an Approved circle.' });
  }

  let transferred = 0;
  let skipped = 0;
  for (const pid of participantIds) {
    const participant = await db.get('SELECT * FROM participants WHERE id = $1', [pid]);
    if (!participant || participant.hub_id === newHubId) {
      skipped++;
      continue;
    }

    const oldHub = await db.get('SELECT * FROM hubs WHERE id = $1', [participant.hub_id]);
    await db.run('UPDATE participants SET hub_id = $1 WHERE id = $2', [newHubId, pid]);
    const updated = await db.get('SELECT * FROM participants WHERE id = $1', [pid]);
    transferred++;

    // Fire transfer email — non-blocking, errors are swallowed in mailer.
    sendParticipantTransferred(updated, oldHub, newHub);
  }

  res.json({ transferred, skipped, newHub: hubRowToJson(newHub) });
});

// POST /api/admin/hubs/:id/combine — combine two circles into one. :id is the
// circle being CLOSED, body { targetHubId } is the circle that SURVIVES — its
// own details (leader, address, venue, capacity) are what's shown going forward.
// Every non-Cancelled participant on the closing circle is moved over (same
// mechanics as /participants/transfer above, reused directly) and emailed with
// the combined circle's details; the closing circle's own leader gets a
// separate note; the closing circle itself is kept (not deleted) with
// status = 'Merged' so it stays out of every "Approved circles" surface
// (public site, CRM targeting, dashboard widgets) while remaining visible in
// the admin panel for history.
//
// Records exactly which participants moved in hub_merges, so a later
// /revert-merge can move back precisely those still sitting in the surviving
// hub — not anyone who joined it independently since, or was manually
// transferred elsewhere in the meantime.
router.post('/hubs/:id/combine', async (req, res) => {
  const { targetHubId } = req.body || {};
  const closingHubId = req.params.id;

  if (!targetHubId) {
    return res.status(400).json({ error: 'targetHubId is required.' });
  }
  if (targetHubId === closingHubId) {
    return res.status(400).json({ error: 'Cannot combine a circle with itself.' });
  }

  const closingHub = await db.get('SELECT * FROM hubs WHERE id = $1', [closingHubId]);
  if (!closingHub) return res.status(404).json({ error: 'Circle to close not found.' });
  if (closingHub.status !== 'Approved') {
    return res.status(400).json({ error: 'Only an Approved circle can be combined.' });
  }

  const survivingHub = await db.get('SELECT * FROM hubs WHERE id = $1', [targetHubId]);
  if (!survivingHub) return res.status(404).json({ error: 'Target circle not found.' });
  if (survivingHub.status !== 'Approved') {
    return res.status(400).json({ error: 'Target circle must be an Approved circle.' });
  }

  const movingParticipants = await db.all(
    "SELECT * FROM participants WHERE hub_id = $1 AND status != 'Cancelled'",
    [closingHubId]
  );

  const movedParticipantIds = [];
  for (const participant of movingParticipants) {
    await db.run('UPDATE participants SET hub_id = $1 WHERE id = $2', [targetHubId, participant.id]);
    const updated = await db.get('SELECT * FROM participants WHERE id = $1', [participant.id]);
    movedParticipantIds.push(participant.id);
    // Fire notification emails — non-blocking, errors are swallowed in mailer.
    sendParticipantCircleCombined(updated, closingHub, survivingHub);
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE hubs SET status = 'Merged', merged_into_hub_id = $1, merged_at = $2, last_updated = $2 WHERE id = $3`,
    [targetHubId, now, closingHubId]
  );
  await db.run(
    `INSERT INTO hub_merges (id, closing_hub_id, target_hub_id, participant_ids, merged_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [generateHubMergeId(), closingHubId, targetHubId, JSON.stringify(movedParticipantIds), now]
  );

  // Let the closing circle's own Leader know — non-blocking, same as above.
  sendHubLeaderCircleMerged(closingHub, survivingHub, movedParticipantIds.length);

  const updatedClosingHub = await db.get('SELECT * FROM hubs WHERE id = $1', [closingHubId]);
  res.json({
    movedParticipants: movedParticipantIds.length,
    closingHub: hubRowToJson(updatedClosingHub),
    survivingHub: hubRowToJson(survivingHub),
  });
});

// POST /api/admin/hubs/:id/revert-merge — undo a combine. :id is the closed
// (Merged) circle. Looks up the still-active hub_merges row for it (the one
// its own /combine call created) and moves back only the participants that
// (a) were part of that exact merge, AND (b) are still sitting in the
// surviving hub — anyone who's since been manually transferred elsewhere is
// deliberately left alone and counted as skipped, not force-moved.
router.post('/hubs/:id/revert-merge', async (req, res) => {
  const closingHubId = req.params.id;

  const closingHub = await db.get('SELECT * FROM hubs WHERE id = $1', [closingHubId]);
  if (!closingHub) return res.status(404).json({ error: 'Circle not found.' });
  if (closingHub.status !== 'Merged') {
    return res.status(400).json({ error: 'Only a Merged circle can be reverted.' });
  }

  const merge = await db.get(
    'SELECT * FROM hub_merges WHERE closing_hub_id = $1 AND reverted_at IS NULL ORDER BY merged_at DESC LIMIT 1',
    [closingHubId]
  );
  if (!merge) return res.status(404).json({ error: 'No active merge record found for this circle.' });

  const survivingHub = await db.get('SELECT * FROM hubs WHERE id = $1', [merge.target_hub_id]);
  const participantIds = merge.participant_ids || [];

  let restoredCount = 0;
  let skippedCount = 0;
  for (const pid of participantIds) {
    const participant = await db.get('SELECT * FROM participants WHERE id = $1', [pid]);
    if (!participant || participant.hub_id !== merge.target_hub_id) {
      skippedCount++;
      continue;
    }
    await db.run('UPDATE participants SET hub_id = $1 WHERE id = $2', [closingHubId, pid]);
    const updated = await db.get('SELECT * FROM participants WHERE id = $1', [pid]);
    restoredCount++;
    // Fire notification emails — non-blocking, errors are swallowed in mailer.
    if (survivingHub) sendParticipantCircleMergeReverted(updated, survivingHub, closingHub);
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE hubs SET status = 'Approved', merged_into_hub_id = NULL, merged_at = NULL, last_updated = $1 WHERE id = $2`,
    [now, closingHubId]
  );
  await db.run(`UPDATE hub_merges SET reverted_at = $1 WHERE id = $2`, [now, merge.id]);

  if (survivingHub) sendHubLeaderCircleMergeReverted(closingHub, survivingHub, restoredCount);

  const updatedHub = await db.get('SELECT * FROM hubs WHERE id = $1', [closingHubId]);
  res.json({
    restoredParticipants: restoredCount,
    skippedParticipants: skippedCount,
    hub: hubRowToJson(updatedHub),
  });
});

// POST /api/admin/hubs/:id/move-to-next-edition — carry an already-vetted Circle
// Leader forward into the next edition without making them re-apply. :id is the
// source hub (must be Approved and not already carried over). Creates a brand
// new hub row for the target edition, pre-approved, copying the reusable profile
// fields (leader identity, location, venue) but starting with zero participants —
// participants register fresh each edition, this action is leaders-only. Lineage
// is recorded both ways via carried_over_from_hub_id / carried_over_to_hub_id
// (mirrors merged_into_hub_id on the Combine Circles path above) so the admin UI
// can show "→ Edition N" on the source row instead of the action button.
router.post('/hubs/:id/move-to-next-edition', async (req, res) => {
  try {
    const sourceHubId = req.params.id;

    const sourceHub = await db.get('SELECT * FROM hubs WHERE id = $1', [sourceHubId]);
    if (!sourceHub) return res.status(404).json({ error: 'Circle not found.' });
    if (sourceHub.status !== 'Approved') {
      return res.status(400).json({ error: 'Only an Approved circle can be moved to the next edition.' });
    }
    if (sourceHub.carried_over_to_hub_id) {
      return res.status(400).json({ error: 'This circle has already been moved to a later edition.' });
    }

    const { activeEdition } = await readFormSettings();
    const targetEdition = (req.body && req.body.targetEdition) || activeEdition;
    if (targetEdition <= sourceHub.edition) {
      return res.status(400).json({ error: 'Target edition must be later than the circle\'s current edition.' });
    }

    const newHubId = generateHubId();
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO hubs (
        id, submitted_at, last_updated, status, full_name, email, mobile, membership,
        city, area, address, pincode, venue_type, capacity, hosted_before, hosting_frequency,
        poc_role, lat, lng, edition, carried_over_from_hub_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )`,
      [
        newHubId, now, null, 'Approved', sourceHub.full_name, sourceHub.email, sourceHub.mobile,
        sourceHub.membership, sourceHub.city, sourceHub.area, sourceHub.address, sourceHub.pincode,
        sourceHub.venue_type, sourceHub.capacity, sourceHub.hosted_before, sourceHub.hosting_frequency,
        sourceHub.poc_role, sourceHub.lat, sourceHub.lng, targetEdition, sourceHubId,
      ]
    );

    await db.run(
      `UPDATE hubs SET carried_over_to_hub_id = $1, last_updated = $2 WHERE id = $3`,
      [newHubId, now, sourceHubId]
    );

    const updatedSourceHub = await db.get('SELECT * FROM hubs WHERE id = $1', [sourceHubId]);
    const newHub = await db.get('SELECT * FROM hubs WHERE id = $1', [newHubId]);

    // Let the Circle Leader know they're set for the new edition — pass the
    // NEW hub row (not the source) so the email shows the new edition's own
    // date/theme, not the one they're leaving. Non-blocking, errors are
    // swallowed in mailer, same as every other admin action here.
    sendHubCarriedToNextEdition(newHub);

    res.json({
      sourceHub: hubRowToJson(updatedSourceHub),
      newHub: hubRowToJson(newHub),
    });
  } catch (e) {
    console.error('[admin/hubs/move-to-next-edition] failed:', e.message);
    res.status(500).json({ error: 'Could not move this circle to the next edition.' });
  }
});

// GET /api/admin/editions — every edition that has at least one hub or
// participant row (plus activeEdition + 1, always included so the admin can
// see "the next edition" as a selectable option even before anyone's been
// moved into it), together with each known edition's theme/event details
// from the `editions` table where set.
router.get('/editions', async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT edition FROM hubs
       UNION
       SELECT edition FROM participants
       UNION
       SELECT edition FROM editions`
    );
    const { activeEdition } = await readFormSettings();
    const editionNumbers = new Set(rows.map(r => Number(r.edition)));
    editionNumbers.add(activeEdition);
    editionNumbers.add(activeEdition + 1);

    const detailRows = await db.all('SELECT * FROM editions');
    const details = {};
    detailRows.forEach((r) => {
      details[r.edition] = {
        themeTitle: r.theme_title,
        themeTagline: r.theme_tagline,
        eventDate: r.event_date,
        eventTimeStart: r.event_time_start,
        eventTimeEnd: r.event_time_end,
      };
    });

    res.json({
      editions: Array.from(editionNumbers).sort((a, b) => a - b),
      active: activeEdition,
      details,
    });
  } catch (e) {
    console.error('[admin/editions] GET failed:', e.message);
    res.status(500).json({ error: 'Failed to load editions.' });
  }
});

// POST /api/admin/editions/start — advances the active edition AND records
// the new edition's theme/event details in one step, captured at the moment
// of starting rather than a separate settings screen, since that's the one
// moment the admin is already deciding what's changing. Does NOT carry any
// hubs/participants forward — see POST /hubs/:id/move-to-next-edition.
router.post('/editions/start', async (req, res) => {
  try {
    const { themeTitle, themeTagline, eventDate, eventTimeStart, eventTimeEnd } = req.body || {};
    if (!themeTitle || !eventDate || !eventTimeStart || !eventTimeEnd) {
      return res.status(400).json({ error: 'themeTitle, eventDate, eventTimeStart, and eventTimeEnd are required.' });
    }

    const { activeEdition } = await readFormSettings();
    const next = activeEdition + 1;

    await db.run(
      `INSERT INTO settings (key, value) VALUES ('active_edition', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(next)]
    );
    await db.run(
      `INSERT INTO editions (edition, theme_title, theme_tagline, event_date, event_time_start, event_time_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (edition) DO UPDATE SET
         theme_title = EXCLUDED.theme_title,
         theme_tagline = EXCLUDED.theme_tagline,
         event_date = EXCLUDED.event_date,
         event_time_start = EXCLUDED.event_time_start,
         event_time_end = EXCLUDED.event_time_end`,
      [next, themeTitle, themeTagline || null, eventDate, eventTimeStart, eventTimeEnd]
    );

    res.json({ ...(await readFormSettings()), edition: next });
  } catch (e) {
    console.error('[admin/editions/start] failed:', e.message);
    res.status(500).json({ error: 'Could not start the new edition.' });
  }
});

// PATCH /api/admin/editions/:edition — edit an edition's theme/event details
// without touching the active-edition setting (e.g. correcting a date after
// the fact). Works on any edition number, though the admin UI only exposes
// it for the currently active one.
router.patch('/editions/:edition', async (req, res) => {
  try {
    const edition = parseInt(req.params.edition, 10);
    if (!Number.isInteger(edition)) return res.status(400).json({ error: 'Invalid edition.' });

    const { themeTitle, themeTagline, eventDate, eventTimeStart, eventTimeEnd } = req.body || {};
    if (!themeTitle || !eventDate || !eventTimeStart || !eventTimeEnd) {
      return res.status(400).json({ error: 'themeTitle, eventDate, eventTimeStart, and eventTimeEnd are required.' });
    }

    await db.run(
      `INSERT INTO editions (edition, theme_title, theme_tagline, event_date, event_time_start, event_time_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (edition) DO UPDATE SET
         theme_title = EXCLUDED.theme_title,
         theme_tagline = EXCLUDED.theme_tagline,
         event_date = EXCLUDED.event_date,
         event_time_start = EXCLUDED.event_time_start,
         event_time_end = EXCLUDED.event_time_end`,
      [edition, themeTitle, themeTagline || null, eventDate, eventTimeStart, eventTimeEnd]
    );

    const row = await db.get('SELECT * FROM editions WHERE edition = $1', [edition]);
    res.json({
      edition,
      themeTitle: row.theme_title,
      themeTagline: row.theme_tagline,
      eventDate: row.event_date,
      eventTimeStart: row.event_time_start,
      eventTimeEnd: row.event_time_end,
    });
  } catch (e) {
    console.error('[admin/editions/:edition] PATCH failed:', e.message);
    res.status(500).json({ error: "Could not update this edition's details." });
  }
});

// DELETE /api/admin/participants/:id — permanently remove a participant. This is
// how an admin frees up an email/mobile so the person can register again.
router.delete('/participants/:id', async (req, res) => {
  const existing = await db.get('SELECT id FROM participants WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Participant not found' });
  await db.run('DELETE FROM participants WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/admin/sync-sheets — push hub leaders or participants to Google Sheets
// via a Google Apps Script webhook. Set SHEETS_WEBHOOK_URL in your environment.
// Body: { type: 'hubs' | 'participants' }
router.post('/sync-sheets', async (req, res) => {
  const webhookUrl = (process.env.SHEETS_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    return res.status(503).json({ error: 'SHEETS_WEBHOOK_URL is not configured in environment variables.' });
  }

  const { type } = req.body || {};
  if (!['hubs', 'participants'].includes(type)) {
    return res.status(400).json({ error: 'type must be "hubs" or "participants"' });
  }

  // Manual formatting — avoids locale/ICU availability issues in serverless envs.
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const date = `${String(d.getDate()).padStart(2,'0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const h = d.getHours();
    const time = `${String(h % 12 || 12).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    return `${date} ${time}`;
  };

  try {
    let rows;
    if (type === 'hubs') {
      const dbRows = await db.all(
        `SELECT h.*,
           (SELECT COUNT(*) FROM participants p WHERE p.hub_id = h.id AND p.status != 'Cancelled') AS participant_count
         FROM hubs h
         ORDER BY h.submitted_at ASC`
      );
      rows = dbRows.map(r => {
        const hub = hubRowToJson(r);
        return [
          hub.id           || '',
          hub.fullName     || '',
          hub.email        || '',
          hub.mobile       || '',
          hub.membership   || '',
          hub.city         || '',
          hub.area         || '',
          hub.address      || '',
          hub.pincode      || '',
          hub.venueType    || '',
          hub.capacity     || '',
          Number(r.participant_count) || 0,
          hub.hostedBefore || '',
          hub.hostingFrequency || '',
          hub.pocRole === 'assign' ? 'Will assign someone else' : 'Self',
          fmt(hub.submittedAt),
          hub.status       || '',
        ];
      });
    } else {
      const dbRows = await db.all(
        `SELECT p.*, h.full_name AS hub_leader, h.city AS hub_city, h.area AS hub_area, h.venue_type AS hub_venue
         FROM participants p LEFT JOIN hubs h ON h.id = p.hub_id ORDER BY p.registered_at ASC`
      );
      rows = dbRows.map(row => {
        const p = participantRowToJson(row);
        return [
          p.id        || '',
          p.fullName  || '',
          p.email     || '',
          p.mobile    || '',
          p.membership || '',
          row.hub_leader || '',
          row.hub_city   || '',
          row.hub_area   || '',
          p.note         || '',
          fmt(p.registeredAt),
          p.status    || '',
        ];
      });
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, rows }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return res.status(502).json({ error: `Sheets webhook returned ${response.status}: ${text}` });
    }
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    res.status(502).json({ error: `Could not reach Sheets webhook: ${e.message}` });
  }
});

module.exports = router;
