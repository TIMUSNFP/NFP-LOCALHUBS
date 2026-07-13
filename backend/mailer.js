// mailer.js — SMTP-based email utility for NFP Circles (via nodemailer).
// All outbound emails are sent from the address set in FROM_EMAIL env var,
// authenticated through the SMTP account in SMTP_USER / SMTP_PASS.
// If SMTP is not configured, every send is a no-op (safe for local dev).
const nodemailer = require('nodemailer');

// Build the SMTP transport from environment variables. Common providers:
//   Google Workspace / Gmail : host smtp.gmail.com,   port 465 (secure)
//   Microsoft 365 / Outlook  : host smtp.office365.com, port 587 (STARTTLS)
//   Zoho Mail                : host smtp.zoho.com,     port 465 (secure)
// SMTP_PORT 465 => implicit TLS (secure), any other port => STARTTLS.
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = (process.env.SMTP_PASS || '').trim();

// FROM_EMAIL should match the authenticated mailbox (or a permitted alias),
// otherwise most SMTP providers reject or rewrite the From header.
const FROM = process.env.FROM_EMAIL || (SMTP_USER ? `NFP Circles <${SMTP_USER}>` : 'NFP Circles <noreply@networkfp.com>');

const PARTICIPANT_URL = 'https://nfp-circles.vercel.app/participant/';
const HUB_LEADERS_WHATSAPP_URL = 'https://chat.whatsapp.com/EsFjHO5h4kb7eMJ4EFiWRM';
const LOGO_URL = 'https://nfp-circles.vercel.app/circle-leaders/Images/NetworkFP%20Logo.png';

const transporter = (SMTP_HOST && SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for 587/25 (STARTTLS)
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

async function send({ to, subject, html }) {
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — skipping email to ${to}: "${subject}"`);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html });
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
    body { margin: 0; padding: 0; background: #EFE7DC; font-family: Arial, sans-serif; color: #333333; }
    .container { max-width: 600px; margin: 40px auto; background: #FFFFFF; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: #FFFFFF; padding: 24px 32px; text-align: center; border-top: 4px solid #FF5000; border-bottom: 1px solid #EFE7DC; }
    .header img { width: 220px; height: auto; display: inline-block; }
    .body { padding: 32px; }
    .body h2 { margin: 0 0 16px; font-size: 22px; color: #333333; }
    .body p { margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: #333333; }
    .section-heading { font-size: 17px; font-weight: 800; color: #333333; margin: 24px 0 4px; }
    .next-steps { margin: 0 0 8px; padding-left: 22px; }
    .next-steps li { font-size: 14px; line-height: 1.7; color: #333333; margin-bottom: 6px; }
    .badge { display: inline-block; background: #D7E7DF; color: #333333; border-radius: 20px; padding: 6px 16px; font-size: 13px; font-weight: 700; margin-bottom: 20px; }
    .badge.rejected { background: #B0B0B0; color: #FFFFFF; }
    .info-box { background: #EFE7DC; border-left: 4px solid #FF5000; border-radius: 4px; padding: 16px 20px; margin: 20px 0; }
    .info-box p { margin: 4px 0; font-size: 14px; color: #333333; }
    .info-box strong { color: #6A7D8B; }
    .id-box { background: #FF5000; color: #FFFFFF; border-radius: 6px; padding: 14px 20px; text-align: center; margin: 20px 0; }
    .id-box span { display: block; font-size: 12px; opacity: 0.85; margin-bottom: 4px; }
    .id-box strong { font-size: 18px; letter-spacing: 1px; }
    .btn-wrap { text-align: center; margin: 24px 0 8px; }
    .btn { display: inline-block; background: #FF5000; color: #FFFFFF !important; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
    .footer { background: #EFE7DC; padding: 18px 32px; text-align: center; font-size: 12px; color: #6A7D8B; }
    .footer a { color: #FF5000; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${LOGO_URL}" alt="Network FP" width="220" height="67" style="width:220px;height:auto;display:inline-block;" />
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
    <div class="info-box">
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
      <p><strong>Venue Type:</strong> ${hub.venue_type || '—'}</p>
      <p><strong>Capacity:</strong> ${hub.capacity || '—'}</p>
      <p><strong>Event Date:</strong> 5 Aug 2026, 4:00 PM – 7:30 PM</p>
    </div>
    <p>Your circle is now live and visible to participants who can register with you.</p>
    <p class="section-heading">What to Expect Next?</p>
    <ol class="next-steps">
      <li>Your circle goes live — members in your city can start joining your circle.</li>
      <li>Get added to the official Circle Leaders Group for all communications.</li>
      <li>Get notified when your circle is full, and know your participants.</li>
      <li>Join the all Circle Leads briefing call — 10 days prior to the event.</li>
      <li>Get ready to host your circle in your city on 5 Aug 2026, 4:00 PM – 7:30 PM.</li>
    </ol>
    <div class="btn-wrap">
      <a class="btn" href="${HUB_LEADERS_WHATSAPP_URL}">Join the Hub Leaders WhatsApp Group</a>
    </div>
    <p class="section-heading">Please Note</p>
    <ol class="next-steps">
      <li>Network FP will have the final standing on dissolving or merging any Circles as per the requirement of the city, and will have the final call around participants and leaders.</li>
      <li>NFP Circles are meant for peer learning and knowledge sharing only. Circle Leads and Members are expected to refrain from using these sessions for direct product sales, solicitation, or promotion of personal business interests.</li>
    </ol>
    <p>If you have any questions, please reach out to us at <a href="mailto:sumit@networkfp.com">sumit@networkfp.com</a>.</p>
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
    <h2>Hello, ${hub.full_name},</h2>
    <p>Thank you so much for your interest in hosting an NFP Circle, and we're sorry for the delay in getting back to you.</p>
    <p>After carefully reviewing your application, we're not able to approve it at this time. We know this isn't the news you were hoping for, and we're genuinely sorry. This decision isn't a reflection of you — it's mainly driven by the current demand and circle density in your area, as well as other operational factors on our end at this time.</p>
    <div class="info-box">
      <p><strong>Application ID:</strong> ${hub.id}</p>
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
    </div>
    <p>We'd still love to have you be part of the NFP community. While hosting isn't possible right now, you're welcome to join an existing circle near you as a participant — it's a great way to stay connected and involved, and you'll be first in line if a hosting opportunity opens up in your area in the future.</p>
    <div class="btn-wrap">
      <a class="btn" href="${PARTICIPANT_URL}">Find a Circle Near You</a>
    </div>
    <p>If you have any questions, feel free to reach out to us at <a href="mailto:sumit@networkfp.com">sumit@networkfp.com</a>.</p>
    <p>Once again, we're sorry we couldn't say yes this time, and we truly appreciate your enthusiasm for the NFP Circles programme.</p>
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
    <p>For any queries, write to us at <a href="mailto:sumit@networkfp.com">sumit@networkfp.com</a>.</p>
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
    <p>For any queries, contact us at <a href="mailto:sumit@networkfp.com">sumit@networkfp.com</a>.</p>
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
