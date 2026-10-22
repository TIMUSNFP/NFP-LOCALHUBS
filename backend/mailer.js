// mailer.js — SMTP-based email utility for NFP Circles (via nodemailer).
// All outbound emails are sent from the address set in FROM_EMAIL env var,
// authenticated through the SMTP account in SMTP_USER / SMTP_PASS.
// If SMTP is not configured, every send is a no-op (safe for local dev).
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { formatEditionDate } = require('./utils');

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
const FROM = process.env.FROM_EMAIL || (SMTP_USER ? `NFP Circles <${SMTP_USER}>` : 'NFP Circles <circles@networkfp.com>');

const PARTICIPANT_URL = 'https://nfp-circles.vercel.app/participant/';
const HUB_LEADERS_WHATSAPP_URL = 'https://chat.whatsapp.com/D7vMp9xxt4XElJZ0dRW09c';
// Shown in the participant confirmation email (sent when a participant is confirmed).
const PARTICIPANTS_WHATSAPP_URL = 'https://chat.whatsapp.com/ELqTJO5YjDE5yH754l8rIO?s=cl&p=a&mlu=4&ilr=4';
const LOGO_URL = 'https://nfp-circles.vercel.app/circle-leaders/Images/NetworkFP%20Logo.png';
const CRM_UNSUBSCRIBE_BASE_URL = 'https://nfp-circles.vercel.app/api/crm/unsubscribe';

// circles.networkfp.com is the custom-domain alias of the same deployment as
// nfp-circles.vercel.app above — used here (rather than the vercel.app URL) to
// match the real outreach copy these two recruitment emails are built from.
const CIRCLE_LEADERS_REG_URL = 'https://circles.networkfp.com/circle-leaders/';
const PARTICIPANT_REG_URL = 'https://circles.networkfp.com/participant/';

// Read once at startup and sent as a CID attachment (not a hosted <img src>) so
// it always renders regardless of whether Images/ is served publicly.
const SCHEDULE_IMAGE_PATH = path.join(__dirname, '..', 'participant', 'Images', 'NFP Circles Schedule.png');
let scheduleImageBuffer = null;
try {
  scheduleImageBuffer = fs.readFileSync(SCHEDULE_IMAGE_PATH);
} catch (e) {
  console.warn('[mailer] Schedule image not found at', SCHEDULE_IMAGE_PATH, '— reminder emails will send without it.');
}

// Same CID-attachment approach as the schedule image above, for the recruitment
// emails' header wordmark (the Grey + Orange variant reads correctly on the
// white header background these emails use).
const RECRUIT_LOGO_PATH = path.join(__dirname, '..', 'Brand Kit', 'Logos', 'Network FP Logos', 'NFP Wordmark Grey + Orange.png');
let recruitLogoBuffer = null;
try {
  recruitLogoBuffer = fs.readFileSync(RECRUIT_LOGO_PATH);
} catch (e) {
  console.warn('[mailer] Recruitment logo not found at', RECRUIT_LOGO_PATH, '— recruitment emails will send without it.');
}

// Full mailing address for a hub — "Street, Area, City - PIN Code", skipping any
// pieces the leader didn't provide.
function formatHubAddress(hub) {
  const line = [hub.address, hub.area, hub.city].filter(Boolean).join(', ');
  return hub.pincode ? `${line} - ${hub.pincode}` : line;
}

// ─── Edition theme/date lookup ──────────────────────────────────────────────
// Every transactional email below is scoped to the edition the specific hub
// or participant it's about actually belongs to (hub.edition / participant.
// edition) — not just whatever edition happens to be active right now — so an
// admin action on a past edition's circle still emails that edition's real
// date, not today's. Cached per process since a single bulk action (e.g. Send
// Roster to All Approved) can trigger this dozens of times for the same edition.
const editionInfoCache = new Map();

async function getEditionInfo(edition) {
  if (editionInfoCache.has(edition)) return editionInfoCache.get(edition);
  const row = await db.get('SELECT * FROM editions WHERE edition = $1', [edition]);
  const info = {
    themeTitle: row ? row.theme_title : null,
    themeTagline: row ? row.theme_tagline : null,
    date: row ? formatEditionDate(row.event_date) : null,
    timeStart: row ? row.event_time_start : null,
    timeEnd: row ? row.event_time_end : null,
  };
  editionInfoCache.set(edition, info);
  return info;
}

// Composes the "<date><sep><time range>" strings used across templates.
// `dateStyle` picks which of formatEditionDate's variants to use; `sep` sits
// between the date and the time range, and `timeJoiner` between start/end
// time — templates disagree on ", " + "–" vs " | " + "to", so this preserves
// each one's existing voice instead of silently reformatting every email the
// same way.
function formatEventWhen(info, dateStyle, sep = ', ', timeJoiner = ' to ') {
  if (!info || !info.date) return 'Date to be announced';
  const datePart = info.date[dateStyle] || info.date.withDay;
  if (!info.timeStart || !info.timeEnd) return datePart;
  return `${datePart}${sep}${info.timeStart}${timeJoiner}${info.timeEnd}`;
}

// pool:true is what actually matters for CRM campaign sends: without it, nodemailer
// opens a brand-new connection AND re-authenticates (a fresh AUTH LOGIN) for every
// single sendMail() call. Sending a few hundred emails back-to-back this way looks
// to Gmail like a burst of repeated logins, not a burst of mail, and it starts
// rejecting with "454-4.7.0 Too many login attempts" partway through — this is what
// happened to the first real CRM campaign. With pooling, nodemailer authenticates
// once and reuses that single connection for every send. maxConnections stays at 1
// (rather than nodemailer's default of 5) so we never open several connections in
// parallel, which is its own way to look like abuse to a mail provider.
const transporter = (SMTP_HOST && SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true for 465, false for 587/25 (STARTTLS)
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true,
      maxConnections: 1,
      maxMessages: Infinity,
      // Without explicit timeouts, a single connection that hangs (no error, no
      // response, just silence) blocks forever — and with maxConnections:1 that
      // means the ENTIRE campaign stalls on one stuck send, with nothing thrown
      // for the batch loop's try/catch to even catch. This is what happened to
      // the first real CRM campaign after a resume: 17 sent, then silently stuck
      // for 26+ minutes. These bound every phase of a send so a hang surfaces as
      // a normal caught error (recipient marked Failed, loop moves on) instead.
      connectionTimeout: 10000, // time to establish the TCP connection
      greetingTimeout: 10000,   // time to wait for the SMTP greeting after connecting
      socketTimeout: 20000,     // time of socket inactivity before killing an in-flight send
    })
  : null;

async function send({ to, subject, html, attachments }) {
  if (!transporter) {
    console.log(`[mailer] SMTP not configured — skipping email to ${to}: "${subject}"`);
    return;
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html, ...(attachments ? { attachments } : {}) });
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
    .roster-table { width: 100%; border-collapse: collapse; margin: 16px 0 20px; }
    .roster-table th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: #6A7D8B; padding: 0 0 8px; border-bottom: 2px solid #EFE7DC; }
    .roster-table td { font-size: 14px; color: #333333; padding: 10px 0; border-bottom: 1px solid #EFE7DC; }
    .roster-table td:first-child { font-weight: 700; }
    .theme-block { background: #D7E7DF; border-radius: 8px; padding: 16px 20px; margin: 20px 0; text-align: center; }
    .theme-block .theme-title { font-size: 16px; font-weight: 800; color: #333333; margin: 0 0 4px; }
    .theme-block .theme-tag { font-size: 13px; color: #6A7D8B; font-style: italic; margin: 0; }
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
  const edition = await getEditionInfo(hub.edition);
  const when = formatEventWhen(edition, 'full', ', ', ' – ');
  const html = wrap(`
    <div class="badge">✓ Application Approved</div>
    <h2>Welcome to NFP Circles, ${hub.full_name}!</h2>
    <p>We're excited to let you know that your application to host an NFP Circle has been <strong>approved</strong>. You are now an official NFP Circle Leader.</p>
    <div class="info-box">
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
      <p><strong>Venue Type:</strong> ${hub.venue_type || '—'}</p>
      <p><strong>Capacity:</strong> ${hub.capacity || '—'}</p>
      <p><strong>Event Date:</strong> ${when}</p>
    </div>
    <p>Your circle is now live and visible to participants who can register with you.</p>
    <p class="section-heading">What to Expect Next?</p>
    <ol class="next-steps">
      <li>Your circle goes live — members in your city can start joining your circle.</li>
      <li>Get added to the official Circle Leaders Group for all communications.</li>
      <li>Get notified when your circle is full, and know your participants.</li>
      <li>Join the all Circle Leads briefing call — 10 days prior to the event.</li>
      <li>Get ready to host your circle in your city on ${when}.</li>
    </ol>
    <div class="btn-wrap">
      <a class="btn" href="${HUB_LEADERS_WHATSAPP_URL}">Join the Hub Leaders WhatsApp Group</a>
    </div>
    <p style="font-size:13px;color:#6A7D8B;text-align:center;margin-top:-4px">If you've already joined the group, please ignore this message.</p>
    <p class="section-heading">Please Note</p>
    <ol class="next-steps">
      <li>Network FP will have the final standing on dissolving or merging any Circles as per the requirement of the city, and will have the final call around participants and leaders.</li>
      <li>NFP Circles are meant for peer learning and knowledge sharing only. Circle Leads and Members are expected to refrain from using these sessions for direct product sales, solicitation, or promotion of personal business interests.</li>
    </ol>
    <p>If you have any questions, please reach out to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
    <p>Thank you for being a part of the NFP community!</p>
  `);

  await send({
    to: hub.email,
    subject: `Your NFP Circle has been approved — Welcome, ${hub.full_name}!`,
    html,
  });
}

// ─── Hub Carried Over To Next Edition ──────────────────────────────────────────

async function sendHubCarriedToNextEdition(hub) {
  const edition = await getEditionInfo(hub.edition);
  const when = formatEventWhen(edition, 'full', ', ', ' – ');
  const themeLine = edition.themeTitle ? `<p><strong>This Edition's Theme:</strong> ${edition.themeTitle}</p>` : '';
  const html = wrap(`
    <div class="badge">✓ You're All Set for the Next Edition</div>
    <h2>Great news, ${hub.full_name}!</h2>
    <p>Since you were an approved Circle Leader last edition, we've carried your circle forward to the next edition of NFP Circles — <strong>no re-application needed</strong>.</p>
    <div class="info-box">
      <p><strong>Location:</strong> ${[hub.area, hub.city].filter(Boolean).join(', ')}</p>
      <p><strong>Venue Type:</strong> ${hub.venue_type || '—'}</p>
      <p><strong>Capacity:</strong> ${hub.capacity || '—'}</p>
      <p><strong>Event Date:</strong> ${when}</p>
      ${themeLine}
    </div>
    <p>Your circle is live again and open for participants to register. Since registrations reset each edition, participants — including anyone who joined you last time — will need to register again for this edition.</p>
    <p>We'll be in touch with further details as the date approaches.</p>
    <p>If you have any questions, please reach out to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
    <p>Thank you for continuing to be part of the NFP community!</p>
  `);

  await send({
    to: hub.email,
    subject: `You're set for the next edition of NFP Circles, ${hub.full_name}!`,
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
    <p>If you have any questions, feel free to reach out to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
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
  const edition = await getEditionInfo(participant.edition);
  const when = formatEventWhen(edition, 'withDay', ' | ');
  const shortDate = edition.date ? edition.date.short : 'the day';
  const themeBlock = edition.themeTitle
    ? `<div class="theme-block">
         <p class="theme-title">Theme: ${edition.themeTitle}</p>
         ${edition.themeTagline ? `<p class="theme-tag">${edition.themeTagline}</p>` : ''}
       </div>`
    : '';
  const html = wrap(`
    <div class="badge">✅ Registration Confirmed</div>
    <h2>You're in, ${participant.full_name}! 🎉</h2>
    <p>Your registration for the NFP Circle has been confirmed. We look forward to seeing you at your local Circle Meet.</p>
    ${themeBlock}
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${hub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(hub)}</p>
      <p><strong>Date &amp; Time:</strong> ${when}</p>
    </div>
    <p>Your Circle Lead &amp; the NFP Team will be in touch with further steps.</p>
    <div class="btn-wrap">
      <a class="btn" href="${PARTICIPANTS_WHATSAPP_URL}">Join the Participants WhatsApp Group</a>
    </div>
    <p style="font-size:13px;color:#6A7D8B;text-align:center;margin-top:-4px">If you've already joined the group, please ignore this message.</p>
    <p>You'll soon receive the complete agenda for what's happening on ${shortDate}. Till then, stay tuned!</p>
    <p class="section-heading">Your NFP Circle Experience:</p>
    <ul class="next-steps" style="list-style:none;padding-left:0">
      <li>1️⃣ Build Your Team</li>
      <li>2️⃣ Learn from Peers</li>
      <li>3️⃣ Vote Live</li>
      <li>4️⃣ Ask Anything</li>
      <li>5️⃣ Keynote Address</li>
    </ul>
    <p class="section-heading">Please Note</p>
    <p>NFP Circles are a space for open peer learning. We request all participants to keep sessions free of solicitation, direct sales pitches, or promotion of personal business interests.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
    <p>Welcome to the NFP Circles community! 🙌</p>
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
    <p>For any queries, contact us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
    <p>We hope to have you back in an NFP Circle soon.</p>
  `);

  await send({
    to: participant.email,
    subject: `Your NFP Circles registration has been cancelled — ${participant.full_name}`,
    html,
  });
}

// ─── Hub Roster Update ────────────────────────────────────────────────────────
// Sent on-demand by an admin (not tied to a status change) — gives an approved
// Circle Leader the current list of their Confirmed participants. If the circle
// is empty or still under capacity, adds an encouraging "we're still filling it"
// note instead of leaving them wondering why turnout looks low.

async function sendHubRosterUpdate(hub, participants) {
  const edition = await getEditionInfo(hub.edition);
  const when = formatEventWhen(edition, 'withDayAndYear', ' | ');
  const shortDate = edition.date ? edition.date.short : 'the day';
  const count = participants.length;
  const capacityNum = parseInt(hub.capacity, 10) || null;

  const tableHtml = count === 0 ? '' : `
    <table class="roster-table" role="presentation">
      <tr><th>Participant</th><th>Mobile</th></tr>
      ${participants.map(p => `
        <tr>
          <td>${p.full_name}</td>
          <td>${p.mobile}</td>
        </tr>
      `).join('')}
    </table>
  `;

  let noteHtml = '';
  if (count === 0) {
    noteHtml = `
      <div class="info-box">
        <p>No participants have confirmed for your circle yet — but don't worry! We're actively promoting your circle to NFP Members in ${hub.city}, and registrations are rolling in daily.</p>
        <p><strong>Please be patient, we are working towards filling your circle.</strong> We'll keep you posted as new participants join.</p>
      </div>
    `;
  } else if (capacityNum && count < capacityNum) {
    noteHtml = `
      <div class="info-box">
        <p>Your circle currently has <strong>${count}</strong> confirmed participant${count > 1 ? 's' : ''}, with room for up to <strong>${capacityNum}</strong>. We're continuing to promote your circle to NFP Members in ${hub.city}.</p>
        <p><strong>Please be patient, we are working towards filling your circle</strong> further before the big day.</p>
      </div>
    `;
  }

  const html = wrap(`
    <div class="badge">📋 Your Circle Roster</div>
    <h2>Hi ${hub.full_name}, here's who's joining your Circle!</h2>
    <p>As your NFP Circle Meet on ${shortDate} approaches, here's the latest list of participants confirmed for your circle at ${formatHubAddress(hub)}.</p>
    ${tableHtml}
    ${noteHtml}
    <div class="info-box">
      <p><strong>Date &amp; Time:</strong> ${when}</p>
      <p><strong>Venue:</strong> ${formatHubAddress(hub)}</p>
    </div>
    <p class="section-heading">What to do next</p>
    <p>Please create a <strong>WhatsApp group</strong> for your circle and add your participants to it, along with:</p>
    <ul class="next-steps">
      <li><strong>Sumit Sawant</strong> — 7208931022</li>
      <li><strong>Mrs. Priya</strong> — 98920 22653</li>
    </ul>
    <p>This will be the main channel for coordinating your Circle Meet, so please <strong>set it up at the earliest</strong>.</p>
    <p>Feel free to reach out to your participants ahead of time to introduce yourself and share any last-minute details.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a> or call us at <a href="tel:+917208931022">7208931022</a>.</p>
    <p>Looking forward to a great Circle Meet! 🙌</p>
  `);

  await send({
    to: hub.email,
    subject: `Your NFP Circle Roster — ${hub.city}`,
    html,
  });
}

// ─── Hub Details Updated ──────────────────────────────────────────────────────
// Sent on-demand by an admin after editing a Circle Leader's details — tells a
// Confirmed participant exactly which fields changed. If the change touched the
// venue address, also spells out the new full address so it isn't left buried
// in a raw old-vs-new diff.

async function sendHubDetailsUpdated(participant, hub, changes) {
  const diffHtml = changes
    .map((c) => `<p><strong>${c.label}:</strong> ${c.oldValue || '—'} &rarr; ${c.newValue || '—'}</p>`)
    .join('');

  const addressChanged = changes.some((c) => ['address', 'area', 'city', 'pincode'].includes(c.field));

  const html = wrap(`
    <div class="badge">📣 Circle Update</div>
    <h2>Hi ${participant.full_name}, there's an update to your NFP Circle</h2>
    <p>Your Circle Leader, <strong>${hub.full_name}</strong>, has updated some details for the circle you're registered with. Here's what changed:</p>
    <div class="info-box">
      ${diffHtml}
    </div>
    ${addressChanged ? `
    <div class="info-box">
      <p><strong>Updated Venue Address:</strong> ${formatHubAddress(hub)}</p>
    </div>
    ` : ''}
    <p>No action is needed from you — just make a note of the change ahead of your Circle Meet.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: participant.email,
    subject: `Update to your NFP Circle — ${hub.city}`,
    html,
  });
}

// ─── Participant Transferred ──────────────────────────────────────────────────
// Sent on-demand by an admin when moving a participant from one Circle to
// another (e.g. their original circle is full, dissolved, or a better-located
// one opened up). Shows both the old and new Circle Leader/venue so it's clear
// exactly what changed, not just that something did.

async function sendParticipantTransferred(participant, oldHub, newHub) {
  const edition = await getEditionInfo(participant.edition);
  const when = formatEventWhen(edition, 'withDay', ' | ');
  const html = wrap(`
    <div class="badge">🔄 You've Been Moved to a New Circle</div>
    <h2>Hi ${participant.full_name}, your NFP Circle has changed</h2>
    <p>We've moved your registration to a different NFP Circle. Here's where you were, and where you are now:</p>
    <div class="info-box">
      <p><strong>Previous Circle Leader:</strong> ${oldHub ? oldHub.full_name : '—'}</p>
      <p><strong>Previous Location:</strong> ${oldHub ? formatHubAddress(oldHub) : '—'}</p>
    </div>
    <div class="theme-block">
      <p class="theme-title">Your New Circle</p>
    </div>
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${newHub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(newHub)}</p>
      <p><strong>Date &amp; Time:</strong> ${when}</p>
    </div>
    <p>No action is needed from you — your registration is already confirmed with your new Circle Leader.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: participant.email,
    subject: `You've been moved to a new NFP Circle — ${newHub.city}`,
    html,
  });
}

// ─── Participant Event Reminder (5 days out) ──────────────────────────────────
// Sent on-demand by an admin to Confirmed participants as the event approaches.
// Includes the circle leader's own contact details so anyone the leader hasn't
// gotten around to adding to the circle's WhatsApp group yet has a direct way
// to follow up, rather than being left wondering.

async function sendParticipantEventReminder(participant, hub) {
  const edition = await getEditionInfo(participant.edition);
  const when = formatEventWhen(edition, 'withDay', ' | ');
  const scheduleImageHtml = scheduleImageBuffer
    ? `<div style="text-align:center;margin:20px 0">
         <img src="cid:circle-schedule" alt="NFP Circle Schedule" width="536" style="max-width:100%;height:auto;border-radius:8px" />
       </div>`
    : '';

  const html = wrap(`
    <div class="badge" style="background:#FEE2E2;color:#B91C1C">⏰ 5 Days to Go!</div>
    <h2>Hi ${participant.full_name}, get ready for your NFP Circle!</h2>
    <p>Just a quick reminder — your NFP Circle Meet is happening in <strong>5 days</strong>. Here are the details:</p>
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${hub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(hub)}</p>
      <p><strong>Date &amp; Time:</strong> ${when}</p>
    </div>
    <p class="section-heading">Here's what's on the agenda</p>
    ${scheduleImageHtml}
    <div class="info-box">
      <p>If you are not in your Circle Leader's WhatsApp group, please connect with them directly:</p>
      <p><strong>${hub.full_name}</strong> — <a href="tel:${hub.mobile}">${hub.mobile}</a></p>
    </div>
    <p>More details on participant guidelines will be shared shortly — stay tuned!</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
    <p>See you there! 🙌</p>
  `);

  await send({
    to: participant.email,
    subject: `Hi ${participant.full_name}, get ready for NFP Circle!`,
    html,
    attachments: scheduleImageBuffer
      ? [{ filename: 'NFP-Circle-Schedule.png', content: scheduleImageBuffer, cid: 'circle-schedule' }]
      : undefined,
  });
}

// Sent when an admin combines two circles (routes/admin.js's /hubs/:id/combine) —
// distinct wording from sendParticipantTransferred above: this is framed as two
// circles joining together into one bigger group, not an arbitrary reassignment.
async function sendParticipantCircleCombined(participant, oldHub, newHub) {
  const edition = await getEditionInfo(participant.edition);
  const when = formatEventWhen(edition, 'withDay', ' | ');
  const html = wrap(`
    <div class="badge">🤝 Your Circle Has Combined With Another</div>
    <h2>Hi ${participant.full_name}, exciting update about your NFP Circle</h2>
    <p>To bring together a bigger, more active group, your NFP Circle has combined with
    ${newHub.full_name}'s Circle. Your registration has moved over automatically — no
    action is needed from you.</p>
    <div class="info-box">
      <p><strong>Previous Circle Leader:</strong> ${oldHub ? oldHub.full_name : '—'}</p>
      <p><strong>Previous Location:</strong> ${oldHub ? formatHubAddress(oldHub) : '—'}</p>
    </div>
    <div class="theme-block">
      <p class="theme-title">Your Combined Circle</p>
    </div>
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${newHub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(newHub)}</p>
      <p><strong>Venue Type:</strong> ${newHub.venue_type || '—'}</p>
      <p><strong>Date &amp; Time:</strong> ${when}</p>
    </div>
    <p>Your registration is already confirmed with your new Circle Leader — just show up at the address above.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: participant.email,
    subject: `Your NFP Circle has combined with ${newHub.full_name}'s Circle`,
    html,
  });
}

// Sent to the Circle Leader whose circle was closed in a combine (the surviving
// leader doesn't need a separate email — nothing changes for them except a
// bigger roster, which already shows up next time they view/receive it).
// The other half of a merge: the leader whose circle stays open. The closing leader already
// gets sendHubLeaderCircleMerged; without this one the surviving leader would not be told
// that another circle (and its participants) was added to theirs.
async function sendHubLeaderCircleMergedSurvivor(survivingHub, closingHub, movedCount) {
  const html = wrap(`
    <div class="badge">Another Circle Has Combined With Yours</div>
    <h2>Hi ${survivingHub.full_name}, ${closingHub.full_name}'s Circle has combined with yours</h2>
    <p>We have combined ${closingHub.full_name}'s NFP Circle with yours to bring together a bigger, more
    active group. You remain the Circle Leader.${movedCount > 0 ? ` ${movedCount} participant${movedCount === 1 ? ' has' : 's have'} been added to your Circle.` : ''}</p>
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${survivingHub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(survivingHub)}</p>
      <p><strong>Venue Type:</strong> ${survivingHub.venue_type || '—'}</p>
      <p><strong>Capacity:</strong> ${survivingHub.capacity || '—'}</p>
    </div>
    <p>Your Circle keeps its current capacity. If your space can seat more people, write to us and we will raise it.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: survivingHub.email,
    subject: `${closingHub.full_name}'s Circle has combined with yours`,
    html,
  });
}

async function sendHubLeaderCircleMerged(closingHub, survivingHub, movedCount) {
  const html = wrap(`
    <div class="badge">🤝 Your Circle Has Combined With Another</div>
    <h2>Hi ${closingHub.full_name}, your NFP Circle has combined with another</h2>
    <p>Your NFP Circle has been combined with ${survivingHub.full_name}'s Circle to bring
    together a bigger, more active group.${movedCount > 0 ? ` ${movedCount} participant${movedCount === 1 ? '' : 's'}
    from your Circle ${movedCount === 1 ? 'has' : 'have'} been moved over automatically.` : ''}</p>
    <div class="info-box">
      <p><strong>Combined Circle Leader:</strong> ${survivingHub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(survivingHub)}</p>
      <p><strong>Venue Type:</strong> ${survivingHub.venue_type || '—'}</p>
    </div>
    <p>Thank you for hosting with NFP Circles — if you'd like to host again in the future,
    just reach out to us.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: closingHub.email,
    subject: `Your NFP Circle has combined with ${survivingHub.full_name}'s Circle`,
    html,
  });
}

// Sent when an admin undoes a combine (routes/admin.js's /hubs/:id/revert-merge).
// Only participants actually moved back get this — anyone who joined the
// (former) surviving circle independently, or was since manually transferred
// elsewhere, is left alone.
async function sendParticipantCircleMergeReverted(participant, fromHub, toHub) {
  const edition = await getEditionInfo(participant.edition);
  const when = formatEventWhen(edition, 'withDay', ' | ');
  const html = wrap(`
    <div class="badge">↩️ Your Circle Has Been Restored</div>
    <h2>Hi ${participant.full_name}, your original NFP Circle is back</h2>
    <p>The combination of your Circle with ${fromHub.full_name}'s Circle has been undone, and
    your registration has moved back to your original Circle Leader. No action is needed from you.</p>
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${toHub.full_name}</p>
      <p><strong>Address:</strong> ${formatHubAddress(toHub)}</p>
      <p><strong>Venue Type:</strong> ${toHub.venue_type || '—'}</p>
      <p><strong>Date &amp; Time:</strong> ${when}</p>
    </div>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: participant.email,
    subject: `Your NFP Circle has been restored — ${toHub.full_name}'s Circle`,
    html,
  });
}

// Sent to the Circle Leader whose closed circle just got restored.
async function sendHubLeaderCircleMergeReverted(restoredHub, formerSurvivingHub, restoredCount) {
  const html = wrap(`
    <div class="badge">↩️ Your Circle Has Been Restored</div>
    <h2>Hi ${restoredHub.full_name}, your NFP Circle is active again</h2>
    <p>Your Circle's combination with ${formerSurvivingHub.full_name}'s Circle has been undone.
    Your Circle is reopened, and ${restoredCount} participant${restoredCount === 1 ? '' : 's'}
    ${restoredCount === 1 ? 'has' : 'have'} moved back to you automatically.</p>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
  `);

  await send({
    to: restoredHub.email,
    subject: `Your NFP Circle has been restored`,
    html,
  });
}

// ─── NFP Circle CRM — city outreach campaign ──────────────────────────────────
// Sent to cold-outreach contacts (NFP Members / QPFP Certificants) who are not
// registered anywhere yet. Tells them which open Circles exist in their city and
// why to join, with a link to register and a one-click unsubscribe.

function crmUnsubscribeUrl(contactId) {
  const token = jwt.sign({ cid: contactId }, process.env.JWT_SECRET);
  return `${CRM_UNSUBSCRIBE_BASE_URL}?cid=${encodeURIComponent(contactId)}&token=${encodeURIComponent(token)}`;
}

// The "today at 4:00 PM" deadline here is campaign-send-day copy, not the
// event's own start time — a coincidence in wording, not the same value — so
// it's left as admin-editable campaign copy (campaign.introHtml already
// overrides this default). Only the event date reference is parameterized.
function buildDefaultCrmIntro(shortDate) {
  return `
    <p>Registrations for NFP Circles in your city close <strong>today at 4:00 PM</strong> — after that,
    we won't be able to accommodate any more sign-ups for the ${shortDate} meetup.</p>
    <p>NFP Circles are small, in-person peer-learning meetups made specifically for NFP Members —
    a few hours to connect with peers in your city, discuss real challenges, and walk away with
    practical ideas you can use right away.</p>
    <p>They're free to attend, run by fellow NFP Members and QPFP Certificants, and built purely
    for peer learning — no sales pitches, no solicitation.</p>
  `;
}

// hub.full_name/area/venue_type come from the public Hub Leader application form
// and contact.full_name/city come from an admin-imported spreadsheet — neither is
// escaped anywhere else before reaching this bulk-sent email, so escape here as
// defense in depth (same rationale as renderCrmSubject's CRLF stripping above).
function escHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// hubs: array of hub rows (city/area/venue_type/capacity) to feature in the email.
// Each hub is dated using its own edition (hub.edition), not a single global
// "today's" date — a campaign can in principle span hubs from more than one
// edition, and each should show its own real event date.
async function buildCircleCrmEmailHtml(contact, hubs, campaign) {
  const cityLabel = escHtml(campaign.targetCities && campaign.targetCities.length ? campaign.targetCities.join(' / ') : (contact.city || 'your city'));

  const hubsHtml = (await Promise.all(hubs.map(async (hub) => {
    const edition = await getEditionInfo(hub.edition);
    const when = formatEventWhen(edition, 'withDay', ' | ');
    return `
    <div class="info-box">
      <p><strong>Circle Leader:</strong> ${escHtml(hub.full_name || hub.fullName || '—')}</p>
      <p><strong>Area:</strong> ${escHtml(hub.area || '—')}</p>
      <p><strong>Venue Type:</strong> ${escHtml(hub.venue_type || hub.venueType || '—')}</p>
      <p><strong>Date &amp; Time:</strong> ${when}</p>
    </div>
  `;
  }))).join('');

  const primaryEdition = await getEditionInfo(hubs[0] ? hubs[0].edition : undefined);
  const shortDate = primaryEdition.date ? primaryEdition.date.short : 'the';

  const html = wrap(`
    <div class="badge" style="background:#FEE2E2;color:#B91C1C">🚨 FINAL DEADLINE — Registrations close today at 4:00 PM</div><br>
    <div class="badge" style="margin-top:8px">📍 NFP Circles open in ${cityLabel}</div>
    <h2>Hi ${escHtml(contact.full_name)}, this is your last chance to join an NFP Circle near you!</h2>
    ${campaign.introHtml || buildDefaultCrmIntro(shortDate)}
    <p class="section-heading">Open Circles in ${cityLabel}</p>
    ${hubsHtml}
    <p>Don't miss out — registration closes at <strong>4:00 PM today</strong>.</p>
    <div class="btn-wrap">
      <a class="btn" href="${PARTICIPANT_URL}">Register Now — Before 4 PM</a>
    </div>
    <p class="section-heading">How to Register</p>
    <ol class="next-steps">
      <li>Click the <strong>Register Now</strong> button above.</li>
      <li>Click <strong>Find a Circle</strong>.</li>
      <li>Type your city into the search box.</li>
      <li>The Circle(s) open near you will show up on the right-hand side — pick one and register before the deadline.</li>
    </ol>
    <p>For any queries, write to us at <a href="mailto:circles@networkfp.com">circles@networkfp.com</a>.</p>
    <p style="font-size:12px;color:#6A7D8B;text-align:center;margin-top:24px">
      Don't want these emails? <a href="${crmUnsubscribeUrl(contact.id)}">Unsubscribe</a>
    </p>
  `);

  return html;
}

// ─── NFP Circle CRM — Circle Leader invitation for office owners ──────────────
// Sent to contacts who answered "Yes" in the office-space poll (crm_contacts.office_poll).
// Table layout with inline styles because email clients ignore most modern CSS;
// the <style> block only carries the prefers-color-scheme dark rules, which
// clients that don't support it simply skip. Light-theme colors are always set
// inline, so text never depends on the client's theme.
const LEADER_OFFICE_FONT_HEADING = "Georgia,'Times New Roman',serif";
const LEADER_OFFICE_FONT_BODY = 'Lato,Arial,Helvetica,sans-serif';
const LEADER_OFFICE_APPLY_URL = 'https://circles.networkfp.com/circle-leaders/';

async function getLatestEditionNumber() {
  const row = await db.get('SELECT MAX(edition) AS edition FROM editions');
  return row && row.edition != null ? row.edition : undefined;
}

// Greeting name: tidy spacing, turn ALL CAPS / all lowercase sheet entries into proper
// case, and keep professional prefixes (CA, CFP, CS, CMA) upper-case ("Ca Neerja" -> "CA Neerja").
function formatGreetingName(raw) {
  let name = String(raw || '').trim().replace(/\s+/g, ' ');
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length > 3 && (name === name.toUpperCase() || name === name.toLowerCase())) {
    name = name.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  }
  return name.replace(/^(ca|cfp|cs|cma)\b/i, (m) => m.toUpperCase());
}

async function buildLeaderOfficeEmailHtml(contact, edition) {
  const editionNumber = edition !== undefined ? edition : await getLatestEditionNumber();
  const info = await getEditionInfo(editionNumber);
  const H = LEADER_OFFICE_FONT_HEADING;
  const B = LEADER_OFFICE_FONT_BODY;
  const fullName = escHtml(formatGreetingName(contact.full_name) || 'there');
  const city = escHtml(String(contact.city || '').trim());
  const inCity = city ? `in ${city}` : 'in your city';
  const dateFull = info.date ? escHtml(info.date.full) : 'To be announced';
  const timeRange = (info.timeStart && info.timeEnd) ? escHtml(`${info.timeStart} to ${info.timeEnd}`) : 'To be announced';
  const tagline = escHtml(info.themeTagline || 'Come with challenges. Leave with solutions.');
  const editionLabel = editionNumber !== undefined ? `edition ${escHtml(editionNumber)}` : 'the next edition';
  const preheader = `${info.date ? `Edition ${escHtml(editionNumber)} is on ${escHtml(info.date.short)}. ` : ''}Apply to host a Circle ${inCity}.`;
  const p = (extra) => `margin:0${extra || ''};font-family:${B};font-size:16px;line-height:1.65;color:#333333;`;
  const label = `font-family:${B};font-size:13px;line-height:1.3;color:#5A6B77;`;
  const value = `font-family:${H};font-size:22px;line-height:1.3;color:#333333;padding-top:4px;`;
  const footLink = 'color:#5A6B77;text-decoration:underline;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Host an NFP Circle</title>
<style>
@media (prefers-color-scheme: dark){
  .bg-out{background:#14171A !important}
  .bg-card{background:#1E2225 !important}
  .bg-soft{background:#2A2F33 !important}
  .t-main{color:#F1EEE9 !important}
  .t-soft{color:#C3C9CE !important}
  .t-foot{color:#A5AEB5 !important}
  .t-accent{color:#FF7A33 !important}
}
</style>
</head>
<body style="margin:0;padding:0;">
<div class="bg-out" style="margin:0;padding:24px 12px;background:#EFE7DC;color:#333333;font-family:${B};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
<tr><td class="bg-card" style="background:#FFFFFF;border-radius:10px;overflow:hidden;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="padding:28px 36px 0 36px;"><img src="${LOGO_URL}" alt="Network FP" width="132" style="display:block;border:0;height:auto;width:132px;"></td></tr>
  <tr><td style="padding:36px 36px 8px 36px;">
    <h1 class="t-main" style="margin:0;font-family:${H};font-weight:400;font-size:38px;line-height:1.14;letter-spacing:-0.5px;color:#333333;">Got an office? <span class="t-accent" style="font-style:italic;color:#FF5000;">Host an NFP Circle.</span></h1>
  </td></tr>
  <tr><td style="padding:12px 36px 0 36px;">
    <p class="t-soft" style="margin:0;font-family:${H};font-style:italic;font-size:18px;line-height:1.5;color:#4A4A4A;">${tagline}</p>
  </td></tr>
  <tr><td style="padding:28px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft" style="background:#EFE7DC;border-radius:10px;">
     <tr>
      <td width="50%" style="padding:20px 24px;vertical-align:top;">
        <div class="t-foot" style="${label}">Date</div>
        <div class="t-main" style="${value}">${dateFull}</div>
      </td>
      <td width="50%" style="padding:20px 24px;vertical-align:top;">
        <div class="t-foot" style="${label}">Time</div>
        <div class="t-main" style="${value}">${timeRange}</div>
      </td>
     </tr>
    </table>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <p class="t-main" style="${p(';margin-bottom:16px')}">Hi ${fullName},</p>
    <p class="t-main" style="${p(';margin-bottom:16px')}">Your answer to our office poll says you have space ${inCity}. We are looking for Members who can open an office to their peers for one evening, and yours sounds like a fit.</p>
    <p class="t-main" style="${p(';margin-bottom:16px')}">A Circle Leader hosts a small group of NFP Members in their own city. If your office can seat four or more people, you can apply to lead a Circle there.</p>
    <p class="t-main" style="${p()}">Our first edition on 5 August brought together more than 700 people across cities, with 100 Circle Leaders and 630+ participants. Applications for ${editionLabel} are open now, and the form takes a few minutes.</p>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="#FF5000" style="background:#FF5000;border-radius:10px;">
        <a href="${LEADER_OFFICE_APPLY_URL}" style="display:inline-block;padding:16px 28px;font-family:${B};font-size:19px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;">Apply to be a Circle Leader</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:36px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft" style="background:#EFE7DC;border-radius:10px;">
     <tr><td colspan="2" style="padding:22px 24px 6px 24px;"><div class="t-main" style="font-family:${H};font-size:20px;line-height:1.3;color:#333333;">What happens on the day</div></td></tr>
     <tr>
      <td width="50%" class="t-main" style="padding:6px 12px 22px 24px;vertical-align:top;font-family:${B};font-size:15px;line-height:2;color:#333333;">Build your team<br>Learn from peers<br>Vote live</td>
      <td width="50%" class="t-main" style="padding:6px 24px 22px 12px;vertical-align:top;font-family:${B};font-size:15px;line-height:2;color:#333333;">Ask anything<br>Keynote address</td>
     </tr>
    </table>
  </td></tr>
  <tr><td style="padding:28px 36px 0 36px;">
    <p class="t-main" style="margin:0;font-family:${H};font-style:italic;font-size:18px;line-height:1.5;color:#333333;">Be Independent, but never alone.</p>
    <p class="t-soft" style="margin:6px 0 0 0;font-family:${B};font-size:15px;line-height:1.6;color:#4A4A4A;">Team NFP Circles</p>
  </td></tr>
  <tr><td style="padding:32px 36px 32px 36px;">
    <p class="t-foot" style="margin:0;font-family:${B};font-size:13px;line-height:1.7;color:#5A6B77;border-top:1px solid #E3DED6;padding-top:20px;">Questions? Write to <a href="mailto:circles@networkfp.com" class="t-foot" style="${footLink}">circles@networkfp.com</a>.<br>Network FP, <a href="https://www.networkfp.com" class="t-foot" style="${footLink}">www.networkfp.com</a><br><a href="${crmUnsubscribeUrl(contact.id)}" class="t-foot" style="${footLink}">Unsubscribe</a> if you would rather not get these emails.</p>
  </td></tr>
 </table>
</td></tr>
</table>
</div>
</body>
</html>`;
}

// ─── NFP Circle CRM — Circle Leader invitation for all Active Members ────────
// The general version of the office-owner email above: no office-poll line, so it can go
// to any member who might host. Theme, tagline, date and time come from the edition row.
// Edition 1's results are a finished fact, so they are written in directly (from the
// database: 101 leaders, 588 confirmed participants).
const EDITION_ONE_RESULT_LINE = 'Edition 1 brought together nearly 700 people across cities, with about 100 Circle Leaders and almost 600 participants.';
const MARKETING_TOPICS_LINE = 'lead generation, nurturing, conversion, referral systems and investor awareness programmes';

async function buildLeaderInviteEmailHtml(contact, edition) {
  const editionNumber = edition !== undefined ? edition : await getLatestEditionNumber();
  const info = await getEditionInfo(editionNumber);
  const H = LEADER_OFFICE_FONT_HEADING;
  const B = LEADER_OFFICE_FONT_BODY;
  const name = escHtml(formatGreetingName(contact.full_name) || 'there');
  const theme = escHtml(info.themeTitle || 'NFP Circles');
  const tagline = escHtml(info.themeTagline || '');
  const dateFull = info.date ? escHtml(info.date.full) : 'To be announced';
  const dateShort = info.date ? escHtml(info.date.short) : 'soon';
  const timeRange = (info.timeStart && info.timeEnd) ? escHtml(`${info.timeStart} to ${info.timeEnd}`) : 'To be announced';
  const editionLabel = editionNumber !== undefined ? `edition ${escHtml(editionNumber)}` : 'the next edition';
  const themeLine = info.themeTitle === 'Marketing Management' ? `${theme}: ${MARKETING_TOPICS_LINE}` : theme;
  const preheader = `${info.date ? `Edition ${escHtml(editionNumber)} is on ${dateShort}. ` : ''}Apply to lead a Circle in your city.`;
  const p = (extra) => `margin:0${extra || ''};font-family:${B};font-size:16px;line-height:1.65;color:#333333;`;
  const label = `font-family:${B};font-size:13px;line-height:1.3;color:#5A6B77;`;
  const value = `font-family:${H};font-size:22px;line-height:1.3;color:#333333;padding-top:4px;`;
  const footLink = 'color:#5A6B77;text-decoration:underline;';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Lead an NFP Circle</title>
<style>
@media (prefers-color-scheme: dark){
  .bg-out{background:#14171A !important}
  .bg-card{background:#1E2225 !important}
  .bg-soft{background:#2A2F33 !important}
  .t-main{color:#F1EEE9 !important}
  .t-soft{color:#C3C9CE !important}
  .t-foot{color:#A5AEB5 !important}
  .t-accent{color:#FF7A33 !important}
}
</style>
</head>
<body style="margin:0;padding:0;">
<div class="bg-out" style="margin:0;padding:24px 12px;background:#EFE7DC;color:#333333;font-family:${B};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
<tr><td class="bg-card" style="background:#FFFFFF;border-radius:10px;overflow:hidden;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="padding:28px 36px 0 36px;"><img src="${LOGO_URL}" alt="Network FP" width="132" style="display:block;border:0;height:auto;width:132px;"></td></tr>
  <tr><td style="padding:36px 36px 0 36px;">
    <h1 class="t-main" style="margin:0;font-family:${H};font-weight:400;font-size:38px;line-height:1.14;letter-spacing:-0.5px;color:#333333;">Lead an NFP Circle <span class="t-accent" style="font-style:italic;color:#FF5000;">in your city.</span></h1>
  </td></tr>
  ${tagline ? `<tr><td style="padding:12px 36px 0 36px;">
    <p class="t-soft" style="margin:0;font-family:${H};font-style:italic;font-size:18px;line-height:1.5;color:#4A4A4A;">${tagline}</p>
  </td></tr>` : ''}
  <tr><td style="padding:28px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft" style="background:#EFE7DC;border-radius:10px;">
     <tr>
      <td width="50%" style="padding:20px 24px;vertical-align:top;">
        <div class="t-foot" style="${label}">Date</div>
        <div class="t-main" style="${value}">${dateFull}</div>
      </td>
      <td width="50%" style="padding:20px 24px;vertical-align:top;">
        <div class="t-foot" style="${label}">Time</div>
        <div class="t-main" style="${value}">${timeRange}</div>
      </td>
     </tr>
    </table>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <p class="t-main" style="${p(';margin-bottom:16px')}">Hi ${name},</p>
    <p class="t-main" style="${p(';margin-bottom:16px')}">NFP Circles return on ${dateShort} for ${editionLabel} on ${themeLine}.</p>
    <p class="t-main" style="${p(';margin-bottom:16px')}">A Circle Leader hosts a small group of fellow NFP members in their own city. The main session is streamed to every Circle at once, and your group then talks it through in person, with you leading the discussion.</p>
    <p class="t-main" style="${p(';margin-bottom:16px')}">If you have an office or meeting space that seats four or more people, you can apply to lead a Circle. The form takes a few minutes.</p>
    <p class="t-main" style="${p()}">${EDITION_ONE_RESULT_LINE}</p>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td bgcolor="#FF5000" style="background:#FF5000;border-radius:10px;">
        <a href="${LEADER_OFFICE_APPLY_URL}" style="display:inline-block;padding:16px 28px;font-family:${B};font-size:19px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;">Apply to be a Circle Leader</a>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <p class="t-main" style="margin:0;font-family:${H};font-style:italic;font-size:18px;line-height:1.5;color:#333333;">Be Independent, but never alone.</p>
    <p class="t-soft" style="margin:6px 0 0 0;font-family:${B};font-size:15px;line-height:1.6;color:#4A4A4A;">Team NFP Circles</p>
  </td></tr>
  <tr><td style="padding:32px 36px 32px 36px;">
    <p class="t-foot" style="margin:0;font-family:${B};font-size:13px;line-height:1.7;color:#5A6B77;border-top:1px solid #E3DED6;padding-top:20px;">Questions? Write to <a href="mailto:circles@networkfp.com" class="t-foot" style="${footLink}">circles@networkfp.com</a>.<br>Network FP, <a href="https://www.networkfp.com" class="t-foot" style="${footLink}">www.networkfp.com</a><br><a href="${crmUnsubscribeUrl(contact.id)}" class="t-foot" style="${footLink}">Unsubscribe</a> if you would rather not get these emails.</p>
  </td></tr>
 </table>
</td></tr>
</table>
</div>
</body>
</html>`;
}

// ─── NFP Circle CRM — participant invitation (two versions) ───────────────────
// Email A: the member's city has open circles, so list them and invite the member to register.
// Email B: it has none (`hubs` is empty), so ask whether the member, or anyone in their network,
// could be the Circle Leader there; two buttons (lead / join as a participant).

// "BORIVALI WEST" -> "Borivali West"; drops a trailing ", <city>" the leader typed into the area.
function formatHubAreaForEmail(area, city) {
  let a = String(area || '').trim().replace(/\s+/g, ' ');
  if (a && a === a.toUpperCase()) a = a.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, sep, ch) => sep + ch.toUpperCase());
  const c = String(city || '').trim();
  if (c) a = a.replace(new RegExp(',?\\s+' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), '');
  return a;
}

async function buildCircleOpenEmailHtml(contact, hubs) {
  const H = LEADER_OFFICE_FONT_HEADING;
  const B = LEADER_OFFICE_FONT_BODY;
  const spotsLeft = (h) => { const cap = parseInt(h.capacity, 10); return cap > 0 ? cap - (h.participantCount || 0) : null; };
  const sorted = [...(hubs || [])].sort((a, b) => (spotsLeft(b) || 0) - (spotsLeft(a) || 0));
  const first = sorted[0];
  const n = sorted.length;
  const hasCircle = n > 0;
  const editionNumber = first ? first.edition : await getLatestEditionNumber();
  const info = await getEditionInfo(editionNumber);

  const name = escHtml(formatGreetingName(contact.full_name) || 'there');
  const memberCityRaw = String(contact.city || '').trim();
  const memberCity = escHtml(memberCityRaw ? formatHubAreaForEmail(memberCityRaw, '') : 'your city');
  const city = escHtml(first ? first.city : memberCityRaw ? formatHubAreaForEmail(memberCityRaw, '') : 'your city');
  const theme = escHtml(info.themeTitle || 'NFP Circles');
  const tagline = escHtml(info.themeTagline || '');
  const dateFull = info.date ? escHtml(info.date.full) : 'To be announced';
  const dateShort = info.date ? escHtml(info.date.short) : 'soon';
  const timeRange = (info.timeStart && info.timeEnd) ? escHtml(`${info.timeStart} to ${info.timeEnd}`) : 'To be announced';
  const editionLabel = editionNumber !== undefined ? `edition ${escHtml(editionNumber)}` : 'the next edition';
  const p = (extra) => `margin:0${extra || ''};font-family:${B};font-size:16px;line-height:1.65;color:#333333;`;
  const para = (txt, mb) => `<p class="t-main" style="${p(mb ? ';margin-bottom:' + mb + 'px' : '')}">${txt}</p>`;
  const label = `font-family:${B};font-size:13px;line-height:1.3;color:#5A6B77;`;
  const value = `font-family:${H};font-size:22px;line-height:1.3;color:#333333;padding-top:4px;`;
  const footLink = 'color:#5A6B77;text-decoration:underline;';
  const btnOrange = (text, href) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#FF5000" style="background:#FF5000;border-radius:10px;"><a href="${href}" style="display:inline-block;padding:16px 28px;font-family:${B};font-size:19px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;">${text}</a></td></tr></table>`;
  const btnDark = (text, href) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn-dark" bgcolor="#333333" style="background:#333333;border-radius:10px;"><a href="${href}" style="display:inline-block;padding:16px 28px;font-family:${B};font-size:19px;font-weight:700;line-height:1.2;color:#FFFFFF;text-decoration:none;">${text}</a></td></tr></table>`;

  let headlineA, headlineB, introHtml, middleHtml, ctaHtml, preheader;
  if (hasCircle) {
    const leaderName = escHtml(formatGreetingName(first.full_name));
    const firstArea = escHtml(formatHubAreaForEmail(first.area, first.city));
    headlineA = n === 1 ? 'A Circle is open' : 'NFP Circles are open';
    headlineB = `in ${city}.`;
    introHtml = para(n === 1
      ? `${leaderName} has opened a Circle in ${firstArea}, ${city}, for ${editionLabel} on ${theme}. Join them on ${dateShort}.`
      : `${n} fellow NFP members have opened Circles in ${city} for ${editionLabel} on ${theme}. Pick the one closest to you and join them on ${dateShort}.`);
    const shown = sorted.slice(0, 5);
    const cardsHtml = shown.map((h) => {
      const left = spotsLeft(h);
      const bits = [escHtml(formatHubAreaForEmail(h.area, h.city)), escHtml(h.venue_type || '')].filter(Boolean);
      if (left && left > 0) bits.push(`${left} spot${left === 1 ? '' : 's'} left`);
      return `<tr><td style="padding:0 0 12px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft" style="background:#EFE7DC;border-radius:10px;"><tr><td style="padding:16px 20px;"><div class="t-main" style="font-family:${H};font-size:19px;line-height:1.3;color:#333333;">${escHtml(formatGreetingName(h.full_name))}</div><div class="t-soft" style="font-family:${B};font-size:15px;line-height:1.6;color:#4A4A4A;padding-top:4px;">${bits.join(' &middot; ')}</div></td></tr></table></td></tr>`;
    }).join('');
    const moreHtml = n > shown.length ? para(`and ${n - shown.length} more Circle${n - shown.length === 1 ? '' : 's'} in ${city}, all on the registration page.`) : '';
    middleHtml = `<tr><td style="padding:20px 36px 0 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cardsHtml}</table>${moreHtml}</td></tr>`;
    ctaHtml = btnOrange('Register for a Circle', PARTICIPANT_REG_URL);
    preheader = `${n} NFP Circle${n === 1 ? ' is' : 's are'} open in ${city}. Pick yours and register.`;
  } else {
    headlineA = 'Could you lead an NFP Circle';
    headlineB = `in ${memberCity}?`;
    introHtml = para(`There is no Circle open in ${memberCity} yet for ${editionLabel} on ${theme}, on ${dateShort}.`, 16) +
      para(`Can you, or any Network FP member in your network, be the Circle Leader in ${memberCity}? A Circle Leader hosts a small group of fellow NFP members in their own city, in an office or meeting space that seats four or more people.`, 16) +
      para(`Know someone in ${memberCity} who would be a good fit? Forward this email to them. Prefer to attend instead? You can join a Circle in another city as a participant.`);
    middleHtml = '';
    ctaHtml = btnOrange(`Be the Circle Leader in ${memberCity}`, LEADER_OFFICE_APPLY_URL) +
      '<div style="height:14px;line-height:14px;font-size:1px;">&nbsp;</div>' + btnDark('Join as a participant', PARTICIPANT_REG_URL);
    preheader = `No Circle in ${memberCity} yet. Could you, or someone you know, lead one?`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>NFP Circles</title>
<style>
@media (prefers-color-scheme: dark){
  .bg-out{background:#14171A !important}
  .bg-card{background:#1E2225 !important}
  .bg-soft{background:#2A2F33 !important}
  .t-main{color:#F1EEE9 !important}
  .t-soft{color:#C3C9CE !important}
  .t-foot{color:#A5AEB5 !important}
  .t-accent{color:#FF7A33 !important}
  .btn-dark{background:#F1EEE9 !important}
  .btn-dark a{color:#1E2225 !important}
}
</style>
</head>
<body style="margin:0;padding:0;">
<div class="bg-out" style="margin:0;padding:24px 12px;background:#EFE7DC;color:#333333;font-family:${B};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">
<tr><td class="bg-card" style="background:#FFFFFF;border-radius:10px;overflow:hidden;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="padding:28px 36px 0 36px;"><img src="${LOGO_URL}" alt="Network FP" width="132" style="display:block;border:0;height:auto;width:132px;"></td></tr>
  <tr><td style="padding:36px 36px 0 36px;">
    <h1 class="t-main" style="margin:0;font-family:${H};font-weight:400;font-size:38px;line-height:1.14;letter-spacing:-0.5px;color:#333333;">${headlineA} <span class="t-accent" style="font-style:italic;color:#FF5000;">${headlineB}</span></h1>
  </td></tr>
  ${tagline ? `<tr><td style="padding:12px 36px 0 36px;">
    <p class="t-soft" style="margin:0;font-family:${H};font-style:italic;font-size:18px;line-height:1.5;color:#4A4A4A;">${tagline}</p>
  </td></tr>` : ''}
  <tr><td style="padding:28px 36px 0 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-soft" style="background:#EFE7DC;border-radius:10px;">
     <tr>
      <td width="50%" style="padding:20px 24px;vertical-align:top;">
        <div class="t-foot" style="${label}">Date</div>
        <div class="t-main" style="${value}">${dateFull}</div>
      </td>
      <td width="50%" style="padding:20px 24px;vertical-align:top;">
        <div class="t-foot" style="${label}">Time</div>
        <div class="t-main" style="${value}">${timeRange}</div>
      </td>
     </tr>
    </table>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <p class="t-main" style="${p(';margin-bottom:16px')}">Hi ${name},</p>
    ${introHtml}
  </td></tr>
  ${middleHtml}
  <tr><td style="padding:24px 36px 0 36px;">
    <p class="t-main" style="${p()}">NFP Circles are free to attend and built for peer learning, with no sales pitches. The main session is streamed to every Circle at once, then your group talks it through in person.</p>
  </td></tr>
  <tr><td style="padding:32px 36px 0 36px;">${ctaHtml}</td></tr>
  <tr><td style="padding:32px 36px 0 36px;">
    <p class="t-main" style="margin:0;font-family:${H};font-style:italic;font-size:18px;line-height:1.5;color:#333333;">Be Independent, but never alone.</p>
    <p class="t-soft" style="margin:6px 0 0 0;font-family:${B};font-size:15px;line-height:1.6;color:#4A4A4A;">Team NFP Circles</p>
  </td></tr>
  <tr><td style="padding:32px 36px 32px 36px;">
    <p class="t-foot" style="margin:0;font-family:${B};font-size:13px;line-height:1.7;color:#5A6B77;border-top:1px solid #E3DED6;padding-top:20px;">Questions? Write to <a href="mailto:circles@networkfp.com" class="t-foot" style="${footLink}">circles@networkfp.com</a>.<br>Network FP, <a href="https://www.networkfp.com" class="t-foot" style="${footLink}">www.networkfp.com</a><br><a href="${crmUnsubscribeUrl(contact.id)}" class="t-foot" style="${footLink}">Unsubscribe</a> if you would rather not get these emails.</p>
  </td></tr>
 </table>
</td></tr>
</table>
</div>
</body>
</html>`;
}

// Unlike send() above, this does NOT swallow errors — a campaign batch needs to
// know exactly which contacts genuinely failed (vs. sent) so it can record it on
// the recipient row and never silently claim "sent" for an email that wasn't.
async function sendCrmCampaignEmail(contact, hubs, campaign) {
  if (!transporter) {
    throw new Error('SMTP not configured — set SMTP_HOST/SMTP_USER/SMTP_PASS to send campaigns.');
  }
  if (campaign.template === 'leader-office' || campaign.template === 'leader-invite') {
    const html = campaign.template === 'leader-invite'
      ? await buildLeaderInviteEmailHtml(contact)
      : await buildLeaderOfficeEmailHtml(contact);
    await transporter.sendMail({ from: FROM, to: contact.email, subject: campaign.subject, html });
    return;
  }
  const html = campaign.template === 'circle-open'
    ? await buildCircleOpenEmailHtml(contact, hubs, campaign)
    : await buildCircleCrmEmailHtml(contact, hubs, campaign);
  await transporter.sendMail({ from: FROM, to: contact.email, subject: campaign.subject, html });
}

// ─── Edition Launch — Circle Leader / Participant recruitment ─────────────────
// Bold, poster-style wrapper distinct from wrap() above — built to match a
// specific outreach graphic/WhatsApp broadcast used to launch a new edition.
// Used only by the two recruitment emails below, not the transactional ones.

// First edition's real result, quoted as social proof in the recruitment copy.
// This is a fixed historical fact about one specific past edition — if a future
// edition's launch email should instead cite its own prior edition's turnout,
// this line needs updating by hand, it won't update itself.
const FIRST_EDITION_RESULT = 'Our first NFP Circle on 5th Aug was a huge hit — 700+ people took part across cities (100 Circle Leaders and 630+ participants).';

function recruitmentWrap({ badgeLabel, headline, tagline, dateLine, timeLine, ctaLabel, ctaUrl, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #F3EDE3; font-family: Arial, sans-serif; color: #222222; }
    .container { max-width: 600px; margin: 40px auto; background: #FFFFFF; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
    .header { padding: 28px 32px 8px; text-align: right; }
    .header img { width: 160px; height: auto; display: inline-block; }
    .hero { padding: 8px 32px 28px; }
    .badge { display: inline-block; background: #FF5000; color: #FFFFFF; border-radius: 20px; padding: 7px 18px; font-size: 13px; font-weight: bold; letter-spacing: 0.2px; margin-bottom: 18px; }
    .headline { font-family: Arial Black, Arial, sans-serif; font-size: 34px; line-height: 1.12; font-weight: 900; color: #1A1A1A; margin: 0 0 14px; }
    .tagline { font-size: 16px; font-style: italic; color: #4A4A4A; margin: 0 0 20px; line-height: 1.5; }
    .when-row { font-size: 15px; color: #1A1A1A; margin: 0 0 24px; }
    .when-row span { display: inline-block; margin-right: 18px; }
    .body p { margin: 0 0 14px; font-size: 15px; line-height: 1.65; color: #333333; }
    .body strong { color: #1A1A1A; }
    .cta-wrap { text-align: left; margin: 26px 0 8px; }
    .cta { display: inline-block; background: #1A1A1A; color: #FFFFFF !important; text-decoration: none; padding: 16px 26px; border-radius: 10px; font-size: 14px; font-weight: bold; letter-spacing: 0.4px; text-transform: uppercase; }
    .cta .arrow { display: inline-block; background: #FF5000; color: #FFFFFF; border-radius: 50%; width: 22px; height: 22px; text-align: center; line-height: 22px; margin-left: 10px; font-size: 13px; }
    .experience { background: #F3EDE3; border-radius: 10px; padding: 24px 28px; margin: 28px 32px; }
    .experience .badge { margin-bottom: 14px; }
    .experience ul { list-style: none; margin: 0; padding: 0; }
    .experience li { font-size: 15px; font-weight: bold; color: #1A1A1A; padding: 9px 0; border-bottom: 1px dotted #D8CFBC; }
    .experience li:last-child { border-bottom: none; }
    .footer { padding: 20px 32px 28px; text-align: center; font-size: 12px; color: #6A7D8B; }
    .footer a { color: #FF5000; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="cid:nfp-recruit-logo" alt="Network FP" width="160" height="auto" />
    </div>
    <div class="hero">
      <div class="badge">${badgeLabel}</div>
      <h1 class="headline">${headline}</h1>
      ${tagline ? `<p class="tagline">${tagline}</p>` : ''}
      <p class="when-row"><span>📅 ${dateLine}</span><span>🕐 ${timeLine}</span></p>
      <div class="body">${bodyHtml}</div>
      <div class="cta-wrap">
        <a class="cta" href="${ctaUrl}">${ctaLabel}<span class="arrow">→</span></a>
      </div>
    </div>
    <div class="experience">
      <div class="badge">Your NFP Circle Experience</div>
      <ul>
        <li>1️⃣ Build Your Team</li>
        <li>2️⃣ Learn from Peers</li>
        <li>3️⃣ Vote Live</li>
        <li>4️⃣ Ask Anything</li>
        <li>5️⃣ Keynote Address</li>
      </ul>
    </div>
    <div class="footer">
      Network FP &nbsp;|&nbsp; <a href="https://www.networkfp.com">www.networkfp.com</a><br/>
      This is an automated message — please do not reply to this email.
    </div>
  </div>
</body>
</html>`;
}

// ─── Circle Leader Recruitment ─────────────────────────────────────────────
// Sent to NFP ProMembers to recruit them as hosts for a new edition — content
// matches the "Inviting NFP ProMembers to Lead Circles" WhatsApp broadcast.

async function buildCircleLeaderRecruitmentHtml(contact, edition) {
  const info = await getEditionInfo(edition);
  const dateLine = info.date ? info.date.full : 'Date to be announced';
  const timeLine = (info.timeStart && info.timeEnd) ? `${info.timeStart} to ${info.timeEnd}` : 'Time to be announced';
  const themeTitle = info.themeTitle || 'NFP Circles';

  const bodyHtml = `
    <p>Dear ${contact.full_name || 'Member'},</p>
    <p>${FIRST_EDITION_RESULT}</p>
    <p>We're back with the next edition — theme <strong>${themeTitle}</strong> — and inviting Members across the country to host a Circle and make a difference in their city.</p>
    <p>If you're an office owner with a space that can host <strong>4+ members</strong>, and you'd like to bring your city's NFP community together, we'd love to have you lead a Circle.</p>
    <p>Circle Leader registrations are now open. Participant registrations will open soon after.</p>
    <p>Be Independent, but never alone 🙌</p>
  `;

  return recruitmentWrap({
    badgeLabel: `NFP Circles | ${themeTitle}`,
    headline: themeTitle,
    tagline: info.themeTagline,
    dateLine,
    timeLine,
    ctaLabel: 'Apply to be a Circle Leader',
    ctaUrl: CIRCLE_LEADERS_REG_URL,
    bodyHtml,
  });
}

async function sendCircleLeaderRecruitment(contact, edition) {
  const html = await buildCircleLeaderRecruitmentHtml(contact, edition);
  const info = await getEditionInfo(edition);
  const dateShort = info.date ? info.date.short : 'soon';
  await send({
    to: contact.email,
    subject: `⭕ NFP Circle on ${dateShort} — Do you have a space to host peers?`,
    html,
    attachments: recruitLogoBuffer
      ? [{ filename: 'NFP-Logo.png', content: recruitLogoBuffer, cid: 'nfp-recruit-logo' }]
      : undefined,
  });
}

// ─── Participant Recruitment ───────────────────────────────────────────────
// Companion to the Circle Leader recruitment email above — same launch, same
// visual language, but inviting Members to register as attendees once Circle
// Leader applications (above) have opened up circles in their city.

async function buildParticipantRecruitmentHtml(contact, edition) {
  const info = await getEditionInfo(edition);
  const dateLine = info.date ? info.date.full : 'Date to be announced';
  const timeLine = (info.timeStart && info.timeEnd) ? `${info.timeStart} to ${info.timeEnd}` : 'Time to be announced';
  const themeTitle = info.themeTitle || 'NFP Circles';

  const bodyHtml = `
    <p>Dear ${contact.full_name || 'Member'},</p>
    <p>${FIRST_EDITION_RESULT}</p>
    <p>We're back with the next edition — theme <strong>${themeTitle}</strong> — and Circles are now open for registration in cities across India.</p>
    <p>NFP Circles are small, in-person peer-learning meetups built for NFP Members — a few hours to connect with peers in your city, discuss real challenges, and walk away with practical ideas you can use right away.</p>
    <p>They're free to attend, run by fellow NFP Members and QPFP Certificants, and built purely for peer learning — no sales pitches, no solicitation.</p>
    <p>Spots in each city are limited, so register early to secure yours.</p>
    <p>Be Independent, but never alone 🙌</p>
  `;

  return recruitmentWrap({
    badgeLabel: `NFP Circles | ${themeTitle}`,
    headline: themeTitle,
    tagline: info.themeTagline,
    dateLine,
    timeLine,
    ctaLabel: 'Register as a Participant',
    ctaUrl: PARTICIPANT_REG_URL,
    bodyHtml,
  });
}

async function sendParticipantRecruitment(contact, edition) {
  const html = await buildParticipantRecruitmentHtml(contact, edition);
  const info = await getEditionInfo(edition);
  const dateShort = info.date ? info.date.short : 'soon';
  await send({
    to: contact.email,
    subject: `⭕ NFP Circle on ${dateShort} — Join peers in your city`,
    html,
    attachments: recruitLogoBuffer
      ? [{ filename: 'NFP-Logo.png', content: recruitLogoBuffer, cid: 'nfp-recruit-logo' }]
      : undefined,
  });
}

module.exports = {
  sendHubApproved,
  sendHubCarriedToNextEdition,
  sendHubRejected,
  sendParticipantConfirmed,
  sendParticipantCancelled,
  sendHubRosterUpdate,
  sendHubDetailsUpdated,
  sendParticipantTransferred,
  sendParticipantEventReminder,
  sendParticipantCircleCombined,
  sendHubLeaderCircleMerged,
  sendHubLeaderCircleMergedSurvivor,
  sendParticipantCircleMergeReverted,
  sendHubLeaderCircleMergeReverted,
  buildCircleCrmEmailHtml,
  buildLeaderOfficeEmailHtml,
  buildLeaderInviteEmailHtml,
  buildCircleOpenEmailHtml,
  sendCrmCampaignEmail,
  crmUnsubscribeUrl,
  buildCircleLeaderRecruitmentHtml,
  sendCircleLeaderRecruitment,
  buildParticipantRecruitmentHtml,
  sendParticipantRecruitment,
};
