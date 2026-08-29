// routes/settings.js — public read of platform settings (which forms are open).
const express = require('express');
const db = require('../db');

const router = express.Router();

// Reads the settings table into a { hubFormOpen, participantFormOpen, activeEdition }
// shape. Anything other than the literal 'false' is treated as open (fail-open).
// activeEdition defaults to 1 if never set (matches the DB column's own DEFAULT 1).
async function readFormSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const map = {};
  rows.forEach((r) => {
    map[r.key] = r.value;
  });
  return {
    hubFormOpen: map.hub_form_open !== 'false',
    participantFormOpen: map.participant_form_open !== 'false',
    activeEdition: parseInt(map.active_edition || '1', 10),
  };
}

// GET /api/settings — public. Used by the participant + hub-leader pages.
// Includes the active edition's event date (not just its number) so those
// static pages can render date-dependent copy (e.g. the hosting-frequency
// option "Only host on <date>") without needing an authenticated endpoint.
router.get('/', async (req, res) => {
  const settings = await readFormSettings();
  const edition = await db.get(
    'SELECT event_date FROM editions WHERE edition = $1',
    [settings.activeEdition]
  );
  res.json({ ...settings, activeEditionEventDate: edition ? edition.event_date : null });
});

module.exports = router;
module.exports.readFormSettings = readFormSettings;
