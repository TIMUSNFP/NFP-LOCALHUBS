/* poll-client.js — shared helpers for every live-poll frontend page. */
'use strict';

// Same-origin in production (this app is deployed as its own Vercel project
// with the API under the same domain, like the main NFP Circles site).
// Locally, the static files and the API run on different ports.
const API_BASE =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? `http://${location.hostname}:4100`
    : '';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function showToast(message, opts = {}) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), opts.duration || 3200);
}

// ── Per-session device identity, stored per join-code so a phone can join
// multiple different poll sessions over time without cross-contaminating. ──
function storageKey(code, suffix) {
  return `nfp-poll:${code}:${suffix}`;
}
function getDeviceToken(code) {
  return localStorage.getItem(storageKey(code, 'device'));
}
function setDeviceToken(code, token) {
  localStorage.setItem(storageKey(code, 'device'), token);
}
function getParticipant(code) {
  const raw = localStorage.getItem(storageKey(code, 'participant'));
  return raw ? JSON.parse(raw) : null;
}
function setParticipant(code, participant) {
  localStorage.setItem(storageKey(code, 'participant'), JSON.stringify(participant));
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* no body */
  }
  if (!res.ok) {
    const error = new Error((body && body.error) || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return body;
}

// Codes can be the auto-generated 6-digit default OR a custom alphanumeric
// code the host set (e.g. "NFPCIRCLE2026") — always normalized to uppercase
// letters/digits only, so "nfpcircle2026" and "NFPCIRCLE2026" are the same code.
function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
