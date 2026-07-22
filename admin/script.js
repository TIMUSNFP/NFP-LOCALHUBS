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
let trendMode        = 'day';
let trendModeP       = 'day'; // Registrations Over Time (Participants) — independent of the Applications toggle
let analyticsRangeDays = null; // null = All Time, otherwise 7/30/90 — global filter for the whole Analytics tab
let selectedHubIds   = new Set(); // bulk-select state for the Applications table
let pendingBulkAction = null;     // { ids, status } awaiting confirm-modal approval
let selectedParticipantIds = new Set(); // bulk-select state for the Participants table
let pendingBulkActionP     = null;      // { ids, status } awaiting confirm-modal approval

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
    handleNavbarScroll();
    checkAdminSession();
    initTableScrollFade();
    initHubColumnFilters();
    initParticipantColumnFilters();
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
    await Promise.all([loadHubs(), loadParticipants()]);
    updateStats();
    applyFilters();
    updateParticipantStats();
    applyParticipantFilters();
    if (document.getElementById('tabAnalytics') && !document.getElementById('tabAnalytics').classList.contains('hidden')) {
        renderAnalytics();
    }
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
        await Promise.all([loadHubs(), loadParticipants()]);
        renderAnalytics();
    }
    if (tab === 'participants') {
        await loadParticipants();
        updateParticipantStats();
        applyParticipantFilters();
    }
    closeSidebar();
}

// ═══════════════════ COLUMN FILTERS (HUBS, Excel-style) ═══════════════════
const HUB_FILTER_COLUMNS = [
    { key: 'id',               label: 'Reg. ID' },
    { key: 'fullName',         label: 'Full Name' },
    { key: 'mobile',           label: 'Mobile' },
    { key: 'email',            label: 'Email' },
    { key: 'membership',       label: 'Membership' },
    { key: 'city',             label: 'City' },
    { key: 'area',             label: 'Area' },
    { key: 'address',          label: 'Address' },
    { key: 'venueType',        label: 'Venue' },
    { key: 'capacity',         label: 'Capacity' },
    { key: 'hostedBefore',     label: 'Hosted Before' },
    { key: 'hostingFrequency', label: 'Hosting Frequency' },
    { key: 'submittedAt',      label: 'Date' },
    { key: 'status',           label: 'Status' },
];

let hubColumnFilters = {}; // colKey -> Set of allowed values ("absent" key = no filter on that column)
let activeFilterCol  = null;

function initHubColumnFilters() {
    const row = document.getElementById('hubTableHeaderRow');
    if (!row) return;
    const ths = row.querySelectorAll('th');
    // ths[0] is the bulk-select checkbox column — filterable columns start at index 1.
    HUB_FILTER_COLUMNS.forEach((col, i) => {
        const th = ths[i + 1];
        if (!th) return;
        const label = th.textContent.trim();
        th.innerHTML = `<div class="th-inner"><span class="th-label">${label}</span><button type="button" class="col-filter-btn" data-col="${col.key}" onclick="toggleColumnFilter(event,'${col.key}')" title="Filter ${label}">&#9660;</button></div>`;
    });
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('colFilterPanel');
        if (!panel || panel.classList.contains('hidden')) return;
        if (panel.contains(e.target) || e.target.closest('.col-filter-btn')) return;
        closeColumnFilterPanel();
    });
    window.addEventListener('resize', closeColumnFilterPanel);
}

function getHubColumnValue(record, key) {
    if (key === 'submittedAt') return record.submittedAt ? formatDate(record.submittedAt) : '—';
    if (key === 'hostedBefore') return record.hostedBefore === 'Yes' ? 'Yes' : 'No';
    const v = record[key];
    return (v === null || v === undefined || String(v).trim() === '') ? '—' : String(v).trim();
}

function toggleColumnFilter(evt, colKey) {
    evt.stopPropagation();
    if (activeFilterCol === colKey) { closeColumnFilterPanel(); return; }
    openColumnFilterPanel(evt.currentTarget, colKey);
}

function openColumnFilterPanel(btnEl, colKey) {
    activeFilterCol = colKey;
    const panel = document.getElementById('colFilterPanel');
    if (!panel) return;

    const uniqueValues = [...new Set(allHubs.map(r => getHubColumnValue(r, colKey)))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const selected = hubColumnFilters[colKey]; // Set or undefined (undefined = all selected)

    panel.innerHTML = `
        <div class="cfp-search"><input type="text" placeholder="Search values..." oninput="filterColumnValueList(this.value)" /></div>
        <div class="cfp-selectall"><label><input type="checkbox" id="cfpSelectAll" ${!selected ? 'checked' : ''} onchange="toggleAllColumnValues(this.checked)"> Select All</label></div>
        <div class="cfp-list" id="cfpList">
            ${uniqueValues.map(v => `
                <label class="cfp-item">
                    <input type="checkbox" value="${escHtml(v)}" ${!selected || selected.has(v) ? 'checked' : ''}>
                    <span>${escHtml(v)}</span>
                </label>
            `).join('')}
        </div>
        <div class="cfp-actions">
            <button type="button" class="cfp-clear" onclick="clearColumnFilter('${colKey}')">Clear</button>
            <button type="button" class="cfp-apply" onclick="applyColumnFilter('${colKey}')">Apply</button>
        </div>
    `;

    panel.classList.remove('hidden');
    positionColumnFilterPanel(btnEl, panel);
}

function positionColumnFilterPanel(btnEl, panel) {
    const rect = btnEl.getBoundingClientRect();
    const panelWidth = 220;
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - 12) left = window.innerWidth - panelWidth - 12;
    panel.style.top  = `${rect.bottom + 6}px`;
    panel.style.left = `${Math.max(12, left)}px`;
}

function filterColumnValueList(query) {
    const q = query.toLowerCase();
    document.querySelectorAll('#cfpList .cfp-item').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}

function toggleAllColumnValues(checked) {
    document.querySelectorAll('#cfpList .cfp-item').forEach(item => {
        if (item.style.display === 'none') return;
        item.querySelector('input').checked = checked;
    });
}

function applyColumnFilter(colKey) {
    const checkboxes = document.querySelectorAll('#cfpList .cfp-item input');
    const checkedValues = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
    if (checkedValues.length === checkboxes.length) {
        delete hubColumnFilters[colKey]; // everything selected = no filter
    } else {
        hubColumnFilters[colKey] = new Set(checkedValues);
    }
    updateFilterIconStates();
    closeColumnFilterPanel();
    applyFilters();
}

function clearColumnFilter(colKey) {
    delete hubColumnFilters[colKey];
    updateFilterIconStates();
    closeColumnFilterPanel();
    applyFilters();
}

function updateFilterIconStates() {
    document.querySelectorAll('.col-filter-btn').forEach(btn => {
        btn.classList.toggle('active', !!hubColumnFilters[btn.getAttribute('data-col')]);
    });
}

function closeColumnFilterPanel() {
    const panel = document.getElementById('colFilterPanel');
    if (panel) panel.classList.add('hidden');
    activeFilterCol = null;
}

function applyHubColumnFilters(regs) {
    Object.keys(hubColumnFilters).forEach(key => {
        const allowed = hubColumnFilters[key];
        if (!allowed || allowed.size === 0) return;
        regs = regs.filter(r => allowed.has(getHubColumnValue(r, key)));
    });
    return regs;
}

// ═══════════════════ COLUMN FILTERS (PARTICIPANTS, Excel-style) ═══════════════════
const PARTICIPANT_FILTER_COLUMNS = [
    { key: 'id',           label: 'Participant ID' },
    { key: 'fullName',     label: 'Full Name' },
    { key: 'mobile',       label: 'Mobile' },
    { key: 'email',        label: 'Email' },
    { key: 'membership',   label: 'Membership' },
    { key: 'hubLeader',    label: 'Circle Host' },
    { key: 'hubCity',      label: 'Circle City' },
    { key: 'hubArea',      label: 'Circle Area' },
    { key: 'note',         label: 'Note' },
    { key: 'registeredAt', label: 'Registered On' },
    { key: 'status',       label: 'Status' },
];

let participantColumnFilters = {}; // colKey -> Set of allowed values ("absent" key = no filter on that column)
let activeFilterColP = null;

function initParticipantColumnFilters() {
    const row = document.getElementById('partTableHeaderRow');
    if (!row) return;
    const ths = row.querySelectorAll('th');
    // ths[0] is the bulk-select checkbox column — filterable columns start at index 1.
    PARTICIPANT_FILTER_COLUMNS.forEach((col, i) => {
        const th = ths[i + 1];
        if (!th) return;
        const label = th.textContent.trim();
        th.innerHTML = `<div class="th-inner"><span class="th-label">${label}</span><button type="button" class="col-filter-btn" data-colp="${col.key}" onclick="toggleColumnFilterP(event,'${col.key}')" title="Filter ${label}">&#9660;</button></div>`;
    });
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('colFilterPanel');
        if (!panel || panel.classList.contains('hidden') || activeFilterColP === null) return;
        if (panel.contains(e.target) || e.target.closest('.col-filter-btn')) return;
        closeColumnFilterPanelP();
    });
    window.addEventListener('resize', () => { if (activeFilterColP !== null) closeColumnFilterPanelP(); });
}

function getParticipantColumnValue(record, key) {
    if (key === 'registeredAt') return record.registeredAt ? formatDate(record.registeredAt) : '—';
    const v = record[key];
    return (v === null || v === undefined || String(v).trim() === '') ? '—' : String(v).trim();
}

function toggleColumnFilterP(evt, colKey) {
    evt.stopPropagation();
    if (activeFilterColP === colKey) { closeColumnFilterPanelP(); return; }
    openColumnFilterPanelP(evt.currentTarget, colKey);
}

function openColumnFilterPanelP(btnEl, colKey) {
    activeFilterColP = colKey;
    const panel = document.getElementById('colFilterPanel');
    if (!panel) return;

    const uniqueValues = [...new Set(allParticipants.map(r => getParticipantColumnValue(r, colKey)))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const selected = participantColumnFilters[colKey]; // Set or undefined (undefined = all selected)

    panel.innerHTML = `
        <div class="cfp-search"><input type="text" placeholder="Search values..." oninput="filterColumnValueList(this.value)" /></div>
        <div class="cfp-selectall"><label><input type="checkbox" id="cfpSelectAll" ${!selected ? 'checked' : ''} onchange="toggleAllColumnValues(this.checked)"> Select All</label></div>
        <div class="cfp-list" id="cfpList">
            ${uniqueValues.map(v => `
                <label class="cfp-item">
                    <input type="checkbox" value="${escHtml(v)}" ${!selected || selected.has(v) ? 'checked' : ''}>
                    <span>${escHtml(v)}</span>
                </label>
            `).join('')}
        </div>
        <div class="cfp-actions">
            <button type="button" class="cfp-clear" onclick="clearColumnFilterP('${colKey}')">Clear</button>
            <button type="button" class="cfp-apply" onclick="applyColumnFilterP('${colKey}')">Apply</button>
        </div>
    `;

    panel.classList.remove('hidden');
    positionColumnFilterPanel(btnEl, panel);
}

function applyColumnFilterP(colKey) {
    const checkboxes = document.querySelectorAll('#cfpList .cfp-item input');
    const checkedValues = [...checkboxes].filter(cb => cb.checked).map(cb => cb.value);
    if (checkedValues.length === checkboxes.length) {
        delete participantColumnFilters[colKey]; // everything selected = no filter
    } else {
        participantColumnFilters[colKey] = new Set(checkedValues);
    }
    updateFilterIconStatesP();
    closeColumnFilterPanelP();
    applyParticipantFilters();
}

function clearColumnFilterP(colKey) {
    delete participantColumnFilters[colKey];
    updateFilterIconStatesP();
    closeColumnFilterPanelP();
    applyParticipantFilters();
}

function updateFilterIconStatesP() {
    document.querySelectorAll('.col-filter-btn[data-colp]').forEach(btn => {
        btn.classList.toggle('active', !!participantColumnFilters[btn.getAttribute('data-colp')]);
    });
}

function closeColumnFilterPanelP() {
    const panel = document.getElementById('colFilterPanel');
    if (panel) panel.classList.add('hidden');
    activeFilterColP = null;
}

function applyParticipantColumnFilters(parts) {
    Object.keys(participantColumnFilters).forEach(key => {
        const allowed = participantColumnFilters[key];
        if (!allowed || allowed.size === 0) return;
        parts = parts.filter(r => allowed.has(getParticipantColumnValue(r, key)));
    });
    return parts;
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
    regs = applyHubColumnFilters(regs);
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
        updateSelectAllState();
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');
    tbody.innerHTML = regs.map(r => `
        <tr data-id="${escHtml(r.id)}">
            <td style="width:40px;position:sticky;left:0px;background:#fff;z-index:2" class="td-checkbox-col">
                <input type="checkbox" class="hub-row-checkbox" value="${escHtml(r.id)}" ${selectedHubIds.has(r.id) ? 'checked' : ''} onchange="toggleHubSelection('${escHtml(r.id)}', this.checked)">
            </td>
            <td class="td-id"    style="min-width:180px;position:sticky;left:40px;  background:#fff;z-index:2">${escHtml(r.id)}</td>
            <td class="td-name"  style="min-width:140px;position:sticky;left:220px;background:#fff;z-index:2"><button class="name-link" onclick="viewHubParticipants('${escHtml(r.id)}')">${escHtml(r.fullName)}</button></td>
            <td style="min-width:130px;position:sticky;left:360px;background:#fff;z-index:2;box-shadow:3px 0 8px rgba(0,0,0,.08)">${escHtml(r.mobile)}</td>
            <td class="td-email" style="min-width:180px">${escHtml(r.email)}</td>
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
                    ${r.status !== 'Pending'
                        ? `<button class="act-btn act-reset" onclick="confirmReset('${escHtml(r.id)}')">Reset to Pending</button>`
                        : ''}
                    ${r.status === 'Approved'
                        ? `<button class="act-btn act-view" onclick="sendHubRoster('${escHtml(r.id)}')" title="${r.rosterSentAt ? 'Last sent ' + formatDate(r.rosterSentAt) : 'Never sent'}">${r.rosterSentAt ? 'Resend Roster' : 'Send Roster'}</button>`
                        : ''}
                    <button class="act-btn act-view" onclick="viewDetails('${escHtml(r.id)}')">View</button>
                    <button class="act-btn act-delete" onclick="deleteHub('${escHtml(r.id)}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
    setTimeout(refreshScrollFade, 50);
    updateSelectAllState();
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

function confirmReset(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    pendingRegId  = id;
    openConfirmModal(
        'Reset to Pending',
        `Reset <strong>${escHtml(reg.fullName)}</strong>'s application back to Pending? No email is sent for this — you can then Approve or Reject again to trigger a fresh notification.`,
        '↩️',
        executeReset,
        'Reset'
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

async function executeReset() {
    if (!pendingRegId) return;
    const ok = await updateHubStatus(pendingRegId, 'Pending');
    if (ok) {
        showToast('Application reset to Pending.', 'success');
        await updateDashboard();
    } else {
        showToast('Failed to reset application.', 'error');
    }
    closeConfirmModal();
    pendingRegId = null;
}

// Permanently delete a hub leader application — frees up their email/mobile so
// they can apply again. Backend blocks this if participants are still registered
// under the circle.
function deleteHub(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    openConfirmModal(
        'Delete Application',
        `Permanently delete <strong>${escHtml(reg.fullName)}</strong>'s Circle Host application? This frees up their email and mobile so they can apply again. This cannot be undone.`,
        '🗑️',
        async () => {
            try {
                const res = await adminFetch(`${API_BASE}/api/admin/hubs/${id}`, { method: 'DELETE' });
                if (res.ok) {
                    showToast('Application deleted.', 'success');
                    await updateDashboard();
                } else {
                    const body = await res.json().catch(() => ({}));
                    showToast(body.error || 'Failed to delete application.', 'error');
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

// Email an approved Circle Leader their current list of Confirmed participants
// (name + mobile). Safe to re-send as new participants confirm.
function sendHubRoster(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    const n = reg.participantCount || 0;
    openConfirmModal(
        'Send Roster Email',
        `Email <strong>${escHtml(reg.fullName)}</strong> the current list of confirmed participants for their circle in ${escHtml(reg.city)}? (${n} confirmed right now.) This sends a real email immediately.`,
        '📋',
        async () => {
            try {
                const res = await adminFetch(`${API_BASE}/api/admin/hubs/${id}/send-roster`, { method: 'POST' });
                if (res.ok) {
                    showToast('Roster email sent.', 'success');
                    await updateDashboard();
                } else {
                    const body = await res.json().catch(() => ({}));
                    showToast(body.error || 'Failed to send roster email.', 'error');
                }
            } catch (e) {
                if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
            }
            closeConfirmModal();
        },
        'Send',
        false
    );
}

// Bulk version — loops the same endpoint over the selected hubs, same pattern
// as bulkUpdateHubs. Non-Approved hubs in the selection are skipped server-side.
function bulkSendHubRoster() {
    if (selectedHubIds.size === 0) return;
    const ids = [...selectedHubIds];
    const count = ids.length;
    const plural = count > 1 ? 's' : '';
    openConfirmModal(
        `Send Roster Email${plural} to ${count} Circle${plural}`,
        `Email the current confirmed-participant list to <strong>${count}</strong> selected circle leader${plural}? Only Approved circles will actually receive an email. This sends real emails immediately.`,
        '📋',
        executeBulkSendRoster,
        'Send',
        false
    );
    pendingBulkAction = { ids, status: '__send_roster__' };
}

async function executeBulkSendRoster() {
    if (!pendingBulkAction) return;
    const { ids } = pendingBulkAction;
    closeConfirmModal();
    pendingBulkAction = null;

    let successCount = 0;
    for (const id of ids) {
        try {
            const res = await adminFetch(`${API_BASE}/api/admin/hubs/${id}/send-roster`, { method: 'POST' });
            if (res.ok) successCount++;
        } catch (e) { /* keep going through the rest of the selection */ }
    }
    clearHubSelection();
    await updateDashboard();

    if (successCount === ids.length) {
        showToast(`${successCount} roster email${successCount > 1 ? 's' : ''} sent!`, 'success');
    } else {
        showToast(`${successCount}/${ids.length} sent — the rest were skipped (not Approved) or failed.`, 'warning');
    }
}

// One-click version — no selection needed. Sends the roster email to every
// currently Approved hub, regardless of what's selected or filtered on screen.
function sendAllApprovedRosters() {
    const approved = allHubs.filter(r => r.status === 'Approved');
    if (approved.length === 0) {
        showToast('No approved circles to send to.', 'warning');
        return;
    }
    const count = approved.length;
    const plural = count > 1 ? 's' : '';
    pendingBulkAction = { ids: approved.map(r => r.id), status: '__send_roster__' };
    openConfirmModal(
        `Send Roster Email to All ${count} Approved Circle${plural}`,
        `Email the current confirmed-participant list to <strong>all ${count}</strong> approved circle leader${plural}? This sends real emails immediately.`,
        '📋',
        executeBulkSendRoster,
        'Send to All',
        false
    );
}

// Only targets hubs that have never received a roster email (rosterSentAt is
// empty) — the safe way to "catch up" stragglers without re-emailing leaders
// who've already gotten one.
function sendUnsentApprovedRosters() {
    const unsent = allHubs.filter(r => r.status === 'Approved' && !r.rosterSentAt);
    if (unsent.length === 0) {
        showToast('Every approved circle has already been sent a roster email.', 'success');
        return;
    }
    const count = unsent.length;
    const plural = count > 1 ? 's' : '';
    pendingBulkAction = { ids: unsent.map(r => r.id), status: '__send_roster__' };
    openConfirmModal(
        `Send Roster Email to ${count} Never-Sent Circle${plural}`,
        `These <strong>${count}</strong> approved circle leader${plural} have never received a roster email. Send it to them now? This sends real emails immediately.`,
        '📋',
        executeBulkSendRoster,
        'Send',
        false
    );
}

// ═══════════════════ BULK SELECTION (HUBS) ═══════════════════
function toggleHubSelection(id, checked) {
    if (checked) selectedHubIds.add(id);
    else selectedHubIds.delete(id);
    updateBulkBar();
    updateSelectAllState();
}

function toggleSelectAllHubs(checked) {
    // Only affects the currently rendered (filtered) rows, not the full dataset.
    document.querySelectorAll('#tableBody .hub-row-checkbox').forEach(cb => {
        cb.checked = checked;
        if (checked) selectedHubIds.add(cb.value);
        else selectedHubIds.delete(cb.value);
    });
    updateBulkBar();
}

function updateSelectAllState() {
    const selectAll = document.getElementById('selectAllHubs');
    if (!selectAll) return;
    const boxes = [...document.querySelectorAll('#tableBody .hub-row-checkbox')];
    const checkedCount = boxes.filter(cb => cb.checked).length;
    selectAll.checked = boxes.length > 0 && checkedCount === boxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function updateBulkBar() {
    const bar = document.getElementById('hubBulkBar');
    const countEl = document.getElementById('hubBulkCount');
    if (!bar) return;
    bar.classList.toggle('hidden', selectedHubIds.size === 0);
    if (countEl) countEl.textContent = `${selectedHubIds.size} selected`;
}

function clearHubSelection() {
    selectedHubIds.clear();
    document.querySelectorAll('#tableBody .hub-row-checkbox').forEach(cb => { cb.checked = false; });
    updateBulkBar();
    updateSelectAllState();
}

function bulkUpdateHubs(status) {
    if (selectedHubIds.size === 0) return;
    const ids   = [...selectedHubIds];
    const count = ids.length;
    const plural = count > 1 ? 's' : '';
    const copy = {
        Approved: { verb: 'approve', label: 'Approve', emoji: '✅', danger: false, note: 'This will send an approval email to each of them.' },
        Rejected: { verb: 'reject',  label: 'Reject',  emoji: '❌', danger: true,  note: 'This will send a rejection email to each of them.' },
        Pending:  { verb: 'reset',   label: 'Reset',   emoji: '↩️', danger: false, note: 'No emails are sent for this.' },
    }[status];
    if (!copy) return;

    pendingBulkAction = { ids, status };
    openConfirmModal(
        `${copy.label} ${count} Application${plural}`,
        `Are you sure you want to ${copy.verb} <strong>${count}</strong> selected application${plural}? ${copy.note}`,
        copy.emoji,
        executeBulkUpdate,
        copy.label,
        copy.danger
    );
}

async function executeBulkUpdate() {
    if (!pendingBulkAction) return;
    const { ids, status } = pendingBulkAction;
    closeConfirmModal();
    pendingBulkAction = null;

    let successCount = 0;
    for (const id of ids) {
        const ok = await updateHubStatus(id, status);
        if (ok) successCount++;
    }
    clearHubSelection();
    await updateDashboard();

    if (successCount === ids.length) {
        showToast(`${successCount} application${successCount > 1 ? 's' : ''} updated successfully!`, 'success');
    } else {
        showToast(`${successCount}/${ids.length} updated — some failed, please check and retry.`, 'warning');
    }
}

function viewDetails(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    const titleEl = document.getElementById('detailsTitle');
    if (titleEl) titleEl.textContent = 'Application Details';
    const content = document.getElementById('detailsContent');
    const pendingChanges = Array.isArray(reg.pendingChangeSummary) ? reg.pendingChangeSummary : [];
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
        ${pendingChanges.length > 0 ? `
        <div class="change-banner">
            <strong>${pendingChanges.length} change${pendingChanges.length > 1 ? 's' : ''} not yet notified to participants:</strong>
            <ul>
                ${pendingChanges.map(c => `<li>${escHtml(c.label)}: ${escHtml(c.oldValue || '—')} &rarr; ${escHtml(c.newValue || '—')}</li>`).join('')}
            </ul>
            <button class="act-btn act-view" onclick="notifyHubUpdate('${escHtml(reg.id)}')" title="${reg.changeNotifiedAt ? 'Last notified ' + formatDate(reg.changeNotifiedAt) : 'Never notified'}">📣 Notify Participants</button>
        </div>
        ` : ''}
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
            <button class="btn-primary" onclick="enterEditMode('${escHtml(reg.id)}')">✏️ Edit Details</button>
        </div>
    `;
    document.getElementById('detailsOverlay').classList.add('visible');
}

// ═══════════════════ HUB EDIT MODE ═══════════════════
const CAPACITY_OPTIONS = Array.from({ length: 11 }, (_, i) => `${i + 5} People`);
const MEMBERSHIP_OPTIONS = ['QPFP Certificant', 'NFP Member', 'Both NFP ProMember & QPFP Certificant'];
const HOSTING_FREQUENCY_OPTIONS = ['Only host on 5 August', 'Once a Quarter', 'Open to Either'];

function optionsHtml(options, current) {
    return options.map(o => `<option value="${escHtml(o)}" ${o === current ? 'selected' : ''}>${escHtml(o)}</option>`).join('');
}

function enterEditMode(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    const titleEl = document.getElementById('detailsTitle');
    if (titleEl) titleEl.textContent = 'Edit Circle Leader Details';
    const content = document.getElementById('detailsContent');
    content.innerHTML = `
        <div class="detail-section">
            <h4>Personal Details</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Full Name</label><input id="editFullName" class="form-input" value="${escHtml(reg.fullName)}"></div>
                <div class="detail-item"><label>Email</label><input id="editEmail" class="form-input" type="email" value="${escHtml(reg.email)}"></div>
                <div class="detail-item"><label>Mobile</label><input id="editMobile" class="form-input" value="${escHtml(reg.mobile)}"></div>
                <div class="detail-item">
                    <label>Membership Type</label>
                    <select id="editMembership" class="form-input">${optionsHtml(MEMBERSHIP_OPTIONS, reg.membership)}</select>
                </div>
            </div>
        </div>
        <div class="detail-section">
            <h4>Circle / Venue Details</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>City</label><input id="editCity" class="form-input" value="${escHtml(reg.city)}"></div>
                <div class="detail-item"><label>Area / Locality</label><input id="editArea" class="form-input" value="${escHtml(reg.area)}"></div>
                <div class="detail-item"><label>PIN Code</label><input id="editPincode" class="form-input" value="${escHtml(reg.pincode)}"></div>
                <div class="detail-item"><label>Full Address</label><input id="editAddress" class="form-input" value="${escHtml(reg.address || '')}"></div>
                <div class="detail-item"><label>Venue Type</label><input id="editVenueType" class="form-input" value="${escHtml(reg.venueType)}"></div>
                <div class="detail-item">
                    <label>Hosting Capacity</label>
                    <select id="editCapacity" class="form-input">${optionsHtml(CAPACITY_OPTIONS, reg.capacity)}</select>
                </div>
                <div class="detail-item">
                    <label>Hosted NFP Event Before?</label>
                    <select id="editHostedBefore" class="form-input">${optionsHtml(['Yes', 'No'], reg.hostedBefore)}</select>
                </div>
                <div class="detail-item">
                    <label>Willing to Host NFP Circle</label>
                    <select id="editHostingFrequency" class="form-input">${optionsHtml(HOSTING_FREQUENCY_OPTIONS, reg.hostingFrequency)}</select>
                </div>
                <div class="detail-item">
                    <label>Circle POC</label>
                    <select id="editPocRole" class="form-input">
                        <option value="self" ${reg.pocRole !== 'assign' ? 'selected' : ''}>I will be the POC</option>
                        <option value="assign" ${reg.pocRole === 'assign' ? 'selected' : ''}>Will assign someone else</option>
                    </select>
                </div>
            </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
            <button class="btn-primary" onclick="saveHubEdits('${escHtml(reg.id)}')">💾 Save Changes</button>
            <button class="act-btn act-view" onclick="viewDetails('${escHtml(reg.id)}')">Cancel</button>
        </div>
    `;
}

async function saveHubEdits(id) {
    const body = {
        fullName: document.getElementById('editFullName').value.trim(),
        email: document.getElementById('editEmail').value.trim(),
        mobile: document.getElementById('editMobile').value.trim(),
        membership: document.getElementById('editMembership').value,
        city: document.getElementById('editCity').value.trim(),
        area: document.getElementById('editArea').value.trim(),
        pincode: document.getElementById('editPincode').value.trim(),
        address: document.getElementById('editAddress').value.trim(),
        venueType: document.getElementById('editVenueType').value.trim(),
        capacity: document.getElementById('editCapacity').value,
        hostedBefore: document.getElementById('editHostedBefore').value,
        hostingFrequency: document.getElementById('editHostingFrequency').value,
        pocRole: document.getElementById('editPocRole').value,
    };
    try {
        const res = await adminFetch(`${API_BASE}/api/admin/hubs/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            const updated = await res.json();
            const idx = allHubs.findIndex(r => String(r.id) === String(id));
            if (idx !== -1) allHubs[idx] = { ...allHubs[idx], ...updated };
            showToast('Circle Leader details updated.', 'success');
            viewDetails(id);
        } else {
            const errBody = await res.json().catch(() => ({}));
            showToast(errBody.error || 'Failed to save changes.', 'error');
        }
    } catch (e) {
        if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
    }
}

// Email every Confirmed participant about this hub's pending (unnotified)
// changes, then clear the pending-change banner. Confirmed count is computed
// from allParticipants rather than the hub row, since that's the exact
// audience the backend will actually send to.
function notifyHubUpdate(id) {
    const reg = allHubs.find(r => String(r.id) === String(id));
    if (!reg) return;
    const pendingChanges = Array.isArray(reg.pendingChangeSummary) ? reg.pendingChangeSummary : [];
    if (pendingChanges.length === 0) return;
    const confirmedCount = allParticipants.filter(p => String(p.hubId) === String(id) && p.status === 'Confirmed').length;
    const changeList = pendingChanges.map(c => `${escHtml(c.label)}: ${escHtml(c.oldValue || '—')} &rarr; ${escHtml(c.newValue || '—')}`).join('<br>');
    openConfirmModal(
        'Notify Participants of Update',
        `Email <strong>${confirmedCount}</strong> confirmed participant${confirmedCount === 1 ? '' : 's'} of <strong>${escHtml(reg.fullName)}</strong>'s circle about these changes?<br><br>${changeList}`,
        '📣',
        async () => {
            try {
                const res = await adminFetch(`${API_BASE}/api/admin/hubs/${id}/notify-update`, { method: 'POST' });
                if (res.ok) {
                    showToast('Participants notified.', 'success');
                    await updateDashboard();
                    closeDetailsModal();
                } else {
                    const body = await res.json().catch(() => ({}));
                    showToast(body.error || 'Failed to notify participants.', 'error');
                }
            } catch (e) {
                if (e.message !== 'Unauthorized') showToast('Could not reach the server.', 'error');
            }
            closeConfirmModal();
        },
        'Notify'
    );
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

// ═══════════════════════════════════════════════════════════════
//  ANALYTICS — FULL SUITE
// ═══════════════════════════════════════════════════════════════

function setAnalyticsRange(range, btn) {
    analyticsRangeDays = range === 'all' ? null : range;
    document.querySelectorAll('.analytics-range-bar .chip').forEach(c => c.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderAnalytics();
}

function filterByAnalyticsRange(items, dateField) {
    if (!analyticsRangeDays) return items;
    const cutoff = Date.now() - analyticsRangeDays * 86400000;
    return items.filter(item => {
        const t = new Date(item[dateField]).getTime();
        return Number.isFinite(t) && t >= cutoff;
    });
}

function renderAnalytics() {
    if (!allHubs.length) return;
    // "Flow" charts (activity that happened within the selected window) respect the
    // date-range filter. "State" charts (what's true right now — capacity, fill rate,
    // which circles are empty) always reflect the full current dataset, since filtering
    // e.g. "Circles with No Participants" to the last 7 days would hide older empty
    // circles instead of showing the real current gap.
    const hubs  = filterByAnalyticsRange(allHubs, 'submittedAt');
    const parts = filterByAnalyticsRange(allParticipants, 'registeredAt');
    const hubsAll  = allHubs;
    const partsAll = allParticipants;

    // Hub Leader Insights
    renderDonut(hubs);
    renderApplicationTrend(hubs);
    renderStatusFunnel(hubs, parts);
    renderCityBars(hubs);
    renderCitiesKpi(hubsAll);
    renderCitiesNeedingCircles(hubsAll);
    renderAreaBars(hubs);
    renderApprovalByCity(hubs);
    renderMemberBars(hubs);
    renderVenueBars(hubs);
    renderCapacityDistribution(hubs);
    renderHostingExperience(hubs);
    renderHostingFrequency(hubs);
    renderPocRole(hubs);

    // Participant Insights
    renderRegistrationTrend(parts);
    renderParticipantsByCity(parts);
    renderTopCirclesByParticipants(parts);
    renderParticipantMembership(parts);
    renderCircleFillRate(hubsAll, partsAll);
    renderCancellationKpi(parts);
    renderCirclesWithNoParticipants(hubsAll, partsAll);

    // Combined
    renderSupplyVsDemand(hubsAll, partsAll);
    renderCapacityVsRegistered(hubsAll, partsAll);
}

// ── Shared: horizontal bar set ──
function renderBarSet(containerId, counts, color) {
    color = color || 'var(--primary)';
    const el = document.getElementById(containerId);
    if (!el) return;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] || 1;
    if (!sorted.length) { el.innerHTML = '<div class="a-no-data">No data yet</div>'; return; }
    el.classList.add('chart-scroll');
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

// ── Shared: small donut ──
function renderSmallDonut(chartId, legendId, data) {
    const total = data.reduce((s, d) => s + d.val, 0);
    if (!total) return;
    const conicParts = [];
    let acc = 0;
    data.forEach(d => {
        if (d.val > 0) {
            const deg = (d.val / total) * 360;
            conicParts.push(`${d.color} ${acc}deg ${acc + deg}deg`);
            acc += deg;
        }
    });
    const donutEl = document.getElementById(chartId);
    if (donutEl) {
        donutEl.innerHTML = `
            <div style="width:140px;height:140px;border-radius:50%;background:conic-gradient(${conicParts.join(',')});position:relative;margin:0 auto">
                <div style="position:absolute;inset:28px;border-radius:50%;background:var(--white);display:flex;flex-direction:column;align-items:center;justify-content:center">
                    <strong style="font-size:20px;color:var(--dark)">${total}</strong>
                    <span style="font-size:10px;color:var(--muted)">Total</span>
                </div>
            </div>`;
    }
    const legendEl = document.getElementById(legendId);
    if (legendEl) {
        legendEl.innerHTML = data.map(d => `
            <div class="legend-item">
                <span class="legend-dot" style="background:${d.color}"></span>
                <span class="legend-label">${escHtml(d.label)}</span>
                <span class="legend-val">${d.val} (${total ? Math.round(d.val/total*100) : 0}%)</span>
            </div>`).join('');
    }
}

// ── Shared: trend bar chart (vertical) ──
function renderTrendChart(elId, data, color) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!data.length) { el.innerHTML = '<div class="a-no-data">No data yet</div>'; return; }
    const max = Math.max(...data.map(d => d.count));
    el.innerHTML = `<div class="trend-chart-inner">${
        data.map(d => `
            <div class="trend-col">
                <div class="trend-val">${d.count}</div>
                <div class="trend-bar" style="height:${Math.max(6, Math.round(d.count/max*100))}%;background:${color}"></div>
                <div class="trend-label">${escHtml(d.label)}</div>
            </div>`).join('')
    }</div>`;
}

function groupByMonth(items, dateField) {
    const map = {};
    items.forEach(r => {
        const d = new Date(r[dateField]);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        if (!map[key]) map[key] = { label, count: 0 };
        map[key].count++;
    });
    return Object.entries(map).sort((a,b) => a[0].localeCompare(b[0])).slice(-12).map(([,v]) => v);
}

function groupByDay(items, dateField) {
    const map = {};
    items.forEach(r => {
        const d = new Date(r[dateField]);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const label = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        if (!map[key]) map[key] = { label, count: 0 };
        map[key].count++;
    });
    return Object.entries(map).sort((a,b) => a[0].localeCompare(b[0])).slice(-30).map(([,v]) => v);
}

function setTrendMode(mode) {
    trendMode = mode;
    document.getElementById('trendDayBtn')?.classList.toggle('active', mode === 'day');
    document.getElementById('trendMonthBtn')?.classList.toggle('active', mode === 'month');
    renderApplicationTrend(allHubs);
}

function setRegTrendMode(mode) {
    trendModeP = mode;
    document.getElementById('regTrendDayBtn')?.classList.toggle('active', mode === 'day');
    document.getElementById('regTrendMonthBtn')?.classList.toggle('active', mode === 'month');
    renderRegistrationTrend(allParticipants);
}

// ══ HUB LEADER CHARTS ══

function renderDonut(regs) {
    const colors = { Pending: '#D97706', Approved: '#16A34A', Rejected: '#DC2626' };
    const total  = regs.length;
    const data   = ['Pending','Approved','Rejected'].map(s => ({
        label: s, val: regs.filter(r => r.status === s).length, color: colors[s],
    }));
    renderSmallDonut('donutChart', 'chartLegend', data);
    // override center with larger number for the main donut
    const donutEl = document.getElementById('donutChart');
    if (donutEl) {
        const inner = donutEl.querySelector('div > div');
        if (inner) inner.querySelector('strong').style.fontSize = '24px';
    }
}

function renderApplicationTrend(regs) {
    const data = trendMode === 'day'
        ? groupByDay(regs, 'submittedAt')
        : groupByMonth(regs, 'submittedAt');
    renderTrendChart('trendBars', data, 'var(--primary)');
}

function renderStatusFunnel(regs, parts) {
    const el = document.getElementById('funnelChart');
    if (!el) return;
    const total     = regs.length;
    const approved  = regs.filter(r => r.status === 'Approved').length;
    const withParts = new Set(parts.filter(p => p.status === 'Confirmed').map(p => p.hubId)).size;
    const steps = [
        { label: 'Total Applied',    val: total,     color: '#3B82F6', pct: 100 },
        { label: 'Approved',         val: approved,  color: '#16A34A', pct: total ? Math.round(approved/total*100)  : 0 },
        { label: 'Has Participants', val: withParts, color: '#7C3AED', pct: total ? Math.round(withParts/total*100) : 0 },
    ];
    el.innerHTML = steps.map(s => `
        <div class="funnel-step">
            <div class="funnel-label">${s.label}</div>
            <div class="funnel-bar-wrap">
                <div class="funnel-bar" style="width:${Math.max(s.pct,8)}%;background:${s.color}"><span>${s.val}</span></div>
                <span class="funnel-pct">${s.pct}%</span>
            </div>
        </div>`).join('');
}

function renderCityBars(regs) {
    const counts = {};
    regs.forEach(r => { counts[r.city] = (counts[r.city] || 0) + 1; });
    renderBarSet('cityBars', counts, 'var(--primary)');
}

function renderAreaBars(regs) {
    const counts = {};
    regs.forEach(r => { if (r.area) counts[r.area] = (counts[r.area] || 0) + 1; });
    renderBarSet('areaBars', counts, '#0EA5E9');
}

function renderApprovalByCity(regs) {
    const el = document.getElementById('approvalCityBars');
    if (!el) return;
    const cityMap = {};
    regs.forEach(r => {
        if (!cityMap[r.city]) cityMap[r.city] = { total: 0, approved: 0 };
        cityMap[r.city].total++;
        if (r.status === 'Approved') cityMap[r.city].approved++;
    });
    const sorted = Object.entries(cityMap)
        .map(([city, d]) => ({ city, ...d, rate: Math.round(d.approved/d.total*100) }))
        .sort((a,b) => b.rate - a.rate);
    if (!sorted.length) { el.innerHTML = '<div class="a-no-data">No data yet</div>'; return; }
    el.classList.add('chart-scroll');
    el.innerHTML = sorted.map(c => `
        <div class="bar-row">
            <div class="bar-label-row">
                <span>${escHtml(c.city)}</span>
                <strong>${c.approved}/${c.total} — ${c.rate}%</strong>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width:${c.rate}%;background:#16A34A"></div>
            </div>
        </div>`).join('');
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

function renderCapacityDistribution(regs) {
    const counts = {};
    regs.forEach(r => {
        const n = parseInt(r.capacity) || 0;
        const b = n <= 5 ? '1–5 People' : n <= 10 ? '6–10 People' : n <= 20 ? '11–20 People' : '21+ People';
        counts[b] = (counts[b] || 0) + 1;
    });
    renderBarSet('capacityBars', counts, '#F59E0B');
}

function renderHostingExperience(regs) {
    const yes = regs.filter(r => r.hostedBefore === 'Yes').length;
    renderSmallDonut('experienceDonut', 'experienceLegend', [
        { label: 'Experienced', val: yes,               color: '#16A34A' },
        { label: 'First-Timers', val: regs.length - yes, color: '#F59E0B' },
    ]);
}

function renderHostingFrequency(regs) {
    const counts = {};
    regs.forEach(r => { const f = r.hostingFrequency || 'Not specified'; counts[f] = (counts[f]||0)+1; });
    renderBarSet('freqBars', counts, '#8B5CF6');
}

function renderPocRole(regs) {
    const assign = regs.filter(r => r.pocRole === 'assign').length;
    renderSmallDonut('pocDonut', 'pocLegend', [
        { label: 'Self',           val: regs.length - assign, color: '#3B82F6' },
        { label: 'Assign Someone', val: assign,               color: '#EC4899' },
    ]);
}

// ══ PARTICIPANT CHARTS ══

function renderRegistrationTrend(parts) {
    const data = trendModeP === 'day'
        ? groupByDay(parts, 'registeredAt')
        : groupByMonth(parts, 'registeredAt');
    renderTrendChart('regTrendBars', data, '#7C3AED');
}

function renderParticipantsByCity(parts) {
    const counts = {};
    parts.filter(p => p.status === 'Confirmed').forEach(p => {
        const c = p.hubCity || 'Unknown'; counts[c] = (counts[c]||0)+1;
    });
    renderBarSet('partCityBars', counts, '#0EA5E9');
}

function renderTopCirclesByParticipants(parts) {
    const counts = {};
    parts.filter(p => p.status === 'Confirmed').forEach(p => {
        const k = p.hubLeader || 'Unknown'; counts[k] = (counts[k]||0)+1;
    });
    renderBarSet('topCirclesBars', counts, '#EC4899');
}

function renderParticipantMembership(parts) {
    const counts = {};
    parts.forEach(p => { counts[p.membership] = (counts[p.membership]||0)+1; });
    renderBarSet('partMemberBars', counts, '#2563EB');
}

function renderCircleFillRate(hubs, parts) {
    const el = document.getElementById('fillRateBars');
    if (!el) return;
    const approved = hubs.filter(h => h.status === 'Approved');
    if (!approved.length) { el.innerHTML = '<div class="a-no-data">No approved circles yet</div>'; return; }
    el.classList.add('chart-scroll');
    const data = approved.map(h => {
        const cap = parseInt(h.capacity) || 0;
        const reg = parts.filter(p => String(p.hubId) === String(h.id) && p.status === 'Confirmed').length;
        const pct = cap > 0 ? Math.min(100, Math.round(reg/cap*100)) : 0;
        return { name: h.fullName, cap, reg, pct };
    }).sort((a,b) => b.pct - a.pct);
    el.innerHTML = data.map(d => {
        const col = d.pct >= 90 ? '#DC2626' : d.pct >= 60 ? '#F59E0B' : '#16A34A';
        return `<div class="bar-row">
            <div class="bar-label-row">
                <span style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(d.name)}">${escHtml(d.name)}</span>
                <strong style="color:${col}">${d.reg}/${d.cap} (${d.pct}%)</strong>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${col}"></div></div>
        </div>`;
    }).join('');
}

function renderCancellationKpi(parts) {
    const el = document.getElementById('cancellationKpi');
    if (!el) return;
    const total     = parts.length;
    const cancelled = parts.filter(p => p.status === 'Cancelled').length;
    const confirmed = total - cancelled;
    const rate      = total ? Math.round(cancelled/total*100) : 0;
    const col       = rate > 20 ? '#DC2626' : rate > 10 ? '#F59E0B' : '#16A34A';
    el.innerHTML = `
        <div class="kpi-big" style="color:${col}">${rate}%</div>
        <div class="kpi-sub">of all registrations cancelled</div>
        <div style="margin-top:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
            <div class="kpi-pill" style="background:#dcfce7;color:#16A34A">${confirmed} Confirmed</div>
            <div class="kpi-pill" style="background:#fee2e2;color:#DC2626">${cancelled} Cancelled</div>
        </div>`;
}

// Priority expansion cities — shown even at 0 approved Circles so gaps are visible at a glance.
const TARGET_CITIES = [
    'Mumbai', 'Bengaluru', 'Pune', 'Hyderabad', 'Chennai', 'Thane', 'Delhi', 'Kolkata',
    'Ahmedabad', 'Vadodara', 'Navi Mumbai', 'Jaipur', 'Surat', 'Gurugram', 'Coimbatore',
    'Aurangabad', 'Nashik', 'Chandigarh', 'Lucknow', 'Noida', 'Kalyan-Dombivli', 'Indore',
    'Guwahati', 'Kanpur', 'Rajkot', 'Faridabad', 'Jalgaon', 'Nagpur', 'Kolhapur', 'Goa',
    'Howrah', 'Ghaziabad', 'Kochi', 'Mangaluru', 'Navsari', 'Valsad', 'Belagavi', 'Mysuru',
    'Bhubaneswar', 'Amravati',
];
// City names as stored in some existing records that should count toward a target city above.
const CITY_ALIASES = { 'Gurgaon (Gurugram)': 'Gurugram' };

function renderCitiesKpi(hubs) {
    const counts = {};
    TARGET_CITIES.forEach(city => { counts[city] = 0; });
    hubs.filter(h => h.status === 'Approved' && h.city).forEach(h => {
        const city = CITY_ALIASES[h.city] || h.city;
        counts[city] = (counts[city] || 0) + 1;
    });
    renderBarSet('citiesKpi', counts, 'var(--primary)');
}

function renderCitiesNeedingCircles(hubs) {
    const el = document.getElementById('citiesNeedingList');
    if (!el) return;
    const approvedCities = new Set();
    hubs.filter(h => h.status === 'Approved' && h.city).forEach(h => {
        approvedCities.add(CITY_ALIASES[h.city] || h.city);
    });
    const missing = TARGET_CITIES.filter(city => !approvedCities.has(city));
    if (!missing.length) {
        el.innerHTML = '<div class="a-no-data" style="color:#16A34A">Every target city has an approved Circle!</div>';
        return;
    }
    el.classList.add('chart-scroll');
    el.innerHTML = `
        <div class="empty-circle-count">${missing.length} of ${TARGET_CITIES.length} target cities still need a Circle</div>
        <div class="empty-circles-grid">${
            missing.map(city => `
                <div class="empty-circle-row">
                    <span class="ec-dot"></span>
                    <div class="ec-name">${escHtml(city)}</div>
                </div>`).join('')
        }</div>`;
}

function renderCirclesWithNoParticipants(hubs, parts) {
    const el = document.getElementById('noParticipantsList');
    if (!el) return;
    const hubsWithParts = new Set(parts.filter(p => p.status === 'Confirmed').map(p => String(p.hubId)));
    const empty = hubs.filter(h => h.status === 'Approved' && !hubsWithParts.has(String(h.id)));
    if (!empty.length) {
        el.innerHTML = '<div class="a-no-data" style="color:#16A34A">All approved circles have at least one participant!</div>';
        return;
    }
    el.classList.add('chart-scroll');
    el.innerHTML = `
        <div class="empty-circle-count">${empty.length} circle${empty.length > 1 ? 's' : ''} still need${empty.length === 1 ? 's' : ''} participants</div>
        <div class="empty-circles-grid">${
            empty.map(h => `
                <div class="empty-circle-row">
                    <span class="ec-dot"></span>
                    <div>
                        <div class="ec-name">${escHtml(h.fullName)}</div>
                        <div class="ec-loc">${escHtml(h.city)}${h.area ? ' · '+escHtml(h.area) : ''}</div>
                    </div>
                </div>`).join('')
        }</div>`;
}

// ══ COMBINED CHARTS ══

function renderSupplyVsDemand(hubs, parts) {
    const el = document.getElementById('supplyDemandBars');
    if (!el) return;
    const cityMap = {};
    hubs.filter(h => h.status === 'Approved').forEach(h => {
        cityMap[h.city] = cityMap[h.city] || { circles: 0, participants: 0 };
        cityMap[h.city].circles++;
    });
    parts.filter(p => p.status === 'Confirmed').forEach(p => {
        const c = p.hubCity || 'Unknown';
        cityMap[c] = cityMap[c] || { circles: 0, participants: 0 };
        cityMap[c].participants++;
    });
    const sorted = Object.entries(cityMap).sort((a,b) => b[1].participants - a[1].participants);
    if (!sorted.length) { el.innerHTML = '<div class="a-no-data">No data yet</div>'; return; }
    el.classList.add('chart-scroll');
    const maxC = Math.max(...sorted.map(([,d]) => d.circles));
    const maxP = Math.max(...sorted.map(([,d]) => d.participants), 1);
    el.innerHTML = sorted.map(([city, d]) => `
        <div class="sd-row">
            <div class="sd-city">${escHtml(city)}</div>
            <div class="sd-bars">
                <div class="sd-bar-wrap">
                    <span class="sd-badge" style="background:#3B82F6">Circles</span>
                    <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${Math.round(d.circles/Math.max(maxC,1)*100)}%;background:#3B82F6"></div></div>
                    <span class="sd-val">${d.circles}</span>
                </div>
                <div class="sd-bar-wrap">
                    <span class="sd-badge" style="background:#7C3AED">People</span>
                    <div class="bar-track" style="flex:1"><div class="bar-fill" style="width:${Math.round(d.participants/maxP*100)}%;background:#7C3AED"></div></div>
                    <span class="sd-val">${d.participants}</span>
                </div>
            </div>
        </div>`).join('');
}

function renderCapacityVsRegistered(hubs, parts) {
    const el = document.getElementById('capacityVsRegistered');
    if (!el) return;
    const totalCap = hubs.filter(h => h.status === 'Approved').reduce((s,h) => s + (parseInt(h.capacity)||0), 0);
    const totalReg = parts.filter(p => p.status === 'Confirmed').length;
    const pct      = totalCap > 0 ? Math.min(100, Math.round(totalReg/totalCap*100)) : 0;
    const col      = pct >= 90 ? '#DC2626' : pct >= 60 ? '#F59E0B' : '#3B82F6';
    el.innerHTML = `
        <div style="text-align:center;padding:8px 0">
            <div class="kpi-big" style="color:${col}">${pct}%</div>
            <div class="kpi-sub">Overall Fill Rate</div>
            <div class="cap-prog-track"><div class="cap-prog-fill" style="width:${pct}%;background:${col}"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:6px">
                <span>${totalReg} Registered</span>
                <span>${totalCap} Total Spots</span>
            </div>
            <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
                <div class="kpi-pill" style="background:#eff6ff;color:#3B82F6">${totalCap - totalReg} Spots Available</div>
                <div class="kpi-pill" style="background:#f0fdf4;color:#16A34A">${totalReg} Filled</div>
            </div>
        </div>`;
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
    const pending   = parts.filter(p => p.status === 'Pending').length;
    const confirmed = parts.filter(p => p.status === 'Confirmed').length;
    const cancelled = parts.filter(p => p.status === 'Cancelled').length;
    const hubs      = new Set(parts.map(p => p.hubId)).size;

    animateCount('pStatTotal',     total);
    animateCount('pStatPending',   pending);
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
    parts = applyParticipantColumnFilters(parts);
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
        updateSelectAllStateP();
        return;
    }
    if (emptyEl) emptyEl.classList.remove('visible');

    tbody.innerHTML = parts.map(p => `
        <tr data-id="${escHtml(p.id)}">
            <td style="width:40px;position:sticky;left:0px;background:#fff;z-index:2" class="td-checkbox-col">
                <input type="checkbox" class="participant-row-checkbox" value="${escHtml(p.id)}" ${selectedParticipantIds.has(p.id) ? 'checked' : ''} onchange="toggleParticipantSelection('${escHtml(p.id)}', this.checked)">
            </td>
            <td class="td-id"   style="min-width:200px;position:sticky;left:40px;  background:#fff;z-index:2">${escHtml(p.id)}</td>
            <td class="td-name" style="min-width:140px;position:sticky;left:240px;background:#fff;z-index:2"><button class="name-link" onclick="viewParticipantDetails('${escHtml(p.id)}')">${escHtml(p.fullName)}</button></td>
            <td style="min-width:130px;position:sticky;left:380px;background:#fff;z-index:2;box-shadow:3px 0 8px rgba(0,0,0,.08)">${escHtml(p.mobile)}</td>
            <td class="td-email">${escHtml(p.email)}</td>
            <td>${escHtml(p.membership)}</td>
            <td class="td-name">${escHtml(p.hubLeader)}'s Circle</td>
            <td>${escHtml(p.hubCity)}</td>
            <td>${escHtml(p.hubArea)}</td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--muted)" title="${escHtml(p.note || '')}">${escHtml(p.note || '—')}</td>
            <td>${formatDate(p.registeredAt)}</td>
            <td>${participantStatusBadge(p.status)}</td>
            <td>
                <div class="action-btns">
                    ${p.status !== 'Confirmed'
                        ? `<button class="act-btn act-approve" onclick="confirmParticipant('${escHtml(p.id)}')">Confirm</button>`
                        : ''}
                    ${p.status !== 'Cancelled'
                        ? `<button class="act-btn act-reject" onclick="cancelParticipant('${escHtml(p.id)}')">Cancel</button>`
                        : ''}
                    ${p.status !== 'Pending'
                        ? `<button class="act-btn act-reset" onclick="resetParticipant('${escHtml(p.id)}')">Reset to Pending</button>`
                        : ''}
                    <button class="act-btn act-view" onclick="viewParticipantDetails('${escHtml(p.id)}')">View</button>
                    <button class="act-btn act-delete" onclick="deleteParticipant('${escHtml(p.id)}')">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
    setTimeout(refreshScrollFade, 50);
    updateSelectAllStateP();
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

function confirmParticipant(id) {
    const p = allParticipants.find(p => String(p.id) === String(id));
    if (!p) return;
    openConfirmModal(
        'Confirm Registration',
        `Confirm <strong>${escHtml(p.fullName)}</strong>'s registration? This will send them a confirmation email.`,
        '✅',
        async () => {
            const ok = await updateParticipantStatus(id, 'Confirmed');
            if (ok) {
                showToast('Registration confirmed.', 'success');
                await loadParticipants();
                updateParticipantStats();
                applyParticipantFilters();
            } else {
                showToast('Failed to confirm registration.', 'error');
            }
            closeConfirmModal();
        },
        'Confirm'
    );
}

function cancelParticipant(id) {
    openConfirmModal(
        'Cancel Registration',
        'Are you sure you want to cancel this participant registration? This will send them a cancellation email.',
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
        'Yes, Cancel',
        true
    );
}

function resetParticipant(id) {
    const p = allParticipants.find(p => String(p.id) === String(id));
    if (!p) return;
    openConfirmModal(
        'Reset to Pending',
        `Reset <strong>${escHtml(p.fullName)}</strong>'s registration back to Pending? No email is sent for this — you can then Confirm or Cancel again to trigger a fresh notification.`,
        '↩️',
        async () => {
            const ok = await updateParticipantStatus(id, 'Pending');
            if (ok) {
                showToast('Registration reset to Pending.', 'success');
                await loadParticipants();
                updateParticipantStats();
                applyParticipantFilters();
            } else {
                showToast('Failed to reset registration.', 'error');
            }
            closeConfirmModal();
        },
        'Reset'
    );
}

// ═══════════════════ BULK SELECTION (PARTICIPANTS) ═══════════════════
function toggleParticipantSelection(id, checked) {
    if (checked) selectedParticipantIds.add(id);
    else selectedParticipantIds.delete(id);
    updateBulkBarP();
    updateSelectAllStateP();
}

function toggleSelectAllParticipants(checked) {
    // Only affects the currently rendered (filtered) rows, not the full dataset.
    document.querySelectorAll('#pTableBody .participant-row-checkbox').forEach(cb => {
        cb.checked = checked;
        if (checked) selectedParticipantIds.add(cb.value);
        else selectedParticipantIds.delete(cb.value);
    });
    updateBulkBarP();
}

function updateSelectAllStateP() {
    const selectAll = document.getElementById('selectAllParticipants');
    if (!selectAll) return;
    const boxes = [...document.querySelectorAll('#pTableBody .participant-row-checkbox')];
    const checkedCount = boxes.filter(cb => cb.checked).length;
    selectAll.checked = boxes.length > 0 && checkedCount === boxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

function updateBulkBarP() {
    const bar = document.getElementById('partBulkBar');
    const countEl = document.getElementById('partBulkCount');
    if (!bar) return;
    bar.classList.toggle('hidden', selectedParticipantIds.size === 0);
    if (countEl) countEl.textContent = `${selectedParticipantIds.size} selected`;
}

function clearParticipantSelection() {
    selectedParticipantIds.clear();
    document.querySelectorAll('#pTableBody .participant-row-checkbox').forEach(cb => { cb.checked = false; });
    updateBulkBarP();
    updateSelectAllStateP();
}

function bulkUpdateParticipants(status) {
    if (selectedParticipantIds.size === 0) return;
    const ids   = [...selectedParticipantIds];
    const count = ids.length;
    const plural = count > 1 ? 's' : '';
    const copy = {
        Confirmed: { verb: 'confirm', title: 'Confirm', btnText: 'Confirm',     emoji: '✅', danger: false, note: ' This will send a confirmation email to each of them.' },
        Cancelled: { verb: 'cancel',  title: 'Cancel',  btnText: 'Yes, Cancel', emoji: '❌', danger: true,  note: ' This will send a cancellation email to each of them.' },
        Pending:   { verb: 'reset',   title: 'Reset',   btnText: 'Reset',       emoji: '↩️', danger: false, note: ' No emails are sent for this.' },
    }[status];
    if (!copy) return;

    pendingBulkActionP = { ids, status };
    openConfirmModal(
        `${copy.title} ${count} Registration${plural}`,
        `Are you sure you want to ${copy.verb} <strong>${count}</strong> selected registration${plural}?${copy.note}`,
        copy.emoji,
        executeBulkUpdateParticipants,
        copy.btnText,
        copy.danger
    );
}

async function executeBulkUpdateParticipants() {
    if (!pendingBulkActionP) return;
    const { ids, status } = pendingBulkActionP;
    closeConfirmModal();
    pendingBulkActionP = null;

    let successCount = 0;
    for (const id of ids) {
        const ok = await updateParticipantStatus(id, status);
        if (ok) successCount++;
    }
    clearParticipantSelection();
    await loadParticipants();
    updateParticipantStats();
    applyParticipantFilters();

    if (successCount === ids.length) {
        showToast(`${successCount} registration${successCount > 1 ? 's' : ''} updated successfully!`, 'success');
    } else {
        showToast(`${successCount}/${ids.length} updated — some failed, please check and retry.`, 'warning');
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
