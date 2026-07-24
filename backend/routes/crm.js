// routes/crm.js — "NFP Circle CRM": the cold-outreach contact list (NFP Members /
// QPFP Certificants) and the city-targeted campaigns used to email them about open
// Circles. Deliberately separate from hubs/participants — these are people who
// haven't registered for anything yet.
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { generateCrmContactId, generateCrmCampaignId, normalizeCityKey, hubRowToJson, sleep } = require('../utils');
const { buildCircleCrmEmailHtml, sendCrmCampaignEmail } = require('../mailer');

const router = express.Router();
router.use(requireAdmin);

// Express 4 does not catch rejected promises from async route handlers — an
// uncaught rejection here becomes an unhandled rejection at the process level and
// crashes the whole server, not just the request. This is a bulk-processing route
// file (2000+ row imports, batched sends), so errors are much more likely than
// elsewhere in the app; wrap every handler and forward failures to app.js's error
// middleware instead.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Lets one campaign subject read differently per recipient — e.g. "NFP Circles
// are open in {city}!" becomes "...in Mumbai!" for a Mumbai contact. Strips
// stray CR/LF from the city before substitution (a subject line becomes an
// email header at send time, and a newline in the substituted value can be used
// to inject extra headers — city is admin-imported spreadsheet data, so this is
// defense in depth rather than a response to any known bad input).
function renderCrmSubject(template, city) {
  const safeCity = String(city || 'your city').replace(/[\r\n]+/g, ' ').trim();
  return String(template || '').replace(/\{city\}/gi, safeCity);
}

// A standalone "QPFP" membership value is folded into "Member + QPFP" — every
// QPFP Certificant is treated as part of that combined group rather than a
// separate bucket, so campaign targeting only ever needs to distinguish
// "Member" vs "Member + QPFP", not a third category. Applied at import time so
// re-importing the same source sheet later doesn't undo the merge.
function normalizeCrmMembership(raw) {
  return raw === 'QPFP' ? 'Member + QPFP' : raw;
}

// Column-header aliases so a re-export with slightly different wording/column
// order still imports correctly — matched case-insensitively against the
// uploaded sheet's actual header row.
const HEADER_ALIASES = {
  name: ['name', 'full name'],
  email: ['email id', 'email', 'e-mail'],
  mobile: ['phone number', 'mobile no.', 'mobile number', 'mobile', 'phone'],
  city: ['city'],
  batch: ['their batch', 'batch', 'qpfp batch'],
  membership: ['membership type', 'membership'],
};

function contactRowToJson(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    city: row.city,
    cityKey: row.city_key,
    membership: row.membership,
    batch: row.batch,
    source: row.source,
    importedAt: row.imported_at,
    unsubscribedAt: row.unsubscribed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function campaignRowToJson(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    targetMode: row.target_mode || 'manual',
    targetCities: row.target_cities || [],
    hubIds: row.hub_ids || [],
    targetBatches: row.target_batches || [],
    targetMemberships: row.target_memberships || [],
    subject: row.subject,
    introHtml: row.intro_html,
    batchSize: row.batch_size,
    intervalMinutes: row.interval_minutes,
    totalRecipients: row.total_recipients,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastBatchAt: row.last_batch_at,
  };
}

// ─── Open-circle lookup, shared by manual suggestions and auto-mode targeting ──

// All Approved hubs with a computed participantCount/isFull, in one query each
// (not one COUNT query per hub) — used both by hubs-for-cities (manual mode's
// suggestion list, which shows full hubs too so an admin can still pick one) and
// by groupOpenHubsByCityKey below (auto mode, which must never feature a full one).
async function getApprovedHubsWithCounts() {
  const hubs = await db.all("SELECT * FROM hubs WHERE status = 'Approved' ORDER BY city ASC, area ASC");
  const countRows = await db.all('SELECT hub_id, COUNT(*)::int AS cnt FROM participants GROUP BY hub_id');
  const countMap = new Map(countRows.map((r) => [r.hub_id, r.cnt]));
  return hubs.map((hub) => {
    const capacityLimit = parseInt(hub.capacity, 10);
    const participantCount = countMap.get(hub.id) || 0;
    const isFull = !isNaN(capacityLimit) && capacityLimit > 0 && participantCount >= capacityLimit;
    return { ...hub, participantCount, isFull };
  });
}

// city_key (normalizeCityKey) -> open (non-full) hubs in that city. This is what
// "auto" mode uses to personalize each recipient's email to their own city —
// a full circle is never auto-featured, since there's no admin review step in
// that mode to catch it.
function groupOpenHubsByCityKey(hubsWithCounts) {
  const map = new Map();
  for (const hub of hubsWithCounts) {
    if (hub.isFull) continue;
    const key = normalizeCityKey(hub.city);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(hub);
  }
  return map;
}

// Appends "AND batch = ANY(...)" / "AND membership = ANY(...)" fragments (only
// for whichever filters were actually supplied) to a conditions/params pair
// that's already got its city condition on it. Used identically for the total-
// recipient count, the preview sample, and the /start snapshot, in both manual
// and auto mode — these are optional narrowing filters on top of city
// targeting, e.g. "auto-personalize by city, but only Batch 11/12, QPFP only".
function appendOptionalFilters(conditions, params, targetBatches, targetMemberships) {
  if (Array.isArray(targetBatches) && targetBatches.length > 0) {
    params.push(targetBatches);
    conditions.push(`batch = ANY($${params.length}::text[])`);
  }
  if (Array.isArray(targetMemberships) && targetMemberships.length > 0) {
    params.push(targetMemberships);
    conditions.push(`membership = ANY($${params.length}::text[])`);
  }
}

// ─── Campaign batch processing — server-side scheduler ─────────────────────────
// Runs entirely inside this Node process: once a campaign starts Sending, a
// setInterval here (not the browser) drives it forward at its own
// interval_minutes pacing until Completed or Paused. The admin panel no longer
// needs to stay open for a campaign to keep sending — only the backend process
// itself (npm run dev / the deployed server) needs to keep running.
const campaignTimers = new Map(); // campaignId -> Timeout handle

function scheduleCampaignTimer(campaignId, intervalMinutes) {
  if (campaignTimers.has(campaignId)) return;
  const ms = Math.max(1, intervalMinutes || 15) * 60 * 1000;
  const timer = setInterval(() => {
    runCampaignBatch(campaignId).catch((e) => console.error(`[crm] batch error for ${campaignId}:`, e.message));
  }, ms);
  campaignTimers.set(campaignId, timer);
}

function unscheduleCampaignTimer(campaignId) {
  const timer = campaignTimers.get(campaignId);
  if (timer) {
    clearInterval(timer);
    campaignTimers.delete(campaignId);
  }
}

// Guards against two overlapping runs of the SAME campaign — e.g. the 5-minute
// timer ticking again before a large batch has finished sending. The atomic
// claim already makes overlap safe against duplicate sends, but letting it
// happen anyway was its own bug: each overlapping run claims its own chunk of
// Pending rows, so "how many are claimed right now" balloons well past
// batch_size, and — combined with the old end-of-loop-only counter update —
// made the admin panel's Sent/Total look completely frozen for many minutes
// while real sends were happening underneath it. One run per campaign at a
// time keeps batch_size meaningful and keeps progress visible.
const campaignsCurrentlyRunning = new Set();

// The actual batch-send worker — atomically claims up to batch_size Pending
// recipients (FOR UPDATE SKIP LOCKED means a manual "Send Batch Now" click
// arriving mid-run can never claim the same row a running batch already has),
// sends each with a short stagger, and marks the campaign Completed once
// nothing Pending is left. Used by both the HTTP route (manual trigger) and
// the server-side interval (automatic pacing) — same function, same
// guarantees. sent_count/failed_count update after EVERY send (not once at
// the end) so progress is visible in near-real-time no matter how large or
// slow the batch is.
async function runCampaignBatch(campaignId) {
  if (campaignsCurrentlyRunning.has(campaignId)) {
    return { sentThisBatch: 0, failedThisBatch: 0, remaining: 0, status: 'AlreadyRunning' };
  }
  campaignsCurrentlyRunning.add(campaignId);
  try {
    return await runCampaignBatchInner(campaignId);
  } finally {
    campaignsCurrentlyRunning.delete(campaignId);
  }
}

async function runCampaignBatchInner(campaignId) {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaignId]);
  if (!campaign) return { sentThisBatch: 0, failedThisBatch: 0, remaining: 0, status: 'NotFound' };
  if (campaign.status !== 'Sending') {
    unscheduleCampaignTimer(campaignId);
    return { sentThisBatch: 0, failedThisBatch: 0, remaining: 0, status: campaign.status };
  }

  const claimed = await db.all(
    `WITH claimed AS (
       UPDATE crm_campaign_recipients
       SET status = 'Claimed'
       WHERE id IN (
         SELECT id FROM crm_campaign_recipients
         WHERE campaign_id = $1 AND status = 'Pending'
         ORDER BY id ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, contact_id
     )
     SELECT claimed.id AS recipient_id, c.id, c.full_name, c.email, c.city, c.city_key, c.unsubscribed_at
     FROM claimed JOIN crm_contacts c ON c.id = claimed.contact_id`,
    [campaignId, campaign.batch_size]
  );

  const mode = campaign.target_mode || 'manual';
  const targetCities = campaign.target_cities || [];

  // Manual mode: one fixed hub list for everyone in this batch. Auto mode: a
  // cityKey -> hubs map, looked up per contact below so each person only ever
  // sees circles in their own city — this is the whole point of "auto" mode.
  let manualHubs = [];
  let openMap = null;
  if (mode === 'auto') {
    openMap = groupOpenHubsByCityKey(await getApprovedHubsWithCounts());
  } else {
    const hubIds = campaign.hub_ids || [];
    manualHubs = hubIds.length ? await db.all('SELECT * FROM hubs WHERE id = ANY($1::text[])', [hubIds]) : [];
  }

  let sentThisBatch = 0;
  let failedThisBatch = 0;

  for (const contact of claimed) {
    if (contact.unsubscribed_at) {
      await db.run(`UPDATE crm_campaign_recipients SET status = 'Skipped' WHERE id = $1`, [contact.recipient_id]);
      continue;
    }

    const hubs = mode === 'auto' ? (openMap.get(contact.city_key) || []) : manualHubs;
    if (mode === 'auto' && hubs.length === 0) {
      // Their city no longer has an open circle (e.g. it filled up between start
      // and now) — nothing to tell them, so skip rather than send an empty email.
      await db.run(`UPDATE crm_campaign_recipients SET status = 'Skipped' WHERE id = $1`, [contact.recipient_id]);
      continue;
    }

    try {
      await sendCrmCampaignEmail(
        { id: contact.id, full_name: contact.full_name, email: contact.email, city: contact.city },
        hubs,
        {
          subject: renderCrmSubject(campaign.subject, contact.city),
          introHtml: campaign.intro_html,
          targetCities: mode === 'auto' ? [] : targetCities,
        }
      );
      await db.run(
        `UPDATE crm_campaign_recipients SET status = 'Sent', sent_at = $1 WHERE id = $2`,
        [new Date().toISOString(), contact.recipient_id]
      );
      sentThisBatch++;
      await db.run(`UPDATE crm_campaigns SET sent_count = sent_count + 1, last_batch_at = $1 WHERE id = $2`, [new Date().toISOString(), campaignId]);
    } catch (err) {
      await db.run(
        `UPDATE crm_campaign_recipients SET status = 'Failed', error = $1 WHERE id = $2`,
        [String((err && err.message) || err).slice(0, 500), contact.recipient_id]
      );
      failedThisBatch++;
      await db.run(`UPDATE crm_campaigns SET failed_count = failed_count + 1, last_batch_at = $1 WHERE id = $2`, [new Date().toISOString(), campaignId]);
    }
    await sleep(400);
  }

  const now = new Date().toISOString();
  // Must also count 'Claimed' here, not just 'Pending' — otherwise a campaign
  // can get marked Completed while rows from an interrupted/still-hung run sit
  // claimed-but-unresolved: this run only just claimed ITS OWN batch, but if a
  // separate stuck run's claimed rows haven't been reset back to Pending yet,
  // "0 Pending remaining" is true without every recipient actually being done.
  const remainingRow = await db.get(
    `SELECT COUNT(*)::int AS count FROM crm_campaign_recipients WHERE campaign_id = $1 AND status IN ('Pending', 'Claimed')`,
    [campaignId]
  );
  let status = campaign.status;
  if (remainingRow.count === 0) {
    status = 'Completed';
    await db.run(`UPDATE crm_campaigns SET status = 'Completed', completed_at = $1 WHERE id = $2`, [now, campaignId]);
    unscheduleCampaignTimer(campaignId);
  }

  return { sentThisBatch, failedThisBatch, remaining: remainingRow.count, status };
}

// On process boot: any recipient row still 'Claimed' means a previous process
// died mid-batch, leaving it claimed but never resolved — reset those back to
// Pending so they aren't silently stuck forever. That part is just data
// hygiene and never sends anything on its own.
//
// Campaigns are NOT auto-resumed here. An earlier version of this function did
// exactly that (re-armed the timer and fired an immediate batch for every
// still-Sending campaign) — which meant every server restart silently kept a
// campaign sending for hours with no admin action involved, which is the
// opposite of what was asked for: campaigns must only ever send on an explicit
// click. Any campaign still marked Sending at boot is moved to Paused instead
// — the data is safe and exactly where it left off, but it now needs a
// deliberate "Resume" click to continue, every time, no exceptions.
async function resumeCrmCampaignsOnBoot() {
  try {
    await db.run(`UPDATE crm_campaign_recipients SET status = 'Pending' WHERE status = 'Claimed'`);
    const wasSending = await db.all(`SELECT id, name FROM crm_campaigns WHERE status = 'Sending'`);
    if (wasSending.length > 0) {
      await db.run(`UPDATE crm_campaigns SET status = 'Paused' WHERE status = 'Sending'`);
      console.log(
        `[crm] ${wasSending.length} campaign(s) were still marked Sending at boot — paused, not resumed ` +
        `(requires an explicit Resume click): ${wasSending.map((c) => c.name).join(', ')}`
      );
    }
  } catch (e) {
    console.error('[crm] boot cleanup failed:', e.message);
  }
}
resumeCrmCampaignsOnBoot();

// ─── Contacts ──────────────────────────────────────────────────────────────────

// GET /api/admin/crm/contacts?city=&membership=&search=&page=&pageSize=
router.get('/contacts', asyncHandler(async (req, res) => {
  const { city, membership, search } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  // The admin panel intentionally loads the whole contact list in one request and
  // filters client-side (same convention as the existing hubs/participants tables),
  // so the cap here just needs to comfortably cover realistic CRM sizes, not force
  // pagination that nothing in the frontend actually implements.
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 10000);

  const conditions = [];
  const params = [];
  if (city) {
    params.push(city);
    conditions.push(`city = $${params.length}`);
  }
  if (membership) {
    params.push(membership);
    conditions.push(`membership = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    conditions.push(`(lower(full_name) LIKE $${params.length} OR lower(email) LIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRow = await db.get(`SELECT COUNT(*)::int AS count FROM crm_contacts ${where}`, params);

  const listParams = [...params, pageSize, (page - 1) * pageSize];
  const rows = await db.all(
    `SELECT * FROM crm_contacts ${where} ORDER BY city ASC, full_name ASC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  res.json({ total: totalRow.count, page, pageSize, contacts: rows.map(contactRowToJson) });
}));

// GET /api/admin/crm/contacts/summary — stats for the Contacts tab header.
router.get('/contacts/summary', asyncHandler(async (req, res) => {
  const totalRow = await db.get('SELECT COUNT(*)::int AS count FROM crm_contacts');
  const unsubRow = await db.get("SELECT COUNT(*)::int AS count FROM crm_contacts WHERE unsubscribed_at IS NOT NULL");
  const byMembership = await db.all(
    'SELECT membership, COUNT(*)::int AS count FROM crm_contacts GROUP BY membership ORDER BY count DESC'
  );
  const topCities = await db.all(
    "SELECT city, COUNT(*)::int AS count FROM crm_contacts WHERE city IS NOT NULL AND city <> '' GROUP BY city ORDER BY count DESC LIMIT 15"
  );
  res.json({ total: totalRow.count, unsubscribed: unsubRow.count, byMembership, topCities });
}));

// GET /api/admin/crm/cities — distinct cities for the campaign builder's picker.
router.get('/cities', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT city, city_key, COUNT(*)::int AS count
     FROM crm_contacts
     WHERE city IS NOT NULL AND city <> '' AND unsubscribed_at IS NULL
     GROUP BY city, city_key
     ORDER BY count DESC, city ASC`
  );
  res.json(rows);
}));

// GET /api/admin/crm/batches — distinct QPFP batches for the campaign builder's
// optional "narrow by batch" filter.
router.get('/batches', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT batch, COUNT(*)::int AS count
     FROM crm_contacts
     WHERE batch IS NOT NULL AND batch <> '' AND unsubscribed_at IS NULL
     GROUP BY batch
     ORDER BY count DESC, batch ASC`
  );
  res.json(rows);
}));

// GET /api/admin/crm/memberships — distinct membership types for the campaign
// builder's optional "narrow by membership" filter.
router.get('/memberships', asyncHandler(async (req, res) => {
  const rows = await db.all(
    `SELECT membership, COUNT(*)::int AS count
     FROM crm_contacts
     WHERE membership IS NOT NULL AND membership <> '' AND unsubscribed_at IS NULL
     GROUP BY membership
     ORDER BY count DESC, membership ASC`
  );
  res.json(rows);
}));

// GET /api/admin/crm/hubs-for-cities?cities=Mumbai,Thane — Approved circles whose
// (normalized) city matches any of the given raw city strings, with a computed
// isFull flag. A suggestion list only — the campaign builder lets the admin
// add/remove from it before sending.
router.get('/hubs-for-cities', asyncHandler(async (req, res) => {
  const cities = String(req.query.cities || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cities.length === 0) return res.json([]);

  const wantedKeys = new Set(cities.map(normalizeCityKey));
  const hubsWithCounts = await getApprovedHubsWithCounts();
  const results = hubsWithCounts
    .filter((hub) => wantedKeys.has(normalizeCityKey(hub.city)))
    .map((hub) => ({ ...hubRowToJson(hub), participantCount: hub.participantCount, isFull: hub.isFull }));
  res.json(results);
}));

// POST /api/admin/crm/import — multipart upload, field name "file" (.xlsx or .csv).
// Upserts on lower(email); re-importing an updated sheet is safe to run again.
router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected multipart field "file").' });

  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch (e) {
    return res.status(400).json({ error: 'Could not parse file — expected a .xlsx or .csv spreadsheet.' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (rows.length === 0) {
    return res.json({ inserted: 0, updated: 0, skipped: 0, total: 0, skippedReasons: [] });
  }

  const sampleKeys = Object.keys(rows[0]);
  const resolveKey = (aliases) => sampleKeys.find((k) => aliases.includes(k.trim().toLowerCase())) || null;
  const nameKey = resolveKey(HEADER_ALIASES.name);
  const emailKey = resolveKey(HEADER_ALIASES.email);
  const mobileKey = resolveKey(HEADER_ALIASES.mobile);
  const cityKey = resolveKey(HEADER_ALIASES.city);
  const batchKey = resolveKey(HEADER_ALIASES.batch);
  const membershipKey = resolveKey(HEADER_ALIASES.membership);

  if (!nameKey || !emailKey) {
    return res.status(400).json({ error: 'Could not find a Name and Email ID column in the uploaded file.' });
  }

  const now = new Date().toISOString();
  const skippedReasons = [];
  let skipped = 0;

  // De-dupe within the file itself (last occurrence wins) so a single INSERT can't
  // hit the same ON CONFLICT target twice — Postgres rejects that in one statement.
  const byEmail = new Map();
  for (const row of rows) {
    const fullName = String(row[nameKey] || '').trim();
    const email = String(row[emailKey] || '').trim().toLowerCase();
    if (!fullName || !email || !EMAIL_RE.test(email)) {
      skipped++;
      if (skippedReasons.length < 20) skippedReasons.push(`Missing/invalid name or email: ${JSON.stringify(row).slice(0, 120)}`);
      continue;
    }
    const city = cityKey ? String(row[cityKey] || '').trim() : '';
    byEmail.set(email, {
      id: generateCrmContactId(),
      fullName,
      email,
      mobile: mobileKey ? String(row[mobileKey] || '').trim() || null : null,
      city: city || null,
      cityKey: city ? normalizeCityKey(city) : null,
      membership: membershipKey ? normalizeCrmMembership(String(row[membershipKey] || '').trim()) || null : null,
      batch: batchKey ? String(row[batchKey] || '').trim() || null : null,
      source: req.file.originalname,
    });
  }

  const contacts = Array.from(byEmail.values());
  const CHUNK_SIZE = 200;
  let inserted = 0, updated = 0;

  for (let i = 0; i < contacts.length; i += CHUNK_SIZE) {
    const chunk = contacts.slice(i, i + CHUNK_SIZE);
    const cols = ['id', 'full_name', 'email', 'mobile', 'city', 'city_key', 'membership', 'batch', 'source', 'imported_at', 'created_at', 'updated_at'];
    const values = [];
    const placeholders = chunk.map((c) => {
      const row = [c.id, c.fullName, c.email, c.mobile, c.city, c.cityKey, c.membership, c.batch, c.source, now, now, now];
      const base = values.length;
      values.push(...row);
      return `(${row.map((_, j) => `$${base + j + 1}`).join(',')})`;
    }).join(',');

    const result = await db.query(
      `INSERT INTO crm_contacts (${cols.join(',')})
       VALUES ${placeholders}
       ON CONFLICT (lower(email)) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         mobile = EXCLUDED.mobile,
         city = EXCLUDED.city,
         city_key = EXCLUDED.city_key,
         membership = EXCLUDED.membership,
         batch = EXCLUDED.batch,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at
       RETURNING (xmax = 0) AS inserted`,
      values
    );
    for (const r of result.rows) {
      if (r.inserted) inserted++; else updated++;
    }
  }

  res.json({ inserted, updated, skipped, total: rows.length, skippedReasons });
}));

// DELETE /api/admin/crm/contacts/:id
router.delete('/contacts/:id', asyncHandler(async (req, res) => {
  const existing = await db.get('SELECT id FROM crm_contacts WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Contact not found' });
  await db.run('DELETE FROM crm_contacts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ─── Campaigns ─────────────────────────────────────────────────────────────────

// GET /api/admin/crm/campaigns
router.get('/campaigns', asyncHandler(async (req, res) => {
  const rows = await db.all('SELECT * FROM crm_campaigns ORDER BY created_at DESC');
  res.json(rows.map(campaignRowToJson));
}));

// GET /api/admin/crm/campaigns/:id
router.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaignRowToJson(campaign));
}));

// POST /api/admin/crm/campaigns — create a Draft.
// Body: { name, subject, targetMode?, targetCities[], hubIds[], targetBatches[]?,
//         targetMemberships[]?, introHtml?, batchSize?, intervalMinutes? }
// targetMode 'manual' (default): every recipient in targetCities gets the same
// hubIds list. targetMode 'auto': every contact whose own city currently has at
// least one open (non-full) Approved circle is a recipient, and each one only
// ever sees THEIR city's circles — targetCities/hubIds are ignored/unused.
// targetBatches/targetMemberships are optional narrowing filters that apply on
// top of city targeting in EITHER mode (e.g. auto-personalize by city, but only
// for QPFP Batch 11/12) — omit/empty means no restriction.
router.post('/campaigns', asyncHandler(async (req, res) => {
  const { name, targetMode, targetCities, hubIds, targetBatches, targetMemberships, subject, introHtml, batchSize, intervalMinutes } = req.body || {};
  const mode = targetMode === 'auto' ? 'auto' : 'manual';
  const batches = Array.isArray(targetBatches) ? targetBatches : [];
  const memberships = Array.isArray(targetMemberships) ? targetMemberships : [];
  if (!name || !subject) {
    return res.status(400).json({ error: 'name and subject are required.' });
  }
  if (mode === 'manual' && (!Array.isArray(targetCities) || targetCities.length === 0)) {
    return res.status(400).json({ error: 'targetCities[] is required for a manual campaign.' });
  }

  const id = generateCrmCampaignId();
  const now = new Date().toISOString();

  const conditions = ['unsubscribed_at IS NULL'];
  const params = [];
  if (mode === 'auto') {
    const openMap = groupOpenHubsByCityKey(await getApprovedHubsWithCounts());
    params.push(Array.from(openMap.keys()));
    conditions.push(`city_key = ANY($${params.length}::text[])`);
  } else {
    params.push(targetCities);
    conditions.push(`city = ANY($${params.length}::text[])`);
  }
  appendOptionalFilters(conditions, params, batches, memberships);
  const totalRow = await db.get(`SELECT COUNT(*)::int AS count FROM crm_contacts WHERE ${conditions.join(' AND ')}`, params);

  await db.run(
    `INSERT INTO crm_campaigns
       (id, name, status, target_mode, target_cities, hub_ids, target_batches, target_memberships, subject, intro_html, batch_size, interval_minutes, total_recipients, created_at)
     VALUES ($1,$2,'Draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id, name, mode,
      JSON.stringify(mode === 'manual' ? targetCities : []),
      JSON.stringify(mode === 'manual' && Array.isArray(hubIds) ? hubIds : []),
      JSON.stringify(batches), JSON.stringify(memberships),
      subject, introHtml || null,
      Number.isFinite(Number(batchSize)) && Number(batchSize) > 0 ? Number(batchSize) : 25,
      Number.isFinite(Number(intervalMinutes)) && Number(intervalMinutes) > 0 ? Number(intervalMinutes) : 15,
      totalRow.count, now,
    ]
  );

  const created = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [id]);
  res.json(campaignRowToJson(created));
}));

// GET /api/admin/crm/campaigns/:id/preview?sampleCity=Mumbai — renders the exact
// email HTML for one real matching contact (or a synthetic sample), without
// sending or touching recipient rows. In auto mode, the featured circles are
// THAT sample contact's own city — pass ?sampleCity= to spot-check a specific
// city rather than whichever contact happens to sort first.
router.get('/campaigns/:id/preview', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const mode = campaign.target_mode || 'manual';
  const requestedCity = (req.query.sampleCity || '').trim();

  let sampleContact;
  let hubs;

  const targetBatches = campaign.target_batches || [];
  const targetMemberships = campaign.target_memberships || [];

  if (mode === 'auto') {
    const openMap = groupOpenHubsByCityKey(await getApprovedHubsWithCounts());
    const openCityKeys = Array.from(openMap.keys());
    const conditions = ['unsubscribed_at IS NULL'];
    const params = [];
    if (requestedCity) {
      params.push(normalizeCityKey(requestedCity));
      conditions.push(`city_key = $${params.length}`);
    }
    params.push(openCityKeys);
    conditions.push(`city_key = ANY($${params.length}::text[])`);
    appendOptionalFilters(conditions, params, targetBatches, targetMemberships);
    sampleContact = await db.get(
      `SELECT * FROM crm_contacts WHERE ${conditions.join(' AND ')} ORDER BY full_name ASC LIMIT 1`,
      params
    );
    if (!sampleContact) {
      sampleContact = { id: 'SAMPLE', full_name: 'Sample Member', email: 'sample@example.com', city: requestedCity || '(no matching contact yet)' };
      hubs = [];
    } else {
      hubs = openMap.get(sampleContact.city_key) || [];
    }
  } else {
    const targetCities = campaign.target_cities || [];
    const hubIds = campaign.hub_ids || [];
    hubs = hubIds.length ? await db.all('SELECT * FROM hubs WHERE id = ANY($1::text[])', [hubIds]) : [];
    if (targetCities.length) {
      const conditions = ['unsubscribed_at IS NULL'];
      const params = [targetCities];
      conditions.push(`city = ANY($${params.length}::text[])`);
      appendOptionalFilters(conditions, params, targetBatches, targetMemberships);
      sampleContact = await db.get(
        `SELECT * FROM crm_contacts WHERE ${conditions.join(' AND ')} ORDER BY full_name ASC LIMIT 1`,
        params
      );
    } else {
      sampleContact = null;
    }
    if (!sampleContact) {
      sampleContact = { id: 'SAMPLE', full_name: 'Sample Member', email: 'sample@example.com', city: targetCities[0] || '' };
    }
  }

  const renderedSubject = renderCrmSubject(campaign.subject, sampleContact.city);

  const html = buildCircleCrmEmailHtml(
    { id: sampleContact.id, full_name: sampleContact.full_name, email: sampleContact.email, city: sampleContact.city },
    hubs,
    { subject: renderedSubject, introHtml: campaign.intro_html, targetCities: mode === 'auto' ? [] : (campaign.target_cities || []) }
  );

  res.json({
    html,
    subject: renderedSubject,
    sampleContactEmail: sampleContact.email,
    sampleContactCity: sampleContact.city,
    hubCount: hubs.length,
    totalRecipients: campaign.total_recipients,
    targetMode: mode,
  });
}));

// POST /api/admin/crm/campaigns/:id/start — snapshots matching contacts into
// crm_campaign_recipients and flips the campaign to Sending. Safe to call again
// later (e.g. after editing target cities) — ON CONFLICT DO NOTHING means it only
// ever adds newly-matching contacts, never duplicates or resets existing ones.
router.post('/campaigns/:id/start', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'Sending') return res.status(400).json({ error: 'Campaign is already sending.' });
  if (campaign.status === 'Completed' || campaign.status === 'Cancelled') {
    return res.status(400).json({ error: `Campaign is ${campaign.status.toLowerCase()} and cannot be started.` });
  }

  const mode = campaign.target_mode || 'manual';
  const targetBatches = campaign.target_batches || [];
  const targetMemberships = campaign.target_memberships || [];
  const conditions = ['unsubscribed_at IS NULL'];
  const params = [];
  if (mode === 'auto') {
    // Recomputed fresh at start time (not from campaign creation) in case hub
    // approvals/fills changed in between — a circle that filled up since the
    // campaign was drafted should not pull in contacts from its city.
    const openMap = groupOpenHubsByCityKey(await getApprovedHubsWithCounts());
    params.push(Array.from(openMap.keys()));
    conditions.push(`city_key = ANY($${params.length}::text[])`);
  } else {
    params.push(campaign.target_cities || []);
    conditions.push(`city = ANY($${params.length}::text[])`);
  }
  appendOptionalFilters(conditions, params, targetBatches, targetMemberships);
  await db.run(
    `INSERT INTO crm_campaign_recipients (campaign_id, contact_id)
     SELECT $${params.length + 1}, id FROM crm_contacts WHERE ${conditions.join(' AND ')}
     ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
    [...params, campaign.id]
  );

  const totalRow = await db.get(
    'SELECT COUNT(*)::int AS count FROM crm_campaign_recipients WHERE campaign_id = $1',
    [campaign.id]
  );
  const now = new Date().toISOString();
  await db.run(
    `UPDATE crm_campaigns SET status = 'Sending', started_at = COALESCE(started_at, $1), total_recipients = $2 WHERE id = $3`,
    [now, totalRow.count, campaign.id]
  );

  const updated = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaign.id]);
  scheduleCampaignTimer(campaign.id, updated.interval_minutes);
  runCampaignBatch(campaign.id).catch((e) => console.error(`[crm] initial batch error for ${campaign.id}:`, e.message));
  res.json(campaignRowToJson(updated));
}));

// POST /api/admin/crm/campaigns/:id/pause
router.post('/campaigns/:id/pause', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'Sending') return res.status(400).json({ error: 'Only a sending campaign can be paused.' });
  unscheduleCampaignTimer(campaign.id);
  await db.run(`UPDATE crm_campaigns SET status = 'Paused' WHERE id = $1`, [campaign.id]);
  res.json(campaignRowToJson(await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaign.id])));
}));

// POST /api/admin/crm/campaigns/:id/resume
router.post('/campaigns/:id/resume', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'Paused') return res.status(400).json({ error: 'Only a paused campaign can be resumed.' });
  await db.run(`UPDATE crm_campaigns SET status = 'Sending' WHERE id = $1`, [campaign.id]);
  scheduleCampaignTimer(campaign.id, campaign.interval_minutes);
  runCampaignBatch(campaign.id).catch((e) => console.error(`[crm] resume batch error for ${campaign.id}:`, e.message));
  res.json(campaignRowToJson(await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaign.id])));
}));

// POST /api/admin/crm/campaigns/:id/retry-failed — resets every Failed recipient
// on this campaign back to Pending (clearing their stored error) so the next
// batch tries them again — useful after a transient issue (e.g. the SMTP
// timeouts/rate-limit failures earlier) rather than writing those contacts off.
// Works regardless of the campaign's current status: reopens it if it had
// already gone Completed/Paused, or just tops up the queue if it's still
// actively Sending.
router.post('/campaigns/:id/retry-failed', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const result = await db.run(
    `UPDATE crm_campaign_recipients SET status = 'Pending', error = NULL WHERE campaign_id = $1 AND status = 'Failed'`,
    [campaign.id]
  );
  const retriedCount = result.rowCount;

  if (retriedCount > 0) {
    await db.run(
      `UPDATE crm_campaigns SET status = 'Sending', completed_at = NULL, failed_count = GREATEST(failed_count - $1, 0) WHERE id = $2`,
      [retriedCount, campaign.id]
    );
    scheduleCampaignTimer(campaign.id, campaign.interval_minutes);
    runCampaignBatch(campaign.id).catch((e) => console.error(`[crm] retry-failed batch error for ${campaign.id}:`, e.message));
  }

  const updated = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaign.id]);
  res.json({ retriedCount, campaign: campaignRowToJson(updated) });
}));

// POST /api/admin/crm/campaigns/:id/process-batch — manual "Send Batch Now".
// Automatic pacing is handled server-side (see scheduleCampaignTimer above); this
// route is for an admin who wants a batch to go out immediately rather than wait
// for the next interval tick. Safe to call even while the automatic timer is
// also running — runCampaignBatch's atomic claim means they can never grab the
// same recipient twice.
router.post('/campaigns/:id/process-batch', asyncHandler(async (req, res) => {
  const result = await runCampaignBatch(req.params.id);
  if (result.status === 'NotFound') return res.status(404).json({ error: 'Campaign not found' });
  res.json(result);
}));

// DELETE /api/admin/crm/campaigns/:id — blocked while actively sending.
router.delete('/campaigns/:id', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'Sending') {
    return res.status(409).json({ error: 'Pause the campaign before deleting it.' });
  }
  unscheduleCampaignTimer(campaign.id);
  await db.run('DELETE FROM crm_campaigns WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
