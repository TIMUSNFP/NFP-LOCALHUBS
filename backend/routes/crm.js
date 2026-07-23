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
    targetCities: row.target_cities || [],
    hubIds: row.hub_ids || [],
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

// GET /api/admin/crm/hubs-for-cities?cities=Mumbai,Thane — Approved circles whose
// (normalized) city matches any of the given raw city strings, with a computed
// isFull flag. A suggestion list only — the campaign builder lets the admin
// add/remove from it before sending.
router.get('/hubs-for-cities', asyncHandler(async (req, res) => {
  const cities = String(req.query.cities || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cities.length === 0) return res.json([]);

  const wantedKeys = new Set(cities.map(normalizeCityKey));
  const hubs = await db.all("SELECT * FROM hubs WHERE status = 'Approved' ORDER BY city ASC, area ASC");

  const results = [];
  for (const hub of hubs) {
    if (!wantedKeys.has(normalizeCityKey(hub.city))) continue;
    const countRow = await db.get('SELECT COUNT(*)::int AS cnt FROM participants WHERE hub_id = $1', [hub.id]);
    const capacityLimit = parseInt(hub.capacity, 10);
    const isFull = !isNaN(capacityLimit) && capacityLimit > 0 && countRow.cnt >= capacityLimit;
    results.push({ ...hubRowToJson(hub), participantCount: countRow.cnt, isFull });
  }
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
      membership: membershipKey ? String(row[membershipKey] || '').trim() || null : null,
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
// Body: { name, targetCities[], hubIds[], subject, introHtml?, batchSize?, intervalMinutes? }
router.post('/campaigns', asyncHandler(async (req, res) => {
  const { name, targetCities, hubIds, subject, introHtml, batchSize, intervalMinutes } = req.body || {};
  if (!name || !subject || !Array.isArray(targetCities) || targetCities.length === 0) {
    return res.status(400).json({ error: 'name, subject, and targetCities[] are required.' });
  }

  const id = generateCrmCampaignId();
  const now = new Date().toISOString();
  const totalRow = await db.get(
    `SELECT COUNT(*)::int AS count FROM crm_contacts WHERE city = ANY($1::text[]) AND unsubscribed_at IS NULL`,
    [targetCities]
  );

  await db.run(
    `INSERT INTO crm_campaigns
       (id, name, status, target_cities, hub_ids, subject, intro_html, batch_size, interval_minutes, total_recipients, created_at)
     VALUES ($1,$2,'Draft',$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id, name, JSON.stringify(targetCities), JSON.stringify(Array.isArray(hubIds) ? hubIds : []),
      subject, introHtml || null,
      Number.isFinite(Number(batchSize)) && Number(batchSize) > 0 ? Number(batchSize) : 25,
      Number.isFinite(Number(intervalMinutes)) && Number(intervalMinutes) > 0 ? Number(intervalMinutes) : 15,
      totalRow.count, now,
    ]
  );

  const created = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [id]);
  res.json(campaignRowToJson(created));
}));

// GET /api/admin/crm/campaigns/:id/preview — renders the exact email HTML for one
// real matching contact (or a synthetic sample), without sending or touching
// recipient rows.
router.get('/campaigns/:id/preview', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const targetCities = campaign.target_cities || [];
  const hubIds = campaign.hub_ids || [];
  const hubs = hubIds.length ? await db.all('SELECT * FROM hubs WHERE id = ANY($1::text[])', [hubIds]) : [];

  let sampleContact = targetCities.length
    ? await db.get(
        `SELECT * FROM crm_contacts WHERE city = ANY($1::text[]) AND unsubscribed_at IS NULL ORDER BY full_name ASC LIMIT 1`,
        [targetCities]
      )
    : null;
  if (!sampleContact) {
    sampleContact = { id: 'SAMPLE', full_name: 'Sample Member', email: 'sample@example.com', city: targetCities[0] || '' };
  }

  const html = buildCircleCrmEmailHtml(
    { id: sampleContact.id, full_name: sampleContact.full_name, email: sampleContact.email, city: sampleContact.city },
    hubs,
    { subject: campaign.subject, introHtml: campaign.intro_html, targetCities }
  );

  res.json({ html, sampleContactEmail: sampleContact.email, hubCount: hubs.length, totalRecipients: campaign.total_recipients });
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

  const targetCities = campaign.target_cities || [];
  await db.run(
    `INSERT INTO crm_campaign_recipients (campaign_id, contact_id)
     SELECT $1, id FROM crm_contacts WHERE city = ANY($2::text[]) AND unsubscribed_at IS NULL
     ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
    [campaign.id, targetCities]
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
  res.json(campaignRowToJson(updated));
}));

// POST /api/admin/crm/campaigns/:id/pause
router.post('/campaigns/:id/pause', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'Sending') return res.status(400).json({ error: 'Only a sending campaign can be paused.' });
  await db.run(`UPDATE crm_campaigns SET status = 'Paused' WHERE id = $1`, [campaign.id]);
  res.json(campaignRowToJson(await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaign.id])));
}));

// POST /api/admin/crm/campaigns/:id/resume
router.post('/campaigns/:id/resume', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'Paused') return res.status(400).json({ error: 'Only a paused campaign can be resumed.' });
  await db.run(`UPDATE crm_campaigns SET status = 'Sending' WHERE id = $1`, [campaign.id]);
  res.json(campaignRowToJson(await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [campaign.id])));
}));

// POST /api/admin/crm/campaigns/:id/process-batch — sends the next batch_size
// Pending recipients, staggered ~400ms apart. Idempotent: only advances
// Pending -> Sent/Failed/Skipped rows, so calling it repeatedly (the admin panel's
// interval timer) never double-sends. Marks the campaign Completed once nothing
// Pending remains.
router.post('/campaigns/:id/process-batch', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'Sending') {
    return res.json({ sentThisBatch: 0, failedThisBatch: 0, remaining: 0, status: campaign.status });
  }

  const pending = await db.all(
    `SELECT r.id AS recipient_id, c.id, c.full_name, c.email, c.city, c.unsubscribed_at
     FROM crm_campaign_recipients r
     JOIN crm_contacts c ON c.id = r.contact_id
     WHERE r.campaign_id = $1 AND r.status = 'Pending'
     ORDER BY r.id ASC
     LIMIT $2`,
    [campaign.id, campaign.batch_size]
  );

  const hubIds = campaign.hub_ids || [];
  const hubs = hubIds.length ? await db.all('SELECT * FROM hubs WHERE id = ANY($1::text[])', [hubIds]) : [];
  const targetCities = campaign.target_cities || [];

  let sentThisBatch = 0;
  let failedThisBatch = 0;

  for (const contact of pending) {
    if (contact.unsubscribed_at) {
      await db.run(`UPDATE crm_campaign_recipients SET status = 'Skipped' WHERE id = $1`, [contact.recipient_id]);
      continue;
    }
    try {
      await sendCrmCampaignEmail(
        { id: contact.id, full_name: contact.full_name, email: contact.email, city: contact.city },
        hubs,
        { subject: campaign.subject, introHtml: campaign.intro_html, targetCities }
      );
      await db.run(
        `UPDATE crm_campaign_recipients SET status = 'Sent', sent_at = $1 WHERE id = $2`,
        [new Date().toISOString(), contact.recipient_id]
      );
      sentThisBatch++;
    } catch (err) {
      await db.run(
        `UPDATE crm_campaign_recipients SET status = 'Failed', error = $1 WHERE id = $2`,
        [String((err && err.message) || err).slice(0, 500), contact.recipient_id]
      );
      failedThisBatch++;
    }
    await sleep(400);
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE crm_campaigns SET sent_count = sent_count + $1, failed_count = failed_count + $2, last_batch_at = $3 WHERE id = $4`,
    [sentThisBatch, failedThisBatch, now, campaign.id]
  );

  const remainingRow = await db.get(
    `SELECT COUNT(*)::int AS count FROM crm_campaign_recipients WHERE campaign_id = $1 AND status = 'Pending'`,
    [campaign.id]
  );
  let status = campaign.status;
  if (remainingRow.count === 0) {
    status = 'Completed';
    await db.run(`UPDATE crm_campaigns SET status = 'Completed', completed_at = $1 WHERE id = $2`, [now, campaign.id]);
  }

  res.json({ sentThisBatch, failedThisBatch, remaining: remainingRow.count, status });
}));

// DELETE /api/admin/crm/campaigns/:id — blocked while actively sending.
router.delete('/campaigns/:id', asyncHandler(async (req, res) => {
  const campaign = await db.get('SELECT * FROM crm_campaigns WHERE id = $1', [req.params.id]);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status === 'Sending') {
    return res.status(409).json({ error: 'Pause the campaign before deleting it.' });
  }
  await db.run('DELETE FROM crm_campaigns WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
