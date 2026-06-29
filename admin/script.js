/* ══════════════════════════════════════════════════════
   NFP Circles — Admin Portal JavaScript
   Features: Backend-authenticated admin login, hub & participant
             management (approve/reject/cancel/reinstate), search/filter,
             CSV export, analytics, toasts, modals.
══════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════ API CONFIG ═══════════════════
// Empty string = same origin (pages + API share one domain on Vercel; no CORS).
// For local testing against the backend, set this to e.g. 'http://localhost:4000'.
const API_BASE  = '';
const TOKEN_KEY = 'nfp_admin_token';

// ═══════════════════ STATE ═══════════════════
let currentFilter   = 'all';
let currentPFilter   = 'all';
let pendingRegId     = null;
let allHubs          = [];
let allParticipants  = [];

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
    handleNavbarScroll();
    checkAdminSession();
    initTableScrollFade();
});

function handleNavbarScroll() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 20);
    });
}

// ═══════════════════ PAGE NAVIGATION ═══════════════════
function showSection(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (id === 'adminDashboard') {
        updateDashboard();
    }
}

// ═══════════════════ VALIDATION HELPERS ═══════════════════
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function setErr(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    const inputId = id.replace('Err', '');
    const input   = document.getElementById(inputId);
    if (input) input.classList.toggle('error', !!msg);
}

function clearErr(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
    const inputId = id.replace('Err', '');
    const input   = document.getElementById(inputId);
    if (input) input.classList.remove('error');
}

function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ═══════════════════ AUTH'D FETCH HELPER ═══════════════════
function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
}

async function adminFetch(url, options = {}) {
    const token = getToken();
    const headers = Object.assign({}, options.headers, {
        'Authorization': `Bearer ${token}`,
    });
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (res.status === 401) {
        sessionStorage.removeItem(TOKEN_KEY);
        showSection('adminLogin');
        showToast('Your session has expired. Please sign in again.', 'error');
        throw new Error('Unauthorized');
    }
    return res;
}

// ═══════════════════ ADMIN AUTH ═══════════════════
async function adminLogin() {
    const emailEl = document.getElementById('adminEmail');
    const passEl  = document.getElementById('adminPassword');
    const email   = emailEl.value.trim();
    const pass    = passEl.value;
    clearErr('adminEmailErr');
    clearErr('adminPasswordErr');
    let valid = true;
    if (!email) { setErr('adminEmailErr', 'Email is required.'); valid = false; }
    else if (!isValidEmail(email)) { setErr('adminEmailErr', 'Enter a valid email address.'); valid = false; }
    if (!pass) { setErr('adminPasswordErr', 'Password is required.'); valid = false; }
    if (!valid) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.token) {
            sessionStorage.setItem(TOKEN_KEY, data.token);
            showSection('adminDashboard');
            updateDashboard();
            showToast('Welcome back, Admin!', 'success');
        } else {
            setErr('adminPasswordErr', data.error || 'Incorrect email or password. Please try again.');
            passEl.value = '';
            passEl.focus();
            showToast('Login failed. Check your credentials.', 'error');
        }
    } catch (e) {
        showToast('Could not reach the server. Please try again later.', 'error');
    }
}

function adminLogout() {
    openConfirmModal(
        'Sign Out',
        'Are you sure you want to sign out of the admin portal?',
        '🚪',
        () => {
            sessionStorage.removeItem(TOKEN_KEY);
            closeConfirmModal();
            showSection('adminLogin');
            showToast('You have been signed out.', 'info');
        }
    );
}

function checkAdminSession() {
    if (getToken()) {
        showSection('adminDashboard');
    } else {
        showSection('adminLogin');
    }
}

function togglePassword() {
    const passEl = document.getElementById('adminPassword');
    passEl.type = passEl.type === 'password' ? 'text' : 'password';
}

// ═══════════════════ FORM OPEN/CLOSE SETTINGS ═══════════════════
let formSettings = { hubFormOpen: true, participantFormOpen: true };

async function loadSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (res.ok) { formSettings = await res.json(); renderFormToggles(); }
    } catch (e) { /* leave defaults */ }
}

function renderFormToggles() {
    const hb = document.getElementById('hubFormToggle');
    if (hb) {
        hb.innerHTML = formSettings.hubFormOpen
            ? '🟢 Applications Open — Close Form'
            : '🔴 Applications Closed — Open Form';
        hb.style.background = formSettings.hubFormOpen ? '' : '#DC2626';
        hb.style.color = formSettings.hubFormOpen ? '' : '#fff';
    }
    const pb = document.getElementById('participantFormToggle');
    if (pb) {
        pb.innerHTML = formSettings.participantFormOpen
            ? '🟢 Registrations Open — Close Form'
            : '🔴 Registrations Closed — Open Form';
        pb.style.background = formSettings.participantFormOpen ? '' : '#DC2626';
        pb.style.color = formSettings.participantFormOpen ? '' : '#fff';
    }
}

async function patchSettings(payload) {
    try {
        const res = await adminFetch(`${API_BASE}/api/admin/settings`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) { showToast('Could not update form status.', 'error'); return false; }
        formSettings = await res.json();
        renderFormToggles();
        return true;
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
        return false;
    }
}

function toggleHubForm() {
    const next = !formSettings.hubFormOpen;
    openConfirmModal(
        next ? 'Open Applications' : 'Close Applications',
        next
            ? 'Re-open the Hub Leader application form so people can apply again?'
            : 'Close the Hub Leader application form? New applications will be blocked until you re-open it.',
        next ? '🟢' : '🔴',
        async () => {
            closeConfirmModal();
            const ok = await patchSettings({ hubFormOpen: next });
            if (ok) showToast(next ? 'Hub Leader applications are now OPEN.' : 'Hub Leader applications are now CLOSED.', next ? 'success' : 'warning');
        },
        next ? 'Open Form' : 'Close Form',
        !next
    );
}

function toggleParticipantForm() {
    const next = !formSettings.participantFormOpen;
    openConfirmModal(
        next ? 'Open Registrations' : 'Close Registrations',
        next
            ? 'Re-open Circle registrations so members can join again?'
            : 'Close Circle registrations? Members will be able to browse Circles but not join until you re-open it.',
        next ? '🟢' : '🔴',
        async () => {
            closeConfirmModal();
            const ok = await patchSettings({ participantFormOpen: next });
            if (ok) showToast(next ? 'Circle registrations are now OPEN.' : 'Circle registrations are now CLOSED.', next ? 'success' : 'warning');
        },
        next ? 'Open Form' : 'Close Form',
        !next
    );
}

// ═══════════════════ DATA LOADING ═══════════════════
async function loadHubs() {
    try {
        const res = await adminFetch(`${API_BASE}/api/admin/hubs`);
        if (!res.ok) { showToast('Failed to load applications.', 'error'); return; }
        allHubs = await res.json();
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
    }
}

async function loadParticipants() {
    try {
        const res = await adminFetch(`${API_BASE}/api/admin/participants`);
        if (!res.ok) { showToast('Failed to load participants.', 'error'); return; }
        allParticipants = await res.json();
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
    }
}

// ═══════════════════ ADMIN DASHBOARD ═══════════════════
async function updateDashboard() {
    loadSettings();
    await loadHubs();
    updateStats();
    applyFilters();
    if (document.getElementById('tabAnalytics') && !document.getElementById('tabAnalytics').classList.contains('hidden')) {
        renderAnalytics();
    }
    await loadParticipants();
    updateParticipantStats();
    applyParticipantFilters();
}

function updateStats() {
    const total    = allHubs.length;
    const pending  = allHubs.filter(r => r.status === 'Pending').length;
    const approved = allHubs.filter(r => r.status === 'Approved').length;
    const rejected = allHubs.filter(r => r.status === 'Rejected').length;
    animateCount('statTotal',    total);
    animateCount('statPending',  pending);
    animateCount('statApproved', approved);
    animateCount('statRejected', rejected);
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start    = parseInt(el.textContent) || 0;
    const duration = 600;
    const step     = Math.ceil(Math.abs(target - start) / (duration / 16));
    let current = start;
    const timer = setInterval(() => {
        current += (target > start ? step : -step);
        if ((target > start && current >= target) || (target <= start && current <= target)) {
            current = target;
            clearInterval(timer);
        }
        el.textContent = current;
    }, 16);
}

// ═══════════════════ ADMIN TAB SWITCHING ═══════════════════
async function showAdminTab(tab, linkEl) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
    const targetTab = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (targetTab) targetTab.classList.remove('hidden');
    if (linkEl) linkEl.classList.add('active');
    const title = document.getElementById('adminPageTitle');
    const titleMap = { applications: 'Applications', analytics: 'Analytics', participants: 'Participant Registrations' };
    if (title) title.textContent = titleMap[tab] || (tab.charAt(0).toUpperCase() + tab.slice(1));
    // Refetch fresh data every time a tab is opened — data can change from another
    // browser/site (hub approvals, new participant signups) while this tab sits idle.
    if (tab === 'applications') {
        await loadHubs();
        updateStats();
        applyFilters();
    }
    if (tab === 'analytics') {
        await loadHubs();
        renderAnalytics();
    }
    if (tab === 'participants') {
        await loadParticipants();
        updateParticipantStats();
        applyParticipantFilters();
    }
    closeSidebar();
}

// ═══════════════════ TABLE RENDERING (HUBS) ═══════════════════
function applyFilters() {
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const clear  = document.getElementById('searchClear');
    if (clear) clear.classList.toggle('visible', search.length > 0);
    let regs = [...allHubs];
    if (currentFilter !== 'all') regs = regs.filter(r => r.status === currentFilter);
    if (search) {
        regs = regs.filter(r =>
            (r.fullName || '').toLowerCase().includes(search) ||
            (r.email || '').toLowerCase().includes(search) ||
            (r.city || '').toLowerCase().includes(search) ||
            String(r.id || '').toLowerCase().includes(search)
        );
    }
    renderTable(regs);
}

function setFilter(filter, btn) {
    currentFilter = filter;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyFilters();
}

function clearSearch() {
    const el = document.getElementById('searchInput');
    if (el) { el.value = ''; el.focus(); }
    const clear = document.getElementById('searchClear');
    if (clear) clear.classList.remove('visible');
    applyFilters();
}

function renderTable(regs) {
    const tbody   = document.getElementById('tableBody');
    const emptyEl = document.getElementById('tableEmpty');
    if (!tbody) return;
    if (!regs || regs.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.add('visible');
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    tbody.innerHTML = regs.map(r => `
        <tr data-id="${escHtml(r.id)}">
            <td class="td-id" style="min-width:180px">${escHtml(r.id)}</td>
            <td class="td-name" style="min-width:140px"><button class="name-link" onclick="viewHubParticipants('${escHtml(r.id)}')">${escHtml(r.fullName)}</button></td>
            <td class="td-email" style="min-width:180px">${escHtml(r.email)}</td>
            <td>${escHtml(r.mobile)}</td>
            <td>${escHtml(r.membership)}</td>
            <td>${escHtml(r.city)}</td>
            <td>${escHtml(r.area)}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;font-size:12px" title="${escHtml(r.address || '')}">${escHtml(r.address || '—')}</td>
            <td>${escHtml(r.venueType)}</td>
            <td>${escHtml(r.capacity)}</td>
            <td>${r.hostedBefore === 'Yes' ? '✅ Yes' : '❌ No'}</td>
            <td>${escHtml(r.hostingFrequency || '—')}</td>
            <td>${formatDate(r.submittedAt)}</td>
            <td>${statusBadge(r.status)}</td>
            <td>
                <div class="action-btns">
                    ${r.status !== 'Approved'
                        ? `<button class="act-btn act-approve" onclick="confirmApprove('${escHtml(r.id)}')">Approve</button>`
                        : ''}
                    ${r.status !== 'Rejected'
                        ? `<button class="act-btn act-reject" onclick="confirmReject('${escHtml(r.id)}')">Reject</button>`
                        : ''}
                    <button class="act-btn act-view" onclick="viewDetails('${escHtml(r.id)}')">View</button>
                </div>
            </td>
        </tr>
    `).join('');
    setTimeout(refreshScrollFade, 50);
}

function statusBadge(status) {
    const map = {
        'Pending':  'badge-pending',
        'Approved': 'badge-approved',
        'Rejected': 'badge-rejected',
    };
    return `<span class="badge ${map[status] || 'badge-pending'}">${status}</span>`;
}

// ═══════════════════ ADMIN ACTIONS (HUBS) ═══════════════════
function confirmApprove(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    pendingRegId  = id;
    openConfirmModal(
        'Approve Application',
        `Approve the application from <strong>${escHtml(reg.fullName)}</strong> (${escHtml(reg.city)})? This will grant them Circle Host status.`,
        '✅',
        executeApprove,
        'Approve'
    );
}

function confirmReject(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    pendingRegId  = id;
    openConfirmModal(
        'Reject Application',
        `Reject the application from <strong>${escHtml(reg.fullName)}</strong>? This action can be reversed later.`,
        '❌',
        executeReject,
        'Reject',
        true
    );
}

async function updateHubStatus(id, status) {
    try {
        const res = await adminFetch(`${API_BASE}/api/admin/hubs/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        return res.ok;
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
        return false;
    }
}

async function executeApprove() {
    if (!pendingRegId) return;
    const ok = await updateHubStatus(pendingRegId, 'Approved');
    if (ok) {
        showToast('Application approved successfully!', 'success');
        await updateDashboard();
    } else {
        showToast('Failed to approve application.', 'error');
    }
    closeConfirmModal();
    pendingRegId = null;
}

async function executeReject() {
    if (!pendingRegId) return;
    const ok = await updateHubStatus(pendingRegId, 'Rejected');
    if (ok) {
        showToast('Application has been rejected.', 'warning');
        await updateDashboard();
    } else {
        showToast('Failed to reject application.', 'error');
    }
    closeConfirmModal();
    pendingRegId = null;
}

function viewDetails(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    const titleEl = document.getElementById('detailsTitle');
    if (titleEl) titleEl.textContent = 'Application Details';
    const content = document.getElementById('detailsContent');
    content.innerHTML = `
        <div class="detail-section">
            <h4>Application Info</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <label>Registration ID</label>
                    <span style="color:var(--primary);font-family:monospace">${escHtml(reg.id)}</span>
                </div>
                <div class="detail-item">
                    <label>Status</label>
                    <span>${statusBadge(reg.status)}</span>
                </div>
                <div class="detail-item">
                    <label>Submission Date</label>
                    <span>${formatDate(reg.submittedAt)}</span>
                </div>
                ${reg.lastUpdated ? `<div class="detail-item"><label>Last Updated</label><span>${formatDate(reg.lastUpdated)}</span></div>` : ''}
            </div>
        </div>
        <div class="detail-section">
            <h4>Personal Details</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <label>Full Name</label>
                    <span>${escHtml(reg.fullName)}</span>
                </div>
                <div class="detail-item">
                    <label>Email</label>
                    <span>${escHtml(reg.email)}</span>
                </div>
                <div class="detail-item">
                    <label>Mobile</label>
                    <span>${escHtml(reg.mobile)}</span>
                </div>
                <div class="detail-item">
                    <label>Membership Type</label>
                    <span>${escHtml(reg.membership)}</span>
                </div>
            </div>
        </div>
        <div class="detail-section">
            <h4>Circle / Venue Details</h4>
            <div class="detail-grid">
                <div class="detail-item">
                    <label>City</label>
                    <span>${escHtml(reg.city)}</span>
                </div>
                <div class="detail-item">
                    <label>Area / Locality</label>
                    <span>${escHtml(reg.area)}</span>
                </div>
                <div class="detail-item">
                    <label>PIN Code</label>
                    <span>${escHtml(reg.pincode)}</span>
                </div>
                <div class="detail-item">
                    <label>Full Address</label>
                    <span>${escHtml(reg.address || '—')}</span>
                </div>
                <div class="detail-item">
                    <label>Venue Type</label>
                    <span>${escHtml(reg.venueType)}</span>
                </div>
                <div class="detail-item">
                    <label>Hosting Capacity</label>
                    <span>${escHtml(reg.capacity)}</span>
                </div>
                <div class="detail-item">
                    <label>Hosted NFP Event Before?</label>
                    <span>${escHtml(reg.hostedBefore)}</span>
                </div>
                <div class="detail-item">
                    <label>Willing to Host NFP Circle</label>
                    <span>${escHtml(reg.hostingFrequency || '—')}</span>
                </div>
                <div class="detail-item">
                    <label>Circle POC</label>
                    <span>${reg.pocRole === 'assign' ? 'Will assign someone else' : 'Self'}</span>
                </div>
            </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
            ${reg.status !== 'Approved'
                ? `<button class="btn-primary" style="background:var(--success)" onclick="closeDetailsModal();confirmApprove('${escHtml(reg.id)}')">✅ Approve</button>`
                : ''}
            ${reg.status !== 'Rejected'
                ? `<button class="btn-primary" style="background:var(--danger)" onclick="closeDetailsModal();confirmReject('${escHtml(reg.id)}')">❌ Reject</button>`
                : ''}
        </div>
    `;
    document.getElementById('detailsOverlay').classList.add('visible');
}

// ═══════════════════ CONFIRM MODAL ═══════════════════
let _modalCallback = null;

function openConfirmModal(title, message, emoji, callback, confirmText = 'Confirm', isDanger = false) {
    _modalCallback = callback;
    document.getElementById('modalEmoji').textContent    = emoji;
    document.getElementById('modalTitle').textContent    = title;
    document.getElementById('modalMessage').innerHTML    = message;
    const btn = document.getElementById('modalConfirmBtn');
    btn.textContent = confirmText;
    btn.style.background = isDanger ? 'var(--danger)' : '';
    btn.style.boxShadow  = isDanger ? '0 4px 14px rgba(220,38,38,.3)' : '';
    document.getElementById('confirmOverlay').classList.add('visible');
}

function executeModalAction() {
    if (_modalCallback) { _modalCallback(); _modalCallback = null; }
    else closeConfirmModal();
}

function closeConfirmModal() {
    document.getElementById('confirmOverlay').classList.remove('visible');
    _modalCallback = null;
}

function closeDetailsModal() {
    document.getElementById('detailsOverlay').classList.remove('visible');
}

// Close modals on overlay click
document.addEventListener('click', e => {
    if (e.target.id === 'confirmOverlay') closeConfirmModal();
    if (e.target.id === 'detailsOverlay') closeDetailsModal();
});

// Keyboard ESC to close
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeConfirmModal(); closeDetailsModal(); }
});

// ═══════════════════ CSV EXPORT (HUBS) ═══════════════════
function exportCSV() {
    const regs = allHubs;
    if (!regs.length) { showToast('No data to export.', 'warning'); return; }
    const headers = [
        'Registration ID','Full Name','Email','Mobile','Membership Type',
        'City','Area','Full Address','PIN Code','Venue Type','Capacity',
        'Hosted Before','Hosting Frequency','Submission Date','Status'
    ];
    const rows = regs.map(r => [
        r.id, r.fullName, r.email, r.mobile, r.membership,
        r.city, r.area, r.address || '', r.pincode, r.venueType, r.capacity,
        r.hostedBefore, r.hostingFrequency || '—', formatDate(r.submittedAt), r.status
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv     = [headers.join(','), ...rows].join('\n');
    const blob    = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url     = URL.createObjectURL(blob);
    const link    = document.createElement('a');
    const ts      = new Date().toISOString().slice(0, 10);
    link.href     = url;
    link.download = `NFP_CircleHost_Applications_${ts}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${regs.length} records to CSV.`, 'success');
}

// ═══════════════════ ANALYTICS ═══════════════════
function renderAnalytics() {
    const regs = allHubs;
    if (!regs.length) return;
    renderDonut(regs);
    renderCityBars(regs);
    renderMemberBars(regs);
    renderVenueBars(regs);
}

function renderDonut(regs) {
    const pending  = regs.filter(r => r.status === 'Pending').length;
    const approved = regs.filter(r => r.status === 'Approved').length;
    const rejected = regs.filter(r => r.status === 'Rejected').length;
    const total    = regs.length;
    const colors   = { Pending: '#D97706', Approved: '#16A34A', Rejected: '#DC2626' };
    const data     = [
        { label: 'Pending',  val: pending,  pct: total ? Math.round(pending/total*100)  : 0 },
        { label: 'Approved', val: approved, pct: total ? Math.round(approved/total*100) : 0 },
        { label: 'Rejected', val: rejected, pct: total ? Math.round(rejected/total*100) : 0 },
    ];
    let conicParts = [];
    let acc = 0;
    data.forEach(d => {
        if (d.val > 0) {
            const deg = (d.val / total) * 360;
            conicParts.push(`${colors[d.label]} ${acc}deg ${acc + deg}deg`);
            acc += deg;
        }
    });
    const donutEl = document.getElementById('donutChart');
    if (donutEl) {
        donutEl.innerHTML = `
            <div style="
                width:160px;height:160px;border-radius:50%;
                background:conic-gradient(${conicParts.join(',')});
                position:relative;
            ">
                <div style="
                    position:absolute;inset:30px;border-radius:50%;
                    background:var(--white);display:flex;flex-direction:column;
                    align-items:center;justify-content:center;
                ">
                    <strong style="font-size:24px;color:var(--dark)">${total}</strong>
                    <span style="font-size:11px;color:var(--muted)">Total</span>
                </div>
            </div>
        `;
    }
    const legendEl = document.getElementById('chartLegend');
    if (legendEl) {
        legendEl.innerHTML = data.map(d => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${colors[d.label]}"></span>
                <span class="legend-label">${d.label}</span>
                <span class="legend-val">${d.val} (${d.pct}%)</span>
            </div>
        `).join('');
    }
}

function renderBarSet(containerId, counts, color = 'var(--primary)') {
    const el = document.getElementById(containerId);
    if (!el) return;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max    = sorted[0]?.[1] || 1;
    el.innerHTML = sorted.map(([label, val]) => `
        <div class="bar-row">
            <div class="bar-label-row">
                <span>${escHtml(label)}</span>
                <strong>${val}</strong>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width:${Math.round(val/max*100)}%;background:${color}"></div>
            </div>
        </div>
    `).join('');
}

function renderCityBars(regs) {
    const counts = {};
    regs.forEach(r => { counts[r.city] = (counts[r.city] || 0) + 1; });
    renderBarSet('cityBars', counts);
}

function renderMemberBars(regs) {
    const counts = {};
    regs.forEach(r => { counts[r.membership] = (counts[r.membership] || 0) + 1; });
    renderBarSet('memberBars', counts, '#2563EB');
}

function renderVenueBars(regs) {
    const counts = {};
    regs.forEach(r => { counts[r.venueType] = (counts[r.venueType] || 0) + 1; });
    renderBarSet('venueBars', counts, '#16A34A');
}

// ═══════════════════ TOAST NOTIFICATIONS ═══════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span class="toast-text">${escHtml(message)}</span>`;
    container.appendChild(toast);
    const duration = type === 'error' ? 5000 : 3500;
    setTimeout(() => {
        toast.classList.add('out');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, duration);
}

// ═══════════════════ SIDEBAR TOGGLE ═══════════════════
function toggleSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('sidebarOverlay');
    const isOpen   = sidebar.classList.contains('open');
    sidebar.classList.toggle('open', !isOpen);
    overlay.classList.toggle('visible', !isOpen);
}

function closeSidebar() {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('visible');
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN — PARTICIPANT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function updateParticipantStats() {
    const parts     = allParticipants;
    const total     = parts.length;
    const confirmed = parts.filter(p => p.status === 'Confirmed').length;
    const cancelled = parts.filter(p => p.status === 'Cancelled').length;
    const hubs      = new Set(parts.map(p => p.hubId)).size;

    animateCount('pStatTotal',     total);
    animateCount('pStatConfirmed', confirmed);
    animateCount('pStatCancelled', cancelled);
    animateCount('pStatHubs',      hubs);
}

function applyParticipantFilters() {
    const q     = (document.getElementById('pSearchInput')?.value || '').toLowerCase().trim();
    const clear = document.getElementById('pSearchClear');
    if (clear) clear.classList.toggle('visible', q.length > 0);

    let parts = [...allParticipants];
    if (currentPFilter !== 'all') parts = parts.filter(p => p.status === currentPFilter);
    if (q) parts = parts.filter(p =>
        (p.fullName || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.hubCity || '').toLowerCase().includes(q) ||
        (p.hubLeader || '').toLowerCase().includes(q)
    );
    renderParticipantTable(parts);
}

function setPFilter(filter, btn) {
    currentPFilter = filter;
    document.querySelectorAll('[data-pfilter]').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    applyParticipantFilters();
}

function clearParticipantSearch() {
    const el = document.getElementById('pSearchInput');
    if (el) { el.value = ''; el.focus(); }
    document.getElementById('pSearchClear')?.classList.remove('visible');
    applyParticipantFilters();
}

function renderParticipantTable(parts) {
    const tbody   = document.getElementById('pTableBody');
    const emptyEl = document.getElementById('pTableEmpty');
    if (!tbody) return;

    if (!parts || parts.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.add('visible');
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');

    tbody.innerHTML = parts.map(p => `
        <tr>
            <td class="td-id" style="min-width:200px">${escHtml(p.id)}</td>
            <td class="td-name"><button class="name-link" onclick="viewParticipantDetails('${escHtml(p.id)}')">${escHtml(p.fullName)}</button></td>
            <td class="td-email">${escHtml(p.email)}</td>
            <td>${escHtml(p.mobile)}</td>
            <td>${escHtml(p.membership)}</td>
            <td class="td-name">${escHtml(p.hubLeader)}'s Circle</td>
            <td>${escHtml(p.hubCity)}</td>
            <td>${escHtml(p.hubArea)}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--muted)" title="${escHtml(p.note || '')}">${escHtml(p.note || '—')}</td>
            <td>${formatDate(p.registeredAt)}</td>
            <td>${participantStatusBadge(p.status)}</td>
            <td>
                <div class="action-btns">
                    ${p.status !== 'Cancelled'
                        ? `<button class="act-btn act-reject" onclick="cancelParticipant('${escHtml(p.id)}')">Cancel</button>`
                        : `<button class="act-btn act-approve" onclick="reinstateParticipant('${escHtml(p.id)}')">Reinstate</button>`
                    }
                    <button class="act-btn act-view" onclick="viewParticipantDetails('${escHtml(p.id)}')">View</button>
                    <button class="act-btn act-delete" onclick="deleteParticipant('${escHtml(p.id)}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
    setTimeout(refreshScrollFade, 50);
}

function participantStatusBadge(status) {
    const m = { 'Confirmed': 'badge-approved', 'Cancelled': 'badge-rejected' };
    return `<span class="badge ${m[status] || 'badge-pending'}">${status}</span>`;
}

async function updateParticipantStatus(id, status) {
    try {
        const res = await adminFetch(`${API_BASE}/api/admin/participants/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        return res.ok;
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
        return false;
    }
}

function cancelParticipant(id) {
    openConfirmModal(
        'Cancel Registration',
        'Are you sure you want to cancel this participant registration?',
        '❌',
        async () => {
            const ok = await updateParticipantStatus(id, 'Cancelled');
            if (ok) {
                showToast('Registration cancelled.', 'warning');
                await loadParticipants();
                updateParticipantStats();
                applyParticipantFilters();
            } else {
                showToast('Failed to cancel registration.', 'error');
            }
            closeConfirmModal();
        },
        'Cancel Registration',
        true
    );
}

async function reinstateParticipant(id) {
    const ok = await updateParticipantStatus(id, 'Confirmed');
    if (ok) {
        showToast('Participant reinstated.', 'success');
        await loadParticipants();
        updateParticipantStats();
        applyParticipantFilters();
    } else {
        showToast('Failed to reinstate participant.', 'error');
    }
}

// Permanently delete a participant — frees up their email/mobile so they can
// register again (e.g. for a different Circle).
function deleteParticipant(id) {
    openConfirmModal(
        'Delete Participant',
        'Permanently delete this registration? This frees up their email and mobile so they can register again (e.g. for a different Circle). This cannot be undone.',
        '🗑️',
        async () => {
            try {
                const res = await adminFetch(`${API_BASE}/api/admin/participants/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    showToast('Participant deleted.', 'success');
                    await loadParticipants();
                    updateParticipantStats();
                    applyParticipantFilters();
                } else {
                    showToast('Failed to delete participant.', 'error');
                }
            } catch (e) {
                if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
            }
            closeConfirmModal();
        },
        'Delete',
        true
    );
}

function viewHubParticipants(hubId) {
    const hub = allHubs.find(h => String(h.id) === String(hubId));
    if (!hub) return;
    const hubParticipants = allParticipants.filter(p => String(p.hubId) === String(hubId));

    const titleEl = document.getElementById('detailsTitle');
    if (titleEl) titleEl.textContent = `${hub.fullName}'s Circle — Participants`;

    const content = document.getElementById('detailsContent');
    const participantRows = hubParticipants.length === 0
        ? `<div style="text-align:center;padding:24px 0;color:var(--muted);font-size:14px">No participants registered for this circle yet.</div>`
        : hubParticipants.map(p => `
            <div onclick="viewParticipantFromHub('${escHtml(p.id)}')" style="cursor:pointer;padding:14px 16px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;display:flex;align-items:center;gap:14px;transition:background .15s" onmouseover="this.style.background='var(--light)'" onmouseout="this.style.background=''">
                <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0">${escHtml(p.fullName.charAt(0).toUpperCase())}</div>
                <div style="flex:1;min-width:0">
                    <div style="font-weight:600;color:var(--dark);margin-bottom:2px">${escHtml(p.fullName)}</div>
                    <div style="font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.email)} &middot; ${escHtml(p.mobile)}</div>
                    <div style="font-size:12px;color:var(--muted);margin-top:1px">${escHtml(p.membership)}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                    ${participantStatusBadge(p.status)}
                    <span style="font-size:11px;color:var(--muted)">${formatDate(p.registeredAt)}</span>
                </div>
            </div>
        `).join('');

    content.innerHTML = `
        <div class="detail-section">
            <h4>Circle Info</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Circle Host</label><span>${escHtml(hub.fullName)}</span></div>
                <div class="detail-item"><label>City</label><span>${escHtml(hub.city)}</span></div>
                <div class="detail-item"><label>Area</label><span>${escHtml(hub.area)}</span></div>
                <div class="detail-item"><label>Status</label><span>${statusBadge(hub.status)}</span></div>
            </div>
        </div>
        <div class="detail-section">
            <h4>Participants <span style="background:var(--primary);color:#fff;border-radius:20px;padding:1px 10px;font-size:13px;font-weight:600;margin-left:6px;vertical-align:middle">${hubParticipants.length}</span></h4>
            ${participantRows}
        </div>
    `;
    document.getElementById('detailsOverlay').classList.add('visible');
}

function viewParticipantFromHub(id) {
    closeDetailsModal();
    setTimeout(() => viewParticipantDetails(id), 120);
}

function viewParticipantDetails(id) {
    const p = allParticipants.find(p => String(p.id) === String(id));
    if (!p) return;
    const titleEl = document.getElementById('detailsTitle');
    if (titleEl) titleEl.textContent = 'Participant Details';
    const content = document.getElementById('detailsContent');
    content.innerHTML = `
        <div class="detail-section">
            <h4>Participant Info</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Participant ID</label><span style="color:var(--primary);font-family:monospace">${escHtml(p.id)}</span></div>
                <div class="detail-item"><label>Status</label><span>${participantStatusBadge(p.status)}</span></div>
                <div class="detail-item"><label>Registration Date</label><span>${formatDate(p.registeredAt)}</span></div>
                <div class="detail-item"><label>Membership</label><span>${escHtml(p.membership)}</span></div>
            </div>
        </div>
        <div class="detail-section">
            <h4>Personal Details</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Full Name</label><span>${escHtml(p.fullName)}</span></div>
                <div class="detail-item"><label>Email</label><span>${escHtml(p.email)}</span></div>
                <div class="detail-item"><label>Mobile</label><span>${escHtml(p.mobile)}</span></div>
            </div>
        </div>
        <div class="detail-section">
            <h4>Circle Details</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Circle Host</label><span>${escHtml(p.hubLeader)}</span></div>
                <div class="detail-item"><label>City</label><span>${escHtml(p.hubCity)}</span></div>
                <div class="detail-item"><label>Area</label><span>${escHtml(p.hubArea)}</span></div>
                <div class="detail-item"><label>Venue Type</label><span>${escHtml(p.hubVenue || '—')}</span></div>
            </div>
        </div>
        ${p.note ? `<div class="detail-section"><h4>Note from Participant</h4><p style="font-size:14px;color:var(--text);line-height:1.65">"${escHtml(p.note)}"</p></div>` : ''}
    `;
    document.getElementById('detailsOverlay').classList.add('visible');
}

function exportParticipantsCSV() {
    const parts = allParticipants;
    if (!parts.length) { showToast('No participant data to export.', 'warning'); return; }
    const headers = ['Participant ID','Full Name','Email','Mobile','Membership','Circle Host','Circle City','Circle Area','Circle Venue','Note','Registration Date','Status'];
    const rows = parts.map(p => [
        p.id, p.fullName, p.email, p.mobile, p.membership,
        p.hubLeader, p.hubCity, p.hubArea, p.hubVenue || '',
        p.note || '', formatDate(p.registeredAt), p.status
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `NFP_Participants_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${parts.length} participant records.`, 'success');
}

// ═══════════════════════════════════════════════════════════════
//  GOOGLE SHEETS SYNC
// ═══════════════════════════════════════════════════════════════

async function syncToSheets(type) {
    const btnId = type === 'hubs' ? 'syncHubsBtn' : 'syncParticipantsBtn';
    const btn = document.getElementById(btnId);
    const label = type === 'hubs' ? 'Hub Leaders' : 'Participants';
    const original = btn ? btn.innerHTML : '';

    if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

    try {
        const res = await adminFetch(`${API_BASE}/api/admin/sync-sheets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast(`${label} synced — ${data.count} rows sent to Google Sheets.`, 'success');
        } else {
            showToast(data.error || `Failed to sync ${label}.`, 'error');
        }
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
}

// ═══════════════════════════════════════════════════════════════
//  TABLE HORIZONTAL SCROLL — FADE HINT
// ═══════════════════════════════════════════════════════════════
function initTableScrollFade() {
    const pairs = [
        { wrap: 'hubTableWrap',  outer: 'hubTableOuter'  },
        { wrap: 'partTableWrap', outer: 'partTableOuter' },
    ];
    pairs.forEach(({ wrap, outer }) => {
        const wrapEl  = document.getElementById(wrap);
        const outerEl = document.getElementById(outer);
        if (!wrapEl || !outerEl) return;
        const update = () => {
            const atEnd = wrapEl.scrollLeft + wrapEl.clientWidth >= wrapEl.scrollWidth - 4;
            outerEl.classList.toggle('at-end', atEnd);
        };
        wrapEl.addEventListener('scroll', update, { passive: true });
        setTimeout(update, 300);
    });
}

// Re-run fade check after table is re-rendered
function refreshScrollFade() {
    ['hubTableWrap', 'partTableWrap'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const outer = document.getElementById(id.replace('Wrap', 'Outer'));
        if (!outer) return;
        const atEnd = el.scrollWidth <= el.clientWidth + 4;
        outer.classList.toggle('at-end', atEnd);
    });
}
