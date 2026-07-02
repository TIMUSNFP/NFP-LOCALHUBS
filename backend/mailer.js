// mailer.js — Resend-based email utility for NFP Circles.
// All outbound emails are sent from the address set in FROM_EMAIL env var.
// If RESEND_API_KEY is missing, every send is a no-op (safe for local dev).
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.FROM_EMAIL || 'NFP Circles <noreply@networkfp.com>';

const HUB_LEADER_URL = 'https://nfp-circles.vercel.app/circle-leaders/';
const PARTICIPANT_URL = 'https://nfp-circles.vercel.app/participant/';

async function send({ to, subject, html }) {
  if (!resend) {
    console.log(`[mailer] RESEND_API_KEY not set — skipping email to ${to}: "${subject}"`);
    return;
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    // Never let an email failure break the API response.
    console.error(`[mailer] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function wrap(body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #f5f5f5; font-family: Arial, sans-serif; color: #1a1a1a; }
    .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #1a3a5c; padding: 28px 32px; text-align: center; }
    .header-title { color: #ffffff; font-size: 22px; font-weight: 700; margin: 0; letter-spacing: 0.5px; }
    .header-sub { color: #a8c4e0; font-size: 13px; margin: 6px 0 0; }
    .body { padding: 32px; }
    .body h2 { margin: 0 0 16px; font-size: 22px; color: #1a3a5c; }
    .body p { margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #444; }
    .badge { display: inline-block; background: #e8f4ea; color: #2e7d32; border-radius: 20px; padding: 6px 16px; font-size: 13px; font-weight: 700; margin-bottom: 20px; }
    .badge.rejected { background: #fdecea; color: #c62828; }
    .info-box { background: #f0f4ff; border-left: 4px solid #1a3a5c; border-radius: 4px; padding: 16px 20px; margin: 20px 0; }
    .info-box p { margin: 4px 0; font-size: 14px; color: #333; }
    .info-box strong { color: #1a3a5c; }
    .id-box { background: #1a3a5c; color: #fff; border-radius: 6px; padding: 14px 20px; text-align: center; margin: 20px 0; }
    .id-box span { display: block; font-size: 12px; opacity: 0.7; margin-bottom: 4px; }
    .id-box strong { font-size: 18px; letter-spacing: 1px; }
    .btn-wrap { text-align: center; margin: 24px 0 8px; }
    .btn { display: inline-block; background: #1a3a5c; color: #ffffff !important; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
    .footer { background: #f0f0f0; padding: 18px 32px; text-align: center; font-size: 12px; color: #888; }
    .footer a { color: #1a3a5c; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-title">NFP Circles</div>
      <div class="header-sub">Network FP</div>
    </div>
    <div class="body">${body}</div>
    <div class="footer">
      Network FP &nbsp;|&nbsp; <a href="https://www.networkfp.com">www.networkfp.com</a><br/>
      This is an automated message — please do not reply to this email.
    </div>
  </div>
</body>
</html>`;
}

// ─── Hub Approved ─────────────────────────────────────────────────────────────

async function sendHubApproved(hub) {
  const html = wrap(`
    <div class="badge">✓ Application Approved</div>
    <h2>Welcome to NFP Circles, ${hub.full_name}!</h2>
    <p>We're excited to let you know that your application to host an NFP Circle has been <strong>approved</strong>. You are now an official NFP Circle Leader.</p>
    <div class="id-box">
      <span>Your Hub ID</span>
      <strong>${hub.id}</strong>
    </div>
    <div class="info-box">
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
      <p><strong>Venue Type:</strong> ${hub.venue_type || '—'}</p>
      <p><strong>Capacity:</strong> ${hub.capacity || '—'}</p>
    </div>
    <p>Your circle is now live and visible to participants who can register with you. Please keep your Hub ID safe — you may need it for future correspondence with our team.</p>
    <div class="btn-wrap">
      <a class="btn" href="${HUB_LEADER_URL}">Visit Circle Leaders Portal</a>
    </div>
    <p>If you have any questions, please reach out to us at <a href="mailto:support@networkfp.com">support@networkfp.com</a>.</p>
    <p>Thank you for being a part of the NFP community!</p>
  `);

  await send({
    to: hub.email,
    subject: `Your NFP Circle has been approved — Welcome, ${hub.full_name}!`,
    html,
  });
}

// ─── Hub Rejected ─────────────────────────────────────────────────────────────

async function sendHubRejected(hub) {
  const html = wrap(`
    <div class="badge rejected">Application Update</div>
    <h2>Hello, ${hub.full_name}</h2>
    <p>Thank you for your interest in hosting an NFP Circle. After reviewing your application, we regret to inform you that we are unable to approve it at this time.</p>
    <div class="info-box">
      <p><strong>Application ID:</strong> ${hub.id}</p>
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
    </div>
    <p>This decision may be due to capacity limits in your area or other operational reasons. We encourage you to reapply in the future as new slots open up.</p>
    <div class="btn-wrap">
      <a class="btn" href="${HUB_LEADER_URL}">Reapply as Circle Leader</a>
    </div>
    <p>If you have questions or would like more details, please contact us at <a href="mailto:support@networkfp.com">support@networkfp.com</a>.</p>
    <p>We appreciate your enthusiasm for the NFP Circles programme and hope to welcome you in the future.</p>
  `);

  await send({
    to: hub.email,
    subject: `Update on your NFP Circles application — ${hub.full_name}`,
    html,
  });
}

// ─── Participant Confirmed ────────────────────────────────────────────────────

async function sendParticipantConfirmed(participant, hub) {
  const html = wrap(`
    <div class="badge">✓ Registration Confirmed</div>
    <h2>You're in, ${participant.full_name}!</h2>
    <p>Your registration for the NFP Circle has been confirmed. We look forward to seeing you at your local circle.</p>
    <div class="id-box">
      <span>Your Participant ID</span>
      <strong>${participant.id}</strong>
    </div>
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${hub.full_name}</p>
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
      <p><strong>Venue Type:</strong> ${hub.venue_type || '—'}</p>
    </div>
    <p>Your Circle Leader will be in touch with further details about meeting schedules and venue. Please save your Participant ID for your records.</p>
    <div class="btn-wrap">
      <a class="btn" href="${PARTICIPANT_URL}">Find More Circles Near You</a>
    </div>
    <p>For any queries, write to us at <a href="mailto:support@networkfp.com">support@networkfp.com</a>.</p>
    <p>Welcome to the NFP Circles community!</p>
  `);

  await send({
    to: participant.email,
    subject: `Registration confirmed — Welcome to NFP Circles, ${participant.full_name}!`,
    html,
  });
}

// ─── Participant Cancelled ────────────────────────────────────────────────────

async function sendParticipantCancelled(participant, hub) {
  const html = wrap(`
    <div class="badge rejected">Registration Update</div>
    <h2>Hello, ${participant.full_name}</h2>
    <p>We're writing to let you know that your registration for the NFP Circle listed below has been <strong>cancelled</strong>.</p>
    <div class="info-box">
      <p><strong>Participant ID:</strong> ${participant.id}</p>
      <p><strong>Circle Leader:</strong> ${hub ? hub.full_name : '—'}</p>
      <p><strong>Location:</strong> ${hub ? [hub.area, hub.city].filter(Boolean).join(', ') : '—'}</p>
    </div>
    <p>If you believe this is an error or would like to re-register, you can find another circle near you.</p>
    <div class="btn-wrap">
      <a class="btn" href="${PARTICIPANT_URL}">Find a Circle Near You</a>
    </div>
    <p>For any queries, contact us at <a href="mailto:support@networkfp.com">support@networkfp.com</a>.</p>
    <p>We hope to have you back in an NFP Circle soon.</p>
  `);

  await send({
    to: participant.email,
    subject: `Your NFP Circles registration has been cancelled — ${participant.full_name}`,
    html,
  });
}

module.exports = {
  sendHubApproved,
  sendHubRejected,
  sendParticipantConfirmed,
  sendParticipantCancelled,
};
