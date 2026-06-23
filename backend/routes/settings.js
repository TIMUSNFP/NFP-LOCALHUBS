// routes/settings.js — public read of platform settings (which forms are open).
const express = require('express');
const db = require('../db');

const router = express.Router();

// Reads the settings table into a { hubFormOpen, participantFormOpen } shape.
// Anything other than the literal 'false' is treated as open (fail-open).
async function readFormSettings() {
  const rows = await db.all('SELECT key, value FROM settings');
  const map = {};
  rows.forEach((r) => {
    map[r.key] = r.value;
  });
  return {
    hubFormOpen: map.hub_form_open !== 'false',
    participantFormOpen: map.participant_form_open !== 'false',
  };
}

// GET /api/settings — public. Used by the participant + hub-leader pages.
router.get('/', async (req, res) => {
  res.json(await readFormSettings());
});

module.exports = router;
module.exports.readFormSettings = readFormSettings;
