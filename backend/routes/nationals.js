// routes/nationals.js — NFP Nationals sign-up (/nationals). One short form for everyone in the hall:
// people with a space become leader leads, the rest become participants. Responses are stored
// per edition and never touch hubs/participants until an RM acts on them.
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// shortcut: hardcoded edition, change this number each January for the next Nationals.
const NATIONALS_EDITION = 3;

const last10 = (v) => String(v || '').replace(/[^0-9]/g, '').slice(-10);
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const YES_NO = ['yes', 'no'];
const INTENTS = ['yes', 'if_demand', 'maybe', 'no'];

function roleFor(hasOffice, intent) {
  if (hasOffice) return intent === 'yes' ? 'Leader' : intent === 'if_demand' ? 'Leader if demand' : 'Participant';
  return intent === 'yes' || intent === 'maybe' ? 'Participant, may host' : 'Participant';
}

// POST /api/nationals — public. Safe to submit twice: the same mobile updates its row.
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot: bots fill hidden fields

    const mobile = last10(b.mobile);
    const email = clean(b.email, 200);
    const fullName = clean(b.fullName, 120);
    const city = clean(b.city, 80);
    const pincode = clean(b.pincode, 6);
    const preferredArea = clean(b.preferredArea, 120);
    const ledBefore = clean(b.ledBefore, 3);
    const hasOffice = clean(b.hasOffice, 3);
    const intent = clean(b.hostIntent, 12);
    const sameVenue = hasOffice === 'yes' && ledBefore === 'yes' ? clean(b.sameVenue, 3) : '';

    if (!fullName) return res.status(400).json({ error: 'Please enter your name.' });
    if (mobile.length !== 10) return res.status(400).json({ error: 'Please enter a 10 digit mobile number.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!city) return res.status(400).json({ error: 'Please enter your city.' });
    // Pincode is optional: most people remember a place, not a pincode. Space owners still give one (the venue address needs it).
    if (pincode && !/^[0-9]{6}$/.test(pincode)) return res.status(400).json({ error: 'Pincode must be 6 digits, or leave it empty.' });
    if (!YES_NO.includes(ledBefore)) return res.status(400).json({ error: 'Please tell us if you led a Circle before.' });
    if (!YES_NO.includes(hasOffice)) return res.status(400).json({ error: 'Please tell us if you have a space.' });
    if (!INTENTS.includes(intent)) return res.status(400).json({ error: 'Please answer the hosting question.' });

    if (hasOffice === 'yes' && !pincode) return res.status(400).json({ error: 'Please enter the pincode of your venue.' });

    // Link a returning leader to their latest earlier circle so the RM can carry it over.
    const prev = ledBefore === 'yes'
      ? await db.get(
          `SELECT id FROM hubs WHERE status IN ('Approved','Merged') AND edition < $3
             AND (lower(email) = lower($1) OR right(regexp_replace(coalesce(mobile,''), '[^0-9]', '', 'g'), 10) = $2)
           ORDER BY edition DESC LIMIT 1`,
          [email, mobile, NATIONALS_EDITION]
        )
      : null;

    // Address, venue type and capacity are needed from a space owner, unless a returning leader keeps the same venue
    // AND we found their earlier circle (a leader who used a different email or mobile has to give the address again).
    const needsVenue = hasOffice === 'yes' && !(sameVenue === 'yes' && prev);
    const address = needsVenue ? clean(b.address, 400) : '';
    const venueType = needsVenue ? clean(b.venueType, 40) : '';
    const capacity = needsVenue ? parseInt(b.capacity, 10) : null;
    if (needsVenue && (!address || !venueType || !(capacity >= 1 && capacity <= 500))) {
      return res.status(400).json({ error: 'Please add the address, venue type and how many people it seats.', needVenue: true });
    }

    await db.run(
      `INSERT INTO nationals_responses
         (edition, full_name, mobile, email, city, pincode, led_before, previous_hub_id, has_office, same_venue,
          address, venue_type, capacity, host_intent, role, preferred_area)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (edition, mobile) DO UPDATE SET
         full_name = EXCLUDED.full_name, email = EXCLUDED.email, city = EXCLUDED.city, pincode = EXCLUDED.pincode,
         led_before = EXCLUDED.led_before, previous_hub_id = EXCLUDED.previous_hub_id, has_office = EXCLUDED.has_office,
         same_venue = EXCLUDED.same_venue, address = EXCLUDED.address, venue_type = EXCLUDED.venue_type,
         capacity = EXCLUDED.capacity, host_intent = EXCLUDED.host_intent, role = EXCLUDED.role, preferred_area = EXCLUDED.preferred_area,
         updated_at = now(), submissions = nationals_responses.submissions + 1`,
      [NATIONALS_EDITION, fullName, mobile, email, city, pincode, ledBefore, prev ? prev.id : null, hasOffice === 'yes',
       sameVenue || null, address || null, venueType || null, capacity, intent, roleFor(hasOffice === 'yes', intent), preferredArea || null]
    );
    res.status(201).json({ ok: true, role: roleFor(hasOffice === 'yes', intent) });
  } catch (e) {
    console.error('[nationals] POST failed:', e.message);
    res.status(500).json({ error: 'Could not save your response. Please try again.' });
  }
});

// GET /api/nationals?edition=3 — admin only: every response plus counts by role.
router.get('/', requireAdmin, async (req, res) => {
  const edition = parseInt(req.query.edition, 10) || NATIONALS_EDITION;
  const rows = await db.all('SELECT * FROM nationals_responses WHERE edition = $1 ORDER BY submitted_at DESC', [edition]);
  const counts = rows.reduce((m, r) => ((m[r.role] = (m[r.role] || 0) + 1), m), {});
  res.json({ edition, total: rows.length, counts, rows });
});

module.exports = router;
