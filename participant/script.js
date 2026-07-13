/* ══════════════════════════════════════════════════════
   NFP Circles — Participant Site JavaScript
   Features: Circle Finder Map, PIN-code Proximity Search,
             Participant Registration, Toasts
══════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════ API CONFIG ═══════════════════
// Empty string = same origin. On Vercel the pages and the API share one domain,
// so requests go to /api/... directly (no CORS). For local testing against the
// backend on another port, set this to e.g. 'http://localhost:4000'.
const API_BASE = '';

// ═══════════════════ HERO MAP — CITY DATA & PROJECTION ═══════════════════
// MapChart_Map.png calibration anchored on the Kolkata star marker (88.36°E → x≈68.8%)
// and Saurashtra western tip (68.2°E → x≈8.1%); Kanyakumari tip (8.08°N → y≈92.7%):
//   lngLeft  68.0°E  → xLeft   7.5%   |   lngRight 97.4°E → xRight 96.0%
//   latTop   37.0°N  → yTop    4.0%   |   latBottom 8.0°N → yBottom 87.0%
//   scale_x = (96.0−7.5)/(97.4−68.0) = 3.01 %/°   scale_y = (87−4)/(37−8) = 2.86 %/°
const _M = { lngL:68.0, xL:7.5, lngR:97.4, xR:96.0, latT:37.0, yT:4.0, latB:8.0, yB:87.0 };

function latlngToPercent(lat, lng) {
    const x = _M.xL + (lng - _M.lngL) / (_M.lngR - _M.lngL) * (_M.xR - _M.xL);
    const y = _M.yT + (_M.latT - lat) / (_M.latT - _M.latB) * (_M.yB - _M.yT);
    return { x: +x.toFixed(2), y: +y.toFixed(2) };
}

const HUB_CITIES = [
    { name:'Chandigarh' , lat:28.35, lng:77.26, delay:1.6, lg:false, lbl:'right'  },
    { name:'Delhi NCR'  , lat:26.42, lng:77.08, delay:0.0, lg:true , lbl:'right'  },
    { name:'Jaipur'     , lat:24.11, lng:75.94, delay:0.5, lg:false, lbl:'left'  },
    { name:'Lucknow'    , lat:24.53, lng:80.74, delay:0.9, lg:false, lbl:'right'  },
    { name:'Ahmedabad'  , lat:20.50, lng:71.50, delay:0.3, lg:false, lbl:'left'  },
    { name:'Bhopal'     , lat:20.50, lng:76.66, delay:1.8, lg:false, lbl:'right'  },
    { name:'Kolkata'    , lat:20.50, lng:88.72, delay:0.8, lg:true , lbl:'left'  },
    { name:'Nagpur'     , lat:18.25, lng:78.46, delay:1.2, lg:false, lbl:'right'  },
    { name:'Mumbai'     , lat:15.99, lng:71.80, delay:0.4, lg:true , lbl:'left'  },
    { name:'Pune'       , lat:15.84, lng:73.06, delay:0.7, lg:false, lbl:'right'  },
    { name:'Hyderabad'  , lat:14.89, lng:78.64, delay:1.0, lg:true , lbl:'left'  },
    { name:'Vizag'      , lat:14.89, lng:83.50, delay:2.0, lg:false, lbl:'left'  },
    { name:'Bengaluru'  , lat: 9.97, lng:77.44, delay:0.6, lg:true , lbl:'left'  },
    { name:'Chennai'    , lat:10.23, lng:80.32, delay:0.2, lg:true , lbl:'right'  },
    { name:'Kochi'      , lat: 6.83, lng:75.52, delay:1.4, lg:false, lbl:'left'  }
];

function renderHeroMapPins() {
    const container = document.getElementById('heroMapPins');
    if (!container) return;
    container.innerHTML = HUB_CITIES.map(c => {
        const { x, y } = latlngToPercent(c.lat, c.lng);
        const dot = c.lg ? 'map-pin-dot map-pin-dot--lg' : 'map-pin-dot';
        return `<div class="map-pin" style="left:${x}%;top:${y}%">` +
               `<div class="map-pin-pulse" style="animation-delay:${c.delay}s"></div>` +
               `<div class="${dot}"></div>` +
               `<span class="map-pin-label lbl-${c.lbl}">${c.name}</span>` +
               `</div>`;
    }).join('');
}

// ═══════════════════ STATE ═══════════════════
let pendingAction = null;

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
    handleNavbarScroll();
    bindMobileInputs();
    initGallery();
    renderHeroMapPins();
    loadParticipantFormState();
});

function handleNavbarScroll() {
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 20);
    });
}

function bindMobileInputs() {
    // Live clear on valid inputs (none required pre-fill on this site, kept for parity/safety)
}

// ═══════════════════ PAGE NAVIGATION ═══════════════════
function showSection(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    // Reset nav menu on mobile
    closeMenu();
    if (id === 'participantReg') {
        setTimeout(() => {
            initMap();
            const mobileInput = document.getElementById('pMobile');
            if (mobileInput && !mobileInput._boundDigit) {
                mobileInput.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g,''); });
                mobileInput.addEventListener('blur', () => checkParticipantDuplicate('mobile'));
                mobileInput._boundDigit = true;
            }
            const emailInput = document.getElementById('pEmail');
            if (emailInput && !emailInput._boundBlur) {
                emailInput.addEventListener('blur', () => checkParticipantDuplicate('email'));
                emailInput.addEventListener('input', () => {
                    const el = document.getElementById('pEmailErr');
                    if (el) el.textContent = '';
                    emailInput.classList.remove('error');
                });
                emailInput._boundBlur = true;
            }
        }, 100);
    }
}

function scrollToSection(sectionId) {
    if (!document.getElementById('landing').classList.contains('active')) {
        showSection('landing');
    }
    setTimeout(() => {
        const el = document.getElementById(sectionId);
        if (el) {
            const navH = document.getElementById('navbar').offsetHeight || 90;
            const top = el.getBoundingClientRect().top + window.pageYOffset - navH;
            window.scrollTo({ top, behavior: 'smooth' });
        }
    }, 50);
}

// ═══════════════════ GALLERY CAROUSEL ═══════════════════
let galleryIndex = 0;
let galleryTotal = 0;
let galleryAutoplay = null;

function initGallery() {
    const track = document.getElementById('galleryTrack');
    const dotsEl = document.getElementById('galleryDots');
    if (!track || !dotsEl) return;

    galleryTotal = track.querySelectorAll('.lh-gallery-slide').length;
    if (galleryTotal === 0) return;

    dotsEl.innerHTML = '';
    for (let i = 0; i < galleryTotal; i++) {
        const dot = document.createElement('button');
        dot.className = 'lh-gallery-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
        dot.addEventListener('click', () => goToSlide(i));
        dotsEl.appendChild(dot);
    }

    goToSlide(0);
    startGalleryAutoplay();
}

function goToSlide(idx) {
    const track = document.getElementById('galleryTrack');
    if (!track) return;
    galleryIndex = (idx + galleryTotal) % galleryTotal;
    track.style.transform = 'translateX(-' + (galleryIndex * 100) + '%)';
    document.querySelectorAll('.lh-gallery-dot').forEach((d, i) => {
        d.classList.toggle('active', i === galleryIndex);
    });
}

function galleryNext() {
    goToSlide(galleryIndex + 1);
    resetGalleryAutoplay();
}

function galleryPrev() {
    goToSlide(galleryIndex - 1);
    resetGalleryAutoplay();
}

function startGalleryAutoplay() {
    galleryAutoplay = setInterval(() => galleryNext(), 4500);
}

function resetGalleryAutoplay() {
    clearInterval(galleryAutoplay);
    startGalleryAutoplay();
}

// ═══════════════════ NAVBAR MOBILE ═══════════════════
function toggleMenu() {
    const hamburger = document.getElementById('hamburger');
    const navMenu   = document.getElementById('navMenu');
    hamburger.classList.toggle('open');
    navMenu.classList.toggle('open');
}

function closeMenu() {
    document.getElementById('hamburger').classList.remove('open');
    document.getElementById('navMenu').classList.remove('open');
}

// ═══════════════════ VALIDATION HELPERS ═══════════════════
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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

// "City - Circle Leader Name" — used wherever a circle's display name is shown.
function circleName(hub) {
    return `${escHtml(hub.city)} - ${escHtml(hub.fullName)}`;
}

// Structured address line — "Street/Area, City - PIN Code" — used wherever a
// circle's location is shown. Falls back to Area when no street address was
// given, and omits the PIN code segment only if it's genuinely missing.
function formatHubAddress(hub) {
    const streetOrArea = hub.address || hub.area || '';
    const line = [streetOrArea, hub.city].filter(Boolean).map(escHtml).join(', ');
    return hub.pincode ? `${line} - ${escHtml(hub.pincode)}` : line;
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

// ═══════════════════════════════════════════════════════════════
//  CITY COORDINATES (India) — fallback for hubs without precise lat/lng
// ═══════════════════════════════════════════════════════════════

const CITY_COORDS = {
    'Mumbai':        [19.0760,  72.8777],
    'Bangalore':     [12.9716,  77.5946],
    'Bengaluru':     [12.9716,  77.5946],
    'Delhi':         [28.6139,  77.2090],
    'New Delhi':     [28.6139,  77.2090],
    'Pune':          [18.5204,  73.8567],
    'Chennai':       [13.0827,  80.2707],
    'Hyderabad':     [17.3850,  78.4867],
    'Ahmedabad':     [23.0225,  72.5714],
    'Kolkata':       [22.5726,  88.3639],
    'Jaipur':        [26.9124,  75.7873],
    'Indore':        [22.7196,  75.8577],
    'Surat':         [21.1702,  72.8311],
    'Surendranagar': [22.7167,  71.6500],
    'Lucknow':       [26.8467,  80.9462],
    'Nagpur':        [21.1458,  79.0882],
    'Bhopal':        [23.2599,  77.4126],
    'Patna':         [25.5941,  85.1376],
    'Coimbatore':    [11.0168,  76.9558],
    'Kochi':         [ 9.9312,  76.2673],
    'Chandigarh':    [30.7333,  76.7794],
    'Vadodara':      [22.3072,  73.1812],
    'Agra':          [27.1767,  78.0081],
    'Nashik':        [19.9975,  73.7898],
    'Mysore':        [12.2958,  76.6394],
    'Mysuru':        [12.2958,  76.6394],
    'Jodhpur':       [26.2389,  73.0243],
    'Raipur':        [21.2514,  81.6296],
    'Visakhapatnam': [17.6868,  83.2185],
    'Vijayawada':    [16.5062,  80.6480],
    'Rajkot':        [22.3039,  70.8022],
    'Ludhiana':      [30.9010,  75.8573],
    'Amritsar':      [31.6340,  74.8723],
    'Varanasi':      [25.3176,  82.9739],
    'Meerut':        [28.9845,  77.7064],
    'Thane':         [19.2183,  72.9781],
    'Navi Mumbai':   [19.0330,  73.0297],
    'Aurangabad':    [19.8762,  75.3433],
    'Gurgaon':       [28.4595,  77.0266],
    'Gurugram':      [28.4595,  77.0266],
    'Noida':         [28.5355,  77.3910],
    'Faridabad':     [28.4089,  77.3178],
    'Bhubaneswar':   [20.2961,  85.8245],
    'Guwahati':      [26.1445,  91.7362],
    'Mangalore':     [12.9141,  74.8560],
    'Thiruvananthapuram': [8.5241, 76.9366],
};

function getCityCoords(city) {
    if (!city) return null;
    const key = Object.keys(CITY_COORDS).find(k =>
        k.toLowerCase() === city.toLowerCase().trim()
    );
    return key ? CITY_COORDS[key] : null;
}

// Returns stored precise coords first, falls back to city-centre lookup
function getHubCoords(hub) {
    if (hub.lat && hub.lng) return [hub.lat, hub.lng];
    return getCityCoords(hub.city);
}

// ═══════════════════════════════════════════════════════════════
//  MAP — LEAFLET
// ═══════════════════════════════════════════════════════════════

let leafletMap      = null;
let hubMarkers      = [];
let selectedHubId   = null;
let allApprovedHubs = [];
let filteredHubs    = [];

function initMap() {
    if (!window.L) { console.warn('Leaflet not loaded'); return; }

    if (leafletMap) {
        leafletMap.invalidateSize();
        refreshMapMarkers();
        return;
    }

    leafletMap = L.map('hubMap', {
        center:          [20.5937, 78.9629],
        zoom:            5,
        zoomControl:     true,
        scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
    }).addTo(leafletMap);

    refreshMapMarkers();

    // Fix size after container becomes visible
    setTimeout(() => leafletMap.invalidateSize(), 300);
}

function createHubPinIcon(isSelected, isPending) {
    const cls = isSelected ? ' selected-pin' : (isPending ? ' pending-pin' : '');
    return L.divIcon({
        html: `<div class="hub-pin${cls}"><span class="hub-pin-inner">&#127968;</span></div>`,
        className: '',
        iconSize:   [38, 38],
        iconAnchor: [19, 38],
        popupAnchor:[0, -42],
    });
}

// Fetch hubs from the backend API (replaces localStorage-based getRegistrations())
async function fetchHubs() {
    try {
        const res = await fetch(`${API_BASE}/api/hubs?status=Approved,Pending`);
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.warn('Could not load Circles from the server:', err);
        showToast('Could not load Circles. Please check your connection and try again.', 'error');
        return [];
    }
}

async function refreshMapMarkers() {
    if (!leafletMap) return;
    hubMarkers.forEach(m => leafletMap.removeLayer(m));
    hubMarkers = [];

    // Show Approved and Pending hubs; Rejected are hidden (server already filters by status param,
    // but we defensively filter again in case the API returns extra statuses)
    const hubs = await fetchHubs();
    allApprovedHubs = hubs.filter(r => r.status === 'Approved' || r.status === 'Pending');
    filteredHubs    = [...allApprovedHubs];

    const badge = document.getElementById('mapCountBadge');
    if (badge) badge.textContent = `${allApprovedHubs.length} circle${allApprovedHubs.length !== 1 ? 's' : ''}`;

    const placed = new Map();

    allApprovedHubs.forEach(hub => {
        const coords = getHubCoords(hub);
        if (!coords) return;
        const count = placed.get(hub.city) || 0;
        placed.set(hub.city, count + 1);
        const angle  = count * (Math.PI * 2 / 6);
        const radius = count === 0 ? 0 : 0.04 + count * 0.015;
        const lat    = coords[0] + Math.sin(angle) * radius;
        const lng    = coords[1] + Math.cos(angle) * radius;

        const isPending = hub.status === 'Pending';
        const marker = L.marker([lat, lng], {
            icon: createHubPinIcon(hub.id === selectedHubId, isPending),
        });
        marker.addTo(leafletMap);
        marker.bindPopup(buildHubPopupHTML(hub), { maxWidth: 280, minWidth: 260 });
        marker.on('click', () => { highlightHubCard(hub.id); });
        marker._hubId    = hub.id;
        marker._isPending = isPending;
        hubMarkers.push(marker);
    });

    renderHubCards(filteredHubs);
}

function getHubSpotsInfo(hub) {
    const limit = parseInt(hub.capacity, 10);
    if (isNaN(limit) || limit <= 0) return { isFull: false, spotsLabel: hub.capacity };
    const taken = hub.participantCount || 0;
    const left = limit - taken;
    if (left <= 0) return { isFull: true, spotsLabel: 'Full' };
    return { isFull: false, spotsLabel: `${left} spot${left === 1 ? '' : 's'} left` };
}

function buildHubPopupHTML(hub) {
    const isPending = hub.status === 'Pending';
    const { isFull, spotsLabel } = getHubSpotsInfo(hub);
    return `
        <div class="hub-popup">
            <div class="hp-header">${circleName(hub)}
                ${isPending ? '<span class="hp-pending-badge">Opening Soon</span>' : ''}
                ${!isPending && isFull ? '<span class="hp-pending-badge" style="background:#ef4444">Full</span>' : ''}
            </div>
            <div class="hp-body">
                <div class="hp-row"><span>${formatHubAddress(hub)}</span></div>
                <div class="hp-row"><span>${escHtml(hub.venueType)}</span></div>
                <div class="hp-row"><span>${escHtml(spotsLabel)}</span></div>
                <div class="hp-row"><span>${escHtml(hub.membership)}</span></div>
            </div>
            ${isPending
                ? '<div class="hp-pending-note">This Circle is awaiting NFP approval. Registration will open shortly.</div>'
                : isFull
                    ? '<div class="hp-pending-note" style="color:#ef4444">This Circle is fully booked.</div>'
                    : `<button class="hp-btn" onclick="selectHubById('${escHtml(hub.id)}')">Join This Circle &rarr;</button>`
            }
        </div>
    `;
}

function filterHubs() {
    const q = (document.getElementById('hubCitySearch')?.value || '').toLowerCase().trim();
    if (!q) {
        filteredHubs = [...allApprovedHubs];
    } else {
        filteredHubs = allApprovedHubs.filter(h =>
            h.city.toLowerCase().includes(q) ||
            h.area.toLowerCase().includes(q) ||
            h.fullName.toLowerCase().includes(q)
        );
    }
    // Dim non-matching markers on map
    hubMarkers.forEach(m => {
        const hub   = allApprovedHubs.find(h => h.id === m._hubId);
        const match = !q || filteredHubs.includes(hub);
        if (m._icon) m._icon.style.opacity = match ? '1' : '.25';
        else m.setOpacity(match ? 1 : 0.25);
    });
    const badge = document.getElementById('mapCountBadge');
    if (badge) badge.textContent = `${filteredHubs.length} circle${filteredHubs.length !== 1 ? 's' : ''}`;
    renderHubCards(filteredHubs);

    // If exactly one city matches, zoom there
    if (filteredHubs.length > 0) {
        const coords = getHubCoords(filteredHubs[0]);
        if (coords && leafletMap) leafletMap.flyTo(coords, 11, { duration: 1.2 });
    }
}

function sortAndRenderHubs() {
    const sortBy = document.getElementById('hubSortBy')?.value || 'city';
    const sorted = [...filteredHubs].sort((a, b) => {
        if (sortBy === 'name')     return a.fullName.localeCompare(b.fullName);
        if (sortBy === 'capacity') return capacityOrder(a.capacity) - capacityOrder(b.capacity);
        return a.city.localeCompare(b.city);
    });
    renderHubCards(sorted);
}

function capacityOrder(cap) {
    // New capacities are definitive numbers like "5 People" .. "15 People",
    // so sort by the leading integer. Falls back for any legacy range labels.
    const n = parseInt(cap, 10);
    if (Number.isFinite(n)) return n;
    const legacy = { 'Up to 6 People': 6, '6-10 People': 10, '10-20 People': 20, 'More than 20 People': 21 };
    return legacy[cap] || 99;
}

// renderHubCards optionally shows a distance badge per hub when hub.distanceKm is present.
function renderHubCards(hubs) {
    const el       = document.getElementById('hubCardsList');
    const countPill = document.getElementById('hubCountPill');
    if (!el) return;
    if (countPill) countPill.textContent = hubs.length;
    if (!hubs.length) {
        el.innerHTML = `<div class="no-hubs-msg"><p>No approved Circles found${document.getElementById('hubCitySearch')?.value ? ' for this search' : ' yet'}. Check back soon!</p></div>`;
        return;
    }
    el.innerHTML = hubs.map(hub => {
        const isPending  = hub.status === 'Pending';
        const isSelected = hub.id === selectedHubId;
        const hasDistance = typeof hub.distanceKm === 'number';
        const { isFull, spotsLabel } = getHubSpotsInfo(hub);
        const badgeText = isPending ? 'Opening Soon' : isFull ? 'Full' : 'Open';
        const badgeStyle = isFull && !isPending ? ' style="background:#ef4444;color:#fff"' : '';
        return `
        <div class="hub-card-item${isSelected ? ' selected' : ''}${isPending ? ' pending-hub' : ''}"
             id="hubcard-${escHtml(hub.id)}"
             onclick="${isPending || isFull ? '' : `highlightHubOnMap('${escHtml(hub.id)}')`}">
            <div class="hci-top">
                <div>
                    <div class="hci-name">${circleName(hub)}</div>
                    <div class="hci-city">${formatHubAddress(hub)}</div>
                </div>
                <span class="hci-badge${isPending ? ' hci-badge-pending' : ''}"${badgeStyle}>
                    ${escHtml(badgeText)}
                </span>
            </div>
            <div class="hci-details">
                <span class="hci-tag">${escHtml(hub.venueType)}</span>
                <span class="hci-tag">${escHtml(spotsLabel)}</span>
                <span class="hci-tag">${escHtml(hub.membership)}</span>
                ${hasDistance ? `<span class="hci-tag hci-distance-tag">${hub.distanceKm.toFixed(1)} km away</span>` : ''}
            </div>
            ${isPending
                ? '<div class="hci-pending-note">Awaiting NFP approval — check back soon</div>'
                : isFull
                    ? '<div class="hci-pending-note" style="color:#ef4444">This Circle is fully booked.</div>'
                    : `<button class="hci-btn" onclick="event.stopPropagation(); selectHubById('${escHtml(hub.id)}')">
                        Join This Circle &rarr;
                       </button>`
            }
        </div>`;
    }).join('');
}

// Pan map to hub and highlight card — does NOT open the form
function highlightHubOnMap(hubId) {
    const hub = allApprovedHubs.find(h => h.id === hubId);
    if (!hub || hub.status === 'Pending') return;
    selectedHubId = hubId;
    hubMarkers.forEach(m => m.setIcon(createHubPinIcon(m._hubId === hubId, m._isPending)));
    renderHubCards(filteredHubs);
    const coords = getHubCoords(hub);
    if (coords && leafletMap) leafletMap.flyTo(coords, 14, { duration: 1 });
}

// Called from map marker click — highlight card and pan, no form
function highlightHubCard(hubId) {
    highlightHubOnMap(hubId);
    const card = document.getElementById(`hubcard-${hubId}`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Called only from "Join This Circle" button — shows the form
function selectHubById(hubId) {
    const hub = allApprovedHubs.find(h => h.id === hubId);
    if (!hub) return;
    if (hub.status === 'Pending') return;
    selectedHubId = hubId;
    hubMarkers.forEach(m => m.setIcon(createHubPinIcon(m._hubId === hubId, m._isPending)));
    // Show registration form panel
    const regPanel = document.getElementById('regFormPanel');
    const hubCard  = document.getElementById('selectedHubCard');

    if (regPanel) regPanel.classList.remove('hidden');

    if (hubCard) {
        hubCard.innerHTML = `
            <div class="shc-label">You're registering at</div>
            <div class="shc-name">${circleName(hub)}</div>
            <div class="shc-detail">${formatHubAddress(hub)} &mdash; ${escHtml(hub.venueType)}</div>
            <div class="shc-tags">
                <span class="shc-tag">${escHtml(hub.capacity)}</span>
                <span class="shc-tag">${escHtml(hub.membership)}</span>
                ${hub.hostedBefore === 'Yes' ? '<span class="shc-tag">Experienced Host</span>' : ''}
            </div>
            <button class="shc-change" onclick="deselectHub()">↩ Change Circle</button>
        `;
    }

    // Scroll to form
    setTimeout(() => regPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

    // Pan map to hub
    const coords = getHubCoords(hub);
    if (coords && leafletMap) leafletMap.flyTo(coords, 14, { duration: 1 });
}

function deselectHub() {
    selectedHubId = null;
    document.getElementById('regFormPanel')?.classList.add('hidden');
    hubMarkers.forEach(m => m.setIcon(createHubPinIcon(false, m._isPending)));
    renderHubCards(filteredHubs);
}

function resetMapView() {
    if (leafletMap) leafletMap.flyTo([20.5937, 78.9629], 5, { duration: 1.2 });
    const searchEl = document.getElementById('hubCitySearch');
    if (searchEl) searchEl.value = '';
    const sortEl = document.getElementById('hubSortBy');
    if (sortEl) sortEl.value = 'city';
    filteredHubs = [...allApprovedHubs];
    hubMarkers.forEach(m => m.setOpacity(1));
    renderHubCards(filteredHubs);
    const badge = document.getElementById('mapCountBadge');
    if (badge) badge.textContent = `${allApprovedHubs.length} circle${allApprovedHubs.length !== 1 ? 's' : ''}`;
}

// Approximate distance between two lat/lng points, in kilometers (Haversine formula).
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearMe() {
    if (!navigator.geolocation) {
        showToast('Geolocation is not supported by your browser.', 'warning');
        return;
    }
    showToast('Detecting your location...', 'info');
    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude, longitude } = pos.coords;
            if (leafletMap) leafletMap.flyTo([latitude, longitude], 11, { duration: 1.5 });

            // Compute distance to every hub and refresh the list, nearest first —
            // mirrors the live-update behaviour of the city/area search box.
            const withDistance = allApprovedHubs
                .map(hub => {
                    const coords = getHubCoords(hub);
                    if (!coords) return null;
                    return { ...hub, distanceKm: haversineKm(latitude, longitude, coords[0], coords[1]) };
                })
                .filter(Boolean)
                .sort((a, b) => a.distanceKm - b.distanceKm);

            if (withDistance.length === 0) {
                showToast('No Circles near you yet. Check back soon!', 'info');
                return;
            }

            // Clear the city/area text search so it doesn't conflict visually.
            const citySearchEl = document.getElementById('hubCitySearch');
            if (citySearchEl) citySearchEl.value = '';

            filteredHubs = withDistance;
            renderHubCards(filteredHubs);
            const badge = document.getElementById('mapCountBadge');
            if (badge) badge.textContent = `${filteredHubs.length} circle${filteredHubs.length !== 1 ? 's' : ''}`;

            const closest = withDistance[0];
            showToast(`Nearest Circle found in ${closest.city}!`, 'success');
            setTimeout(() => selectHubById(closest.id), 800);
        },
        () => showToast('Could not get your location. Please allow location access.', 'error')
    );
}

// ═══════════════════════════════════════════════════════════════
//  PARTICIPANT REGISTRATION
// ═══════════════════════════════════════════════════════════════

function setPartErr(fieldId, msg) {
    const errEl   = document.getElementById(fieldId + 'Err');
    const inputEl = document.getElementById(fieldId);
    if (errEl)   errEl.textContent = msg;
    if (inputEl) inputEl.classList.toggle('error', !!msg);
}

// Check a single field for duplicate registrations. Called on blur so the user
// sees "Email ID already registered!" immediately below the field — no toast popup.
async function checkParticipantDuplicate(field) {
    const email  = document.getElementById('pEmail')?.value.trim()  || '';
    const mobile = document.getElementById('pMobile')?.value.trim() || '';
    if (field === 'email'  && (!email  || !isValidEmail(email)))  return;
    if (field === 'mobile' && !/^\d{10}$/.test(mobile))           return;
    try {
        const params = new URLSearchParams();
        if (field === 'email')  params.set('email',  email);
        if (field === 'mobile') params.set('mobile', mobile);
        const res = await fetch(`${API_BASE}/api/participants/check?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        if (field === 'email'  && data.emailExists)  setPartErr('pEmail',  'Email ID already registered!');
        if (field === 'mobile' && data.mobileExists) setPartErr('pMobile', 'Mobile number already registered!');
    } catch (e) { /* network error — silently ignore, server will catch on submit */ }
}

function validateParticipantForm() {
    let valid = true;
    const name       = document.getElementById('pName')?.value.trim() || '';
    const email      = document.getElementById('pEmail')?.value.trim() || '';
    const mobile     = document.getElementById('pMobile')?.value.trim() || '';
    const membership = document.getElementById('pMembership')?.value || '';

    ['pNameErr','pEmailErr','pMobileErr','pMembershipErr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
        const inputId = id.replace('Err','');
        document.getElementById(inputId)?.classList.remove('error');
    });

    if (!name || name.length < 2) {
        document.getElementById('pNameErr').textContent = 'Full name is required.';
        document.getElementById('pName')?.classList.add('error');
        valid = false;
    }
    if (!email || !isValidEmail(email)) {
        document.getElementById('pEmailErr').textContent = 'Please enter a valid email.';
        document.getElementById('pEmail')?.classList.add('error');
        valid = false;
    }
    if (!mobile || !/^\d{10}$/.test(mobile)) {
        document.getElementById('pMobileErr').textContent = 'Mobile must be exactly 10 digits.';
        document.getElementById('pMobile')?.classList.add('error');
        valid = false;
    }
    if (!membership) {
        document.getElementById('pMembershipErr').textContent = 'Please select your membership type.';
        document.getElementById('pMembership')?.classList.add('error');
        valid = false;
    }
    if (!selectedHubId) {
        showToast('Please select a Circle from the map or list first.', 'warning');
        valid = false;
    }
    return valid;
}

// Guard against double submission: ignore extra clicks while a request is in flight.
let participantSubmitting = false;

async function submitParticipant() {
    if (participantSubmitting) return;
    if (!validateParticipantForm()) return;

    const hub = allApprovedHubs.find(h => h.id === selectedHubId);
    if (!hub) { showToast('Selected Circle not found. Please choose again.', 'error'); return; }

    participantSubmitting = true;
    const submitBtn = document.getElementById('participantSubmitBtn');
    const originalLabel = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Registering…';
    }

    const note = document.getElementById('pNote')?.value.trim() || '';
    const payload = {
        fullName:   document.getElementById('pName').value.trim(),
        email:      document.getElementById('pEmail').value.trim(),
        mobile:     document.getElementById('pMobile').value.trim(),
        membership: document.getElementById('pMembership').value,
        note:       note,
        hubId:      hub.id,
    };

    let participant;
    try {
        const res = await fetch(`${API_BASE}/api/participants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
            // Duplicate email/mobile — show inline below the relevant field(s).
            try {
                const email  = document.getElementById('pEmail').value.trim();
                const mobile = document.getElementById('pMobile').value.trim();
                const ck = await fetch(`${API_BASE}/api/participants/check?email=${encodeURIComponent(email)}&mobile=${encodeURIComponent(mobile)}`);
                if (ck.ok) {
                    const d = await ck.json();
                    if (d.emailExists)  setPartErr('pEmail',  'Email ID already registered!');
                    if (d.mobileExists) setPartErr('pMobile', 'Mobile number already registered!');
                } else {
                    setPartErr('pEmail', 'Email or mobile already registered!');
                }
            } catch (e) {
                setPartErr('pEmail', 'Email or mobile already registered!');
            }
            return;
        }
        if (!res.ok) {
            showToast(body.error || 'Could not complete your registration. Please try again.', 'error');
            return;
        }
        participant = body;
    } catch (err) {
        console.warn('Participant registration failed:', err);
        showToast('Could not reach the server. Please check your connection and try again.', 'error');
        return;
    } finally {
        // Restore the label and re-apply the declaration gate (don't blindly enable).
        participantSubmitting = false;
        if (submitBtn) submitBtn.innerHTML = originalLabel;
        updateParticipantSubmitGate();
    }

    showParticipantSuccess(participant);
    resetParticipantForm();
}

// Whether the admin currently has Circle registrations open.
let participantFormOpen = true;

async function loadParticipantFormState() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (res.ok) { const s = await res.json(); participantFormOpen = s.participantFormOpen !== false; }
    } catch (e) { /* assume open if settings can't be read */ }
    const banner = document.getElementById('participantClosedBanner');
    if (banner) banner.style.display = participantFormOpen ? 'none' : 'block';
    updateParticipantSubmitGate();
}

// Enable Confirm only when registrations are open AND both declaration checkboxes are ticked.
function updateParticipantSubmitGate() {
    const btn = document.getElementById('participantSubmitBtn');
    if (!btn) return;
    const ok = participantFormOpen
        && document.getElementById('pDecl1')?.checked
        && document.getElementById('pDecl2')?.checked;
    btn.disabled = !ok;
}

function showParticipantSuccess(p) {
    const el = document.getElementById('pSuccessDetails');
    if (el) {
        el.innerHTML = `
            <div class="sd-row"><span class="sd-label">Participant ID</span><span class="sd-value sd-reg-id">${escHtml(p.id)}</span></div>
            <div class="sd-row"><span class="sd-label">Your Name</span><span class="sd-value">${escHtml(p.fullName)}</span></div>
            <div class="sd-row"><span class="sd-label">Circle Host</span><span class="sd-value">${escHtml(p.hubLeader)}</span></div>
            <div class="sd-row"><span class="sd-label">Circle Location</span><span class="sd-value">${escHtml(p.hubArea)}, ${escHtml(p.hubCity)}</span></div>
            <div class="sd-row"><span class="sd-label">Venue Type</span><span class="sd-value">${escHtml(p.hubVenue)}</span></div>
            <div class="sd-row"><span class="sd-label">Registered On</span><span class="sd-value">${formatDate(p.registeredAt || Date.now())}</span></div>
            <div class="sd-row"><span class="sd-label">Status</span><span class="sd-value"><span class="badge badge-approved">Confirmed</span></span></div>
        `;
    }
    document.getElementById('participantSuccessOverlay').classList.add('visible');
    showToast('You are successfully registered at this Circle!', 'success');
}

function closeParticipantSuccessModal() {
    document.getElementById('participantSuccessOverlay').classList.remove('visible');
}

function resetParticipantForm() {
    ['pName','pEmail','pMobile','pNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const pm = document.getElementById('pMembership');
    if (pm) pm.value = '';
    // Reset declaration checkboxes and re-lock the submit button.
    ['pDecl1','pDecl2'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    updateParticipantSubmitGate();
    selectedHubId = null;
    document.getElementById('regFormPanel')?.classList.add('hidden');
    if (leafletMap) {
        hubMarkers.forEach(m => m.setIcon(createHubPinIcon(false, m._isPending)));
    }
    renderHubCards(filteredHubs);
}
