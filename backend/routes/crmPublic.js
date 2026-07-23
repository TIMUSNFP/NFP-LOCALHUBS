// routes/crmPublic.js — public (no admin auth) endpoints for NFP Circle CRM
// contacts, currently just one-click unsubscribe from campaign emails.
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

// Same rationale as backend/routes/crm.js — Express 4 won't catch a rejected
// promise from an async handler on its own, and this route is public (no admin
// auth) so it must never take the whole server down.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function unsubscribePage(message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NFP Circles</title>
  <style>
    body { margin: 0; padding: 0; background: #EFE7DC; font-family: Arial, sans-serif; color: #333333; }
    .box { max-width: 480px; margin: 80px auto; background: #FFFFFF; border-radius: 10px; padding: 32px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h2 { margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="box">
    <h2>NFP Circles</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// GET /api/crm/unsubscribe?cid=...&token=... — token is jwt.sign({ cid }, JWT_SECRET),
// generated in mailer.js's crmUnsubscribeUrl(). Public by design (it's a footer link
// in an email an unauthenticated recipient clicks), but the signature stops anyone
// from unsubscribing a contact they don't have the emailed link for.
router.get('/unsubscribe', asyncHandler(async (req, res) => {
  const { cid, token } = req.query;
  if (!cid || !token) {
    return res.status(400).send(unsubscribePage('This unsubscribe link is missing required information.'));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return res.status(400).send(unsubscribePage('This unsubscribe link is invalid or has expired.'));
  }
  if (payload.cid !== cid) {
    return res.status(400).send(unsubscribePage('This unsubscribe link is invalid.'));
  }

  const contact = await db.get('SELECT id FROM crm_contacts WHERE id = $1', [cid]);
  if (!contact) {
    return res.status(404).send(unsubscribePage('We could not find this contact.'));
  }

  await db.run('UPDATE crm_contacts SET unsubscribed_at = $1 WHERE id = $2', [new Date().toISOString(), cid]);
  res.send(unsubscribePage("You've been unsubscribed and won't receive further NFP Circle emails."));
}));

module.exports = router;
