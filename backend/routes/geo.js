// routes/geo.js — pincode -> nearby approved hubs.
const express = require('express');
const db = require('../db');
const { hubRowToJson, haversineKm, geocodeQuery } = require('../utils');

const router = express.Router();

// GET /api/geo/nearby-hubs?pincode=XXXXXX
router.get('/nearby-hubs', async (req, res) => {
  const { pincode } = req.query;

  if (!pincode || !/^\d{6}$/.test(String(pincode))) {
    return res.status(400).json({ error: 'A valid 6-digit pincode is required.' });
  }

  const cached = await db.get('SELECT * FROM pincode_cache WHERE pincode = $1', [pincode]);
  let lat, lng;

  if (cached) {
    lat = cached.lat;
    lng = cached.lng;
  } else {
    const coords = await geocodeQuery(`${pincode}, India`);
    if (!coords) {
      return res.status(404).json({ error: 'Could not locate that PIN code.' });
    }
    [lat, lng] = coords;
    // ON CONFLICT guards against two simultaneous requests caching the same pincode.
    await db.run(
      `INSERT INTO pincode_cache (pincode, lat, lng, cached_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (pincode) DO NOTHING`,
      [pincode, lat, lng, new Date().toISOString()]
    );
  }

  const approvedHubs = await db.all(
    'SELECT * FROM hubs WHERE status = $1 AND lat IS NOT NULL AND lng IS NOT NULL',
    ['Approved']
  );

  const results = approvedHubs
    .map((row) => {
      const hub = hubRowToJson(row);
      const distanceKm = Math.round(haversineKm(lat, lng, row.lat, row.lng) * 10) / 10;
      return { ...hub, distanceKm };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);

  res.json(results);
});

module.exports = router;
