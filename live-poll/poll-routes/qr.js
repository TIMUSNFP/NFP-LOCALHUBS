// poll-routes/qr.js — server-rendered join QR code (no third-party service,
// no client-side library to vendor — self-contained even if the venue's wifi
// to the outside internet is flaky, since it's generated on our own server).
const express = require('express');
const QRCode = require('qrcode');

const router = express.Router();

// GET /api/qr/:code — SVG QR code that opens the join page pre-filled with code.
router.get('/:code', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  if (code.length < 4) return res.status(400).json({ error: 'Invalid code.' });

  const joinUrl = `${req.protocol}://${req.get('host')}/index.html?code=${code}`;
  try {
    const svg = await QRCode.toString(joinUrl, {
      type: 'svg',
      margin: 1,
      color: { dark: '#1C1C1C', light: '#FFFFFF' },
    });
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  } catch (e) {
    console.error('[qr]', e);
    res.status(500).json({ error: 'Could not generate QR code.' });
  }
});

module.exports = router;
