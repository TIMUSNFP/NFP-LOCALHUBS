/* ══════════════════════════════════════════════════════
   NFP Circle Participants — standalone read-only site
   Pulls live from the main NFP Circles API (Supabase-backed),
   so admin approvals show up here immediately.
══════════════════════════════════════════════════════ */

'use strict';

// Cross-origin: this site is a separate Vercel project from the main
// NFP Circles app, so requests go to the main app's full domain.
// Update this if the main site's production domain changes.
const API_BASE = 'https://nfp-circles.vercel.app';

document.addEventListener('DOMContentLoaded', () => {
    loadParticipantsTable();
});

async function fetchPublicParticipants() {
    try {
        const res = await fetch(`${API_BASE}/api/participants/public`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

function participantStatusBadge(status) {
    if (status === 'Confirmed') {
        return '<span class="status-badge status-approved">Approved</span>';
    }
    return '<span class="status-badge status-pending">Awaiting Approval</span>';
}

function formatMembershipType(value) {
    return String(value || '').replace(/^Both\s+/i, '');
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function renderParticipantsTable(rows, emptyMessage) {
    const tbody = document.getElementById('participantsTableBody');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="ptable-msg">${escapeHtml(emptyMessage || 'No participants registered yet.')}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map((r, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(r.fullName)}</td>
            <td>${escapeHtml(r.city)}</td>
            <td>${escapeHtml(r.circleName)}</td>
            <td class="ptable-nowrap">${escapeHtml(formatMembershipType(r.membership))}</td>
            <td>${participantStatusBadge(r.status)}</td>
        </tr>
    `).join('');
}

let allParticipants = [];
let participantSort = { key: null, dir: 'asc' };
const PARTICIPANT_SORT_KEYS = ['srNo', 'fullName', 'city', 'circleName', 'membership', 'status'];

async function loadParticipantsTable() {
    const tbody = document.getElementById('participantsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="6" class="ptable-msg"><div class="spinner"></div><p>Loading participants...</p></td></tr>';
    }
    const rows = await fetchPublicParticipants();
    allParticipants = rows.map((r, i) => ({ ...r, _srNo: i + 1 }));
    populateParticipantFilterOptions(allParticipants);
    updateParticipantStats(allParticipants);
    applyParticipantsFilter();
}

function updateParticipantStats(rows) {
    const participantsEl = document.getElementById('statParticipants');
    const circlesEl = document.getElementById('statCircles');
    const citiesEl = document.getElementById('statCities');
    if (participantsEl) participantsEl.textContent = rows.length;
    if (circlesEl) circlesEl.textContent = new Set(rows.map(r => r.circleName).filter(Boolean)).size;
    if (citiesEl) citiesEl.textContent = new Set(rows.map(r => r.city).filter(Boolean)).size;
}

function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelectOptions(selectId, values, allLabel, labelFormatter) {
    const el = document.getElementById(selectId);
    if (!el) return;
    const current = el.value;
    const format = labelFormatter || (v => v);
    el.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
        values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(format(v))}</option>`).join('');
    if (values.includes(current)) el.value = current;
}

function populateParticipantFilterOptions(rows) {
    fillSelectOptions('filter-city', uniqueSorted(rows.map(r => r.city)), 'All Cities');
    fillSelectOptions('filter-membership', uniqueSorted(rows.map(r => r.membership)), 'All Types', formatMembershipType);
}

function sortParticipantsBy(key) {
    if (participantSort.key === key) {
        participantSort.dir = participantSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        participantSort.key = key;
        participantSort.dir = 'asc';
    }
    applyParticipantsFilter();
}

function updateParticipantSortArrows() {
    PARTICIPANT_SORT_KEYS.forEach(key => {
        const arrow = document.getElementById('arrow-' + key);
        if (!arrow) return;
        arrow.textContent = participantSort.key === key
            ? (participantSort.dir === 'asc' ? ' ▲' : ' ▼')
            : '';
    });
}

function applyParticipantsFilter() {
    const nameQuery = (document.getElementById('filter-fullName')?.value || '').trim().toLowerCase();
    const cityFilter = document.getElementById('filter-city')?.value || '';
    const circleQuery = (document.getElementById('filter-circleName')?.value || '').trim().toLowerCase();
    const membershipFilter = document.getElementById('filter-membership')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';

    let filtered = allParticipants.filter(r => {
        if (nameQuery && !String(r.fullName || '').toLowerCase().includes(nameQuery)) return false;
        if (cityFilter && r.city !== cityFilter) return false;
        if (circleQuery && !String(r.circleName || '').toLowerCase().includes(circleQuery)) return false;
        if (membershipFilter && r.membership !== membershipFilter) return false;
        if (statusFilter && r.status !== statusFilter) return false;
        return true;
    });

    if (participantSort.key) {
        const { key, dir } = participantSort;
        filtered = filtered.slice().sort((a, b) => {
            const av = key === 'srNo' ? a._srNo : String(a[key] || '').toLowerCase();
            const bv = key === 'srNo' ? b._srNo : String(b[key] || '').toLowerCase();
            if (av < bv) return dir === 'asc' ? -1 : 1;
            if (av > bv) return dir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    updateParticipantSortArrows();

    const emptyMessage = allParticipants.length
        ? 'No participants match your filters.'
        : 'No participants registered yet.';
    renderParticipantsTable(filtered, emptyMessage);
}
