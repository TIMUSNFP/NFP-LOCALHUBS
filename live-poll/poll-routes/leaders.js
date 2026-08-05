// poll-routes/leaders.js — Approved Circle Leaders list, for the "I'm a Circle
// Leader" join dropdown. Proxies the main NFP Circles API's existing public
// GET /api/hubs?status=Approved endpoint rather than maintaining a second
// leader list — see backend/routes/hubs.js in the main repo.
const express = require('express');

const router = express.Router();

const MAIN_API_BASE = (process.env.MAIN_API_BASE || 'https://nfp-circles.vercel.app').replace(/\/$/, '');

// GET /api/leaders — { id, fullName, city, area }[], sorted by name.
router.get('/', async (req, res) => {
  try {
    const upstream = await fetch(`${MAIN_API_BASE}/api/hubs?status=Approved`);
    if (!upstream.ok) {
      return res.status(502).json({ error: 'Could not load Circle Leaders list.' });
    }
    const hubs = await upstream.json();
    const leaders = (Array.isArray(hubs) ? hubs : [])
      .map((h) => ({ id: h.id, fullName: h.fullName, city: h.city, area: h.area }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    // Cache at the CDN for a bit — this list barely changes during a live
    // event and every joining phone hits this endpoint once.
    res.set('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.json(leaders);
  } catch (e) {
    console.error('[leaders]', e);
    res.status(502).json({ error: 'Could not load Circle Leaders list.' });
  }
});

module.exports = router;
