/* ══════════════════════════════════════════════════════
   NetworkFP Hub Leader Portal — Complete JavaScript
   Features: Multi-step form, localStorage, Admin CRUD,
             Search/Filter, CSV Export, Toasts, Modals
══════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════ HERO MAP — CITY DATA & PROJECTION ═══════════════════
// MapChart_Map.png calibration (mainland India only; A&N Islands shown as inset by MapChart):
//   lngLeft  68.0°E  → xLeft   7.5%   |   lngRight 97.4°E → xRight 71.5%
//   latTop   37.0°N  → yTop    4.0%   |   latBottom 8.0°N → yBottom 87.0%
//   scale_x = (71.5−7.5)/(97.4−68.0) = 2.18 %/°   scale_y = (87−4)/(37−8) = 2.86 %/°
const _M = { lngL:68.0, xL:7.5, lngR:97.4, xR:71.5, latT:37.0, yT:4.0, latB:8.0, yB:87.0 };

function latlngToPercent(lat, lng) {
    const x = _M.xL + (lng - _M.lngL) / (_M.lngR - _M.lngL) * (_M.xR - _M.xL);
    const y = _M.yT + (_M.latT - lat) / (_M.latT - _M.latB) * (_M.yB - _M.yT);
    return { x: +x.toFixed(2), y: +y.toFixed(2) };
}

const HUB_CITIES = [
    { name:'Chandigarh',  lat:30.73, lng:76.78, delay:1.6, lg:false, lbl:'right' },
    { name:'Delhi NCR',   lat:28.61, lng:77.21, delay:0.0, lg:true,  lbl:'right' },
    { name:'Jaipur',      lat:26.91, lng:75.79, delay:0.5, lg:false, lbl:'left'  },
    { name:'Lucknow',     lat:26.85, lng:80.95, delay:0.9, lg:false, lbl:'right' },
    { name:'Ahmedabad',   lat:23.02, lng:72.57, delay:0.3, lg:false, lbl:'right' },
    { name:'Bhopal',      lat:23.26, lng:77.41, delay:1.8, lg:false, lbl:'right' },
    { name:'Kolkata',     lat:22.57, lng:88.36, delay:0.8, lg:true,  lbl:'left'  },
    { name:'Nagpur',      lat:21.15, lng:79.09, delay:1.2, lg:false, lbl:'right' },
    { name:'Mumbai',      lat:19.08, lng:72.88, delay:0.4, lg:true,  lbl:'left'  },
    { name:'Pune',        lat:18.52, lng:73.86, delay:0.7, lg:false, lbl:'right' },
    { name:'Hyderabad',   lat:17.39, lng:78.49, delay:1.0, lg:true,  lbl:'left'  },
    { name:'Vizag',       lat:17.69, lng:83.30, delay:2.0, lg:false, lbl:'left'  },
    { name:'Bengaluru',   lat:12.97, lng:77.59, delay:0.6, lg:true,  lbl:'left'  },
    { name:'Chennai',     lat:13.08, lng:80.27, delay:0.2, lg:true,  lbl:'right' },
    { name:'Kochi',       lat: 9.93, lng:76.27, delay:1.4, lg:false, lbl:'left'  },
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

// ═══════════════════ SVG MAP — GEOJSON RENDERING ═══════════════════
// viewBox  "0 0 590 650"  covers 68–97.5°E × 8–37°N (India's full extent)
// Equirectangular projection: x = (lng-68)/29.5×590, y = (37-lat)/29×650
// Pin percentages use the same formula ÷ SVG dimensions, so they align exactly.
const SVG_MAP = { W:590, H:650, lngMin:68.0, lngMax:97.5, latMin:8.0, latMax:37.0 };

function svgPt(lng, lat) {
    const x = (lng - SVG_MAP.lngMin) / (SVG_MAP.lngMax - SVG_MAP.lngMin) * SVG_MAP.W;
    const y = (SVG_MAP.latMax - lat) / (SVG_MAP.latMax - SVG_MAP.latMin) * SVG_MAP.H;
    return x.toFixed(1) + ',' + y.toFixed(1);
}

function ringToD(ring) {
    return 'M' + ring.map(([lng, lat]) => svgPt(lng, lat)).join('L') + 'Z';
}

function geomToD(geom) {
    if (geom.type === 'Polygon')
        return geom.coordinates.map(ringToD).join(' ');
    if (geom.type === 'MultiPolygon')
        return geom.coordinates.map(poly => poly.map(ringToD).join(' ')).join(' ');
    return '';
}

async function initSVGMap() {
    const svgEl    = document.getElementById('indiaMapSvg');
    const grp      = document.getElementById('indiaStatesGroup');
    const fallback = document.getElementById('indiaMapFallback');
    if (!svgEl || !grp) { renderHeroMapPins(); return; }

    try {
        const res = await fetch(
            'https://cdn.jsdelivr.net/gh/geohacker/india@master/state/india_state.geojson',
            { cache: 'force-cache' }
        );
        if (!res.ok) throw new Error(res.status);
        const geo = await res.json();

        const NS   = 'http://www.w3.org/2000/svg';
        const frag = document.createDocumentFragment();
        geo.features.forEach(f => {
            if (!f.geometry) return;
            const d = geomToD(f.geometry);
            if (!d) return;
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', d);
            path.classList.add('india-state');
            const name = (f.properties?.NAME_1 || f.properties?.state_name || f.properties?.name || '').trim();
            if (name) path.dataset.state = name;
            frag.appendChild(path);
        });
        grp.appendChild(frag);

        // Align _M so pin x%/y% directly match SVG geographic coordinates
        _M.lngL = SVG_MAP.lngMin;  _M.xL = 0.0;
        _M.lngR = SVG_MAP.lngMax;  _M.xR = 100.0;
        _M.latT = SVG_MAP.latMax;  _M.yT = 0.0;
        _M.latB = SVG_MAP.latMin;  _M.yB = 100.0;

    } catch (err) {
        console.warn('[IndiaMap] GeoJSON unavailable — PNG fallback active:', err.message);
        svgEl.style.display = 'none';
        if (fallback) fallback.style.display = 'block';
        // _M stays as MapChart calibration — correct for the PNG image
    }

    renderHeroMapPins();
}

// ═══════════════════ CONSTANTS ═══════════════════
const ADMIN_EMAIL       = 'admin@networkfp.com';
const ADMIN_PASSWORD    = 'admin123';
const STORAGE_KEY       = 'nfp_hub_registrations';
const PARTICIPANTS_KEY  = 'nfp_participants';
const MODE_KEY          = 'nfp_reg_mode';
const AUTH_KEY          = 'nfp_admin_auth';

// ═══════════════════ STATE ═══════════════════
let currentStep   = 1;
let currentFilter = 'all';
let pendingAction = null;
let pendingRegId  = null;

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
    seedDemoData();
    handleNavbarScroll();
    checkAdminSession();
    bindMobileInputs();
    initGallery();
    initGrowthBar();
    renderHeroMapPins();
});

function initGrowthBar() {
    const bar = document.querySelector('.lh-growth-bar-fill');
    if (!bar) return;
    setTimeout(() => { bar.style.width = bar.dataset.width || '35%'; }, 600);
}

function handleNavbarScroll() {
    const navbar = document.getElementById('navbar');
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 20);
    });
}

function bindMobileInputs() {
    // Only allow digits in mobile & pincode fields
    const mobileEl  = document.getElementById('mobile');
    const pincodeEl = document.getElementById('pincode');
    if (mobileEl) mobileEl.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '');
        clearErr('mobileErr');
    });
    if (pincodeEl) pincodeEl.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '');
        clearErr('pincodeErr');
    });
    // Live clear on valid inputs
    ['fullName','email','area'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => clearErr(id + 'Err'));
    });
    ['city','membership','venueType','capacity'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => clearErr(id + 'Err'));
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
    // Reset nav menu on mobile
    closeMenu();
    // If going to admin dashboard, refresh data
    if (id === 'adminDashboard') {
        updateDashboard();
    }
}

function scrollToFeatures() {
    showSection('landing');
    setTimeout(() => {
        const el = document.getElementById('whatAreHubs');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
}

function scrollToParticipantFeatures() {
    showSection('landing');
    setTimeout(() => {
        const el = document.getElementById('joinAHub');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
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

// ═══════════════════ FORM STEP NAVIGATION ═══════════════════
function goToStep(step) {
    currentStep = step;
    document.getElementById('step1').classList.toggle('hidden', step !== 1);
    document.getElementById('step2').classList.toggle('hidden', step !== 2);
    // Update sidebar checklist
    updateStepIndicator(step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepIndicator(step) {
    const check1 = document.getElementById('rsCheck1');
    const check2 = document.getElementById('rsCheck2');
    const check3 = document.getElementById('rsCheck3');
    const line1  = document.getElementById('rsLine1');
    const line2  = document.getElementById('rsLine2');
    if (!check1) return;
    // Reset all
    [check1, check2, check3].forEach(el => el.classList.remove('active', 'done'));
    [line1, line2].forEach(el => el.classList.remove('active'));
    if (step === 1) {
        check1.classList.add('active');
    } else if (step === 2) {
        check1.classList.add('done');
        check2.classList.add('active');
        line1.classList.add('active');
    }
}

// ═══════════════════ VALIDATION ═══════════════════
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function setErr(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    // Mark input as error
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

function validateStep1() {
    let valid = true;
    const name       = document.getElementById('fullName').value.trim();
    const email      = document.getElementById('email').value.trim();
    const mobile     = document.getElementById('mobile').value.trim();
    const membership = document.getElementById('membership').value;
    // Clear all errors first
    ['fullNameErr','emailErr','mobileErr','membershipErr'].forEach(clearErr);
    if (!name) { setErr('fullNameErr', 'Full name is required.'); valid = false; }
    else if (name.length < 2) { setErr('fullNameErr', 'Please enter a valid name.'); valid = false; }
    if (!email) { setErr('emailErr', 'Email address is required.'); valid = false; }
    else if (!isValidEmail(email)) { setErr('emailErr', 'Please enter a valid email address.'); valid = false; }
    if (!mobile) { setErr('mobileErr', 'Mobile number is required.'); valid = false; }
    else if (!/^\d{10}$/.test(mobile)) { setErr('mobileErr', 'Mobile number must be exactly 10 digits.'); valid = false; }
    if (!membership) { setErr('membershipErr', 'Please select your membership type.'); valid = false; }
    if (valid) goToStep(2);
    else shakeFirstError();
    return valid;
}

function validateStep2() {
    let valid = true;
    const city      = document.getElementById('city').value.trim();
    const area      = document.getElementById('area').value.trim();
    const address   = document.getElementById('address').value.trim();
    const pincode   = document.getElementById('pincode').value.trim();
    const venueType = document.getElementById('venueType').value;
    const capacity  = document.getElementById('capacity').value;
    ['cityErr','areaErr','addressErr','pincodeErr','venueTypeErr','capacityErr'].forEach(clearErr);
    if (!city) { setErr('cityErr', 'City is required.'); valid = false; }
    if (!area) { setErr('areaErr', 'Area / Locality is required.'); valid = false; }
    if (!address) { setErr('addressErr', 'Full address is required so participants can find you.'); valid = false; }
    if (!pincode) { setErr('pincodeErr', 'PIN Code is required.'); valid = false; }
    else if (!/^\d{6}$/.test(pincode)) { setErr('pincodeErr', 'PIN Code must be exactly 6 digits.'); valid = false; }
    if (!venueType) { setErr('venueTypeErr', 'Please select a venue type.'); valid = false; }
    if (!capacity) { setErr('capacityErr', 'Please select hosting capacity.'); valid = false; }
    if (valid) submitRegistration();
    else shakeFirstError();
    return valid;
}

function shakeFirstError() {
    const errEl = document.querySelector('.err-msg:not(:empty)');
    if (errEl) {
        const input = errEl.previousElementSibling || errEl.parentElement.querySelector('.form-input');
        if (input) {
            input.style.animation = 'none';
            setTimeout(() => {
                input.style.animation = 'shake .4s ease';
                input.focus();
            }, 10);
        }
    }
}

// Add shake animation dynamically
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
@keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-6px)}
    40%{transform:translateX(6px)}
    60%{transform:translateX(-4px)}
    80%{transform:translateX(4px)}
}`;
document.head.appendChild(shakeStyle);

// ═══════════════════ REGISTRATION SUBMISSION ═══════════════════
function generateRegId() {
    const now    = new Date();
    const year   = now.getFullYear();
    const month  = String(now.getMonth() + 1).padStart(2, '0');
    const day    = String(now.getDate()).padStart(2, '0');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `NFP-HUB-${year}${month}${day}-${random}`;
}

function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function submitRegistration() {
    const hostedEl    = document.querySelector('input[name="hostedBefore"]:checked');
    const freqEl      = document.querySelector('input[name="hostingFrequency"]:checked');
    const reg = {
        id:               generateRegId(),
        submittedAt:      new Date().toISOString(),
        status:           'Pending',
        fullName:         document.getElementById('fullName').value.trim(),
        email:            document.getElementById('email').value.trim(),
        mobile:           document.getElementById('mobile').value.trim(),
        membership:       document.getElementById('membership').value,
        city:             document.getElementById('city').value.trim(),
        area:             document.getElementById('area').value.trim(),
        address:          document.getElementById('address').value.trim(),
        pincode:          document.getElementById('pincode').value.trim(),
        venueType:        document.getElementById('venueType').value,
        capacity:         document.getElementById('capacity').value,
        hostedBefore:     hostedEl ? hostedEl.value : 'No',
        hostingFrequency: freqEl   ? freqEl.value   : 'One Time Only',
    };
    // Save to localStorage
    const registrations = getRegistrations();
    registrations.unshift(reg);
    saveRegistrations(registrations);
    // Show success
    showSuccessScreen(reg);
    // Reset form for next use
    resetForm();
    // Geocode area + city for precise map pin (async, non-blocking)
    geocodeHub(reg).then(coords => {
        if (!coords) return;
        const regs = getRegistrations();
        const idx  = regs.findIndex(r => r.id === reg.id);
        if (idx !== -1) {
            regs[idx].lat = coords[0];
            regs[idx].lng = coords[1];
            saveRegistrations(regs);
        }
    });
}

function showSuccessScreen(reg) {
    const el = document.getElementById('successDetails');
    el.innerHTML = `
        <div class="sd-row">
            <span class="sd-label">Registration ID</span>
            <span class="sd-value sd-reg-id">${reg.id}</span>
        </div>
        <div class="sd-row">
            <span class="sd-label">Applicant Name</span>
            <span class="sd-value">${escHtml(reg.fullName)}</span>
        </div>
        <div class="sd-row">
            <span class="sd-label">Email</span>
            <span class="sd-value">${escHtml(reg.email)}</span>
        </div>
        <div class="sd-row">
            <span class="sd-label">City</span>
            <span class="sd-value">${escHtml(reg.city)}</span>
        </div>
        <div class="sd-row">
            <span class="sd-label">Membership</span>
            <span class="sd-value">${escHtml(reg.membership)}</span>
        </div>
        <div class="sd-row">
            <span class="sd-label">Application Date</span>
            <span class="sd-value">${formatDate(reg.submittedAt)}</span>
        </div>
        <div class="sd-row">
            <span class="sd-label">Status</span>
            <span class="sd-value"><span class="badge badge-pending">Pending Approval</span></span>
        </div>
    `;
    showSection('success');
    goToStep(1);
    showToast('Application submitted successfully!', 'success');
}

function resetForm() {
    ['fullName','email','mobile','city','area','pincode'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ['membership','venueType','capacity'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const hostedNo = document.getElementById('hostedNo');
    if (hostedNo) hostedNo.checked = true;
    ['fullNameErr','emailErr','mobileErr','membershipErr','cityErr','areaErr','pincodeErr','venueTypeErr','capacityErr'].forEach(clearErr);
    goToStep(1);
}

function resetAndRegister() {
    resetForm();
    showSection('registration');
}

// ═══════════════════ LOCAL STORAGE ═══════════════════
function getRegistrations() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
}

function saveRegistrations(regs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(regs));
}

function updateRegistrationStatus(id, status) {
    const regs = getRegistrations();
    const idx  = regs.findIndex(r => r.id === id);
    if (idx !== -1) {
        regs[idx].status = status;
        regs[idx].lastUpdated = new Date().toISOString();
        saveRegistrations(regs);
        return true;
    }
    return false;
}

// ═══════════════════ SEED DEMO DATA ═══════════════════
function seedDemoData() {
    if (getRegistrations().length > 0) return; // don't seed if data exists
    const names  = ['Rajesh Kumar','Priya Sharma','Ankit Gupta','Meena Patel','Suresh Iyer','Divya Nair','Amit Verma','Sunita Joshi','Vikram Singh','Pooja Mehta','Rahul Desai','Kavita Reddy'];
    const cities = ['Mumbai','Bangalore','Delhi','Pune','Chennai','Hyderabad','Ahmedabad','Kolkata','Jaipur','Indore'];
    const areas     = ['Andheri West','Koramangala','Connaught Place','Baner','Anna Nagar','Banjara Hills','Navrangpura','Park Street','C-Scheme','Vijay Nagar'];
    const addresses = [
        'Office 12, Infinity IT Park, Andheri West',
        '45 Koramangala 4th Block, Near Forum Mall',
        'Suite 302, Statesman House, Connaught Place',
        'Plot 9, Baner Road, Near Balewadi Stadium',
        '22 Anna Nagar 2nd Avenue, Near CMBT',
        'Flat 5A, Jubilee Hills Road No. 36, Banjara Hills',
        'Office 201, Abhijeet Complex, Navrangpura',
        '14B Park Street, Near Park Hotel',
        'B-12 C-Scheme, Near SMS Hospital',
        '33 Vijay Nagar Square, AB Road',
    ];
    const memberships = ['QPFP Certificant','CFP Professional','ProMember','Both CFP & QPFP'];
    const venues      = ['Home','Own Office','Co-working Space','AMC Office','Society Clubhouse'];
    const capacities  = ['Up to 6 People','6-10 People','10-20 People','More than 20 People'];
    const statuses    = ['Pending','Approved','Rejected','Pending','Approved','Approved'];
    const frequencies = ['One Time Only','Multiple Times','Open to Either'];
    const demo = names.map((name, i) => ({
        id:           `NFP-HUB-2024${String(11-i).padStart(2,'0')}15-${1000+i*73}`,
        submittedAt:  new Date(Date.now() - i * 24 * 60 * 60 * 1000 * 2).toISOString(),
        status:       statuses[i % statuses.length],
        fullName:     name,
        email:        name.toLowerCase().replace(' ', '.') + '@email.com',
        mobile:       `9${String(800000000 + i * 1111111).slice(0,9)}`,
        membership:   memberships[i % memberships.length],
        city:         cities[i % cities.length],
        area:         areas[i % areas.length],
        pincode:      String(400001 + i * 111),
        venueType:    venues[i % venues.length],
        capacity:     capacities[i % capacities.length],
        address:          addresses[i % addresses.length],
        hostedBefore:     i % 3 === 0 ? 'Yes' : 'No',
        hostingFrequency: frequencies[i % frequencies.length],
    }));
    saveRegistrations(demo);
}

// ═══════════════════ ADMIN AUTH ═══════════════════
function adminLogin() {
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
    if (email === ADMIN_EMAIL && pass === ADMIN_PASSWORD) {
        sessionStorage.setItem(AUTH_KEY, 'true');
        showSection('adminDashboard');
        updateDashboard();
        showToast('Welcome back, Admin!', 'success');
    } else {
        setErr('adminPasswordErr', 'Incorrect email or password. Please try again.');
        passEl.value = '';
        passEl.focus();
        showToast('Login failed. Check your credentials.', 'error');
    }
}

function adminLogout() {
    openConfirmModal(
        'Sign Out',
        'Are you sure you want to sign out of the admin portal?',
        '🚪',
        () => {
            sessionStorage.removeItem(AUTH_KEY);
            showSection('landing');
            showToast('You have been signed out.', 'info');
        }
    );
}

function checkAdminSession() {
    if (sessionStorage.getItem(AUTH_KEY) === 'true') {
        const landing = document.getElementById('landing');
        const dash    = document.getElementById('adminDashboard');
        const current = document.querySelector('.page.active');
        if (current && current.id === 'adminDashboard') {
            updateDashboard();
        }
    }
}

function togglePassword() {
    const passEl = document.getElementById('adminPassword');
    passEl.type = passEl.type === 'password' ? 'text' : 'password';
}

// ═══════════════════ ADMIN DASHBOARD ═══════════════════
function updateDashboard() {
    updateStats();
    applyFilters();
    if (document.getElementById('tabAnalytics') && !document.getElementById('tabAnalytics').classList.contains('hidden')) {
        renderAnalytics();
    }
}

function updateStats() {
    const regs     = getRegistrations();
    const total    = regs.length;
    const pending  = regs.filter(r => r.status === 'Pending').length;
    const approved = regs.filter(r => r.status === 'Approved').length;
    const rejected = regs.filter(r => r.status === 'Rejected').length;
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
function showAdminTab(tab, linkEl) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.add('hidden'));
    document.querySelectorAll('.sb-link').forEach(l => l.classList.remove('active'));
    const targetTab = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (targetTab) targetTab.classList.remove('hidden');
    if (linkEl) linkEl.classList.add('active');
    const title = document.getElementById('adminPageTitle');
    if (title) title.textContent = tab === 'applications' ? 'Applications' : 'Analytics';
    if (tab === 'analytics') renderAnalytics();
    // Close sidebar on mobile
    closeSidebar();
}

// ═══════════════════ TABLE RENDERING ═══════════════════
function applyFilters() {
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    const clear  = document.getElementById('searchClear');
    if (clear) clear.classList.toggle('visible', search.length > 0);
    let regs = getRegistrations();
    // Status filter
    if (currentFilter !== 'all') regs = regs.filter(r => r.status === currentFilter);
    // Search filter
    if (search) {
        regs = regs.filter(r =>
            r.fullName.toLowerCase().includes(search) ||
            r.email.toLowerCase().includes(search) ||
            r.city.toLowerCase().includes(search) ||
            r.id.toLowerCase().includes(search)
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
            <td class="td-name" style="min-width:140px">${escHtml(r.fullName)}</td>
            <td class="td-email" style="min-width:180px">${escHtml(r.email)}</td>
            <td>${escHtml(r.mobile)}</td>
            <td>${escHtml(r.membership)}</td>
            <td>${escHtml(r.city)}</td>
            <td>${escHtml(r.area)}</td>
            <td style="max-width:180px;white-space:normal;font-size:12px">${escHtml(r.address || '—')}</td>
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

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ═══════════════════ ADMIN ACTIONS ═══════════════════
function confirmApprove(id) {
    const regs = getRegistrations();
    const reg  = regs.find(r => r.id === id);
    if (!reg) return;
    pendingRegId  = id;
    pendingAction = 'approve';
    openConfirmModal(
        'Approve Application',
        `Approve the application from <strong>${escHtml(reg.fullName)}</strong> (${escHtml(reg.city)})? This will grant them Hub Leader status.`,
        '✅',
        executeApprove,
        'Approve'
    );
}

function confirmReject(id) {
    const regs = getRegistrations();
    const reg  = regs.find(r => r.id === id);
    if (!reg) return;
    pendingRegId  = id;
    pendingAction = 'reject';
    openConfirmModal(
        'Reject Application',
        `Reject the application from <strong>${escHtml(reg.fullName)}</strong>? This action can be reversed later.`,
        '❌',
        executeReject,
        'Reject',
        true
    );
}

function executeApprove() {
    if (!pendingRegId) return;
    const ok = updateRegistrationStatus(pendingRegId, 'Approved');
    if (ok) {
        showToast('Application approved successfully!', 'success');
        updateDashboard();
    }
    closeConfirmModal();
    pendingRegId = null;
}

function executeReject() {
    if (!pendingRegId) return;
    const ok = updateRegistrationStatus(pendingRegId, 'Rejected');
    if (ok) {
        showToast('Application has been rejected.', 'warning');
        updateDashboard();
    }
    closeConfirmModal();
    pendingRegId = null;
}

function viewDetails(id) {
    const regs = getRegistrations();
    const reg  = regs.find(r => r.id === id);
    if (!reg) return;
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
            <h4>Hub / Venue Details</h4>
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
                    <span>${reg.hostedBefore}</span>
                </div>
                <div class="detail-item">
                    <label>Willing to Host LocalHub</label>
                    <span>${escHtml(reg.hostingFrequency || '—')}</span>
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

// ═══════════════════ CSV EXPORT ═══════════════════
function exportCSV() {
    const regs = getRegistrations();
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
    link.download = `NFP_HubLeader_Applications_${ts}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${regs.length} records to CSV.`, 'success');
}

// ═══════════════════ ANALYTICS ═══════════════════
function renderAnalytics() {
    const regs = getRegistrations();
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
    // Simple CSS donut
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
//  REGISTRATION MODE TOGGLE
// ═══════════════════════════════════════════════════════════════

function getRegistrationMode() {
    return localStorage.getItem(MODE_KEY) || 'hub-leader';
}

function setRegistrationMode(mode) {
    localStorage.setItem(MODE_KEY, mode);
    updateModeUI(mode);
    applyModeToBanner(mode);
    showToast(
        mode === 'participant'
            ? 'Participant registration mode is now active on the public site.'
            : 'Hub Leader registration mode is now active.',
        'success'
    );
}

function updateModeUI(mode) {
    const leaderBtn  = document.getElementById('rmb-leader');
    const partBtn    = document.getElementById('rmb-participant');
    const statusDot  = document.getElementById('rmbStatusDot');
    const statusText = document.getElementById('rmbStatusText');
    const desc       = document.getElementById('rmbDesc');

    if (leaderBtn) leaderBtn.classList.toggle('active', mode === 'hub-leader');
    if (partBtn)   partBtn.classList.toggle('active', mode === 'participant');

    if (mode === 'participant') {
        if (statusDot)  statusDot.style.background  = '#60A5FA';
        if (statusText) statusText.textContent = 'Participant mode active';
        if (desc)       desc.textContent = 'Participants can find & join hubs';
    } else {
        if (statusDot)  statusDot.style.background  = var_primary();
        if (statusText) statusText.textContent = 'Hub Leader mode active';
        if (desc)       desc.textContent = 'Hub leaders can register';
    }

    // Update navbar CTA button
    const navBtn = document.getElementById('navCtaBtn');
    if (navBtn) {
        if (mode === 'participant') {
            navBtn.textContent = 'Find a Hub';
            navBtn.onclick = () => showSection('participantReg');
        } else {
            navBtn.textContent = 'Become a Hub Leader';
            navBtn.onclick = () => scrollToSection('becomeLeader');
        }
    }
    // Hide "Become a Leader" nav link in participant mode (it scrolls to a hidden section)
    const navBecomeLeaderLink = document.getElementById('navBecomeLeaderLink');
    if (navBecomeLeaderLink) {
        navBecomeLeaderLink.style.display = mode === 'participant' ? 'none' : '';
    }
    // Update nav Register link label
    const navRegLink = document.getElementById('navRegisterLink');
    if (navRegLink) {
        navRegLink.textContent = mode === 'participant' ? 'Find a Hub' : 'Register';
    }
    // Update footer register link
    const footerRegLink = document.getElementById('footerRegisterLink');
    if (footerRegLink) {
        footerRegLink.textContent = mode === 'participant' ? 'Find a Hub Near You' : 'Register as Hub Leader';
    }
}

function var_primary() { return '#E05B25'; }

function handleNavCta() {
    const mode = getRegistrationMode();
    if (mode === 'participant') {
        showSection('participantReg');
    } else {
        showSection('registration');
    }
}

// Route any "Register" action to the correct section based on active mode.
// If the user is already on the hub-leader registration form, never redirect them away.
function handleRegisterClick() {
    const activeId = document.querySelector('.page.active')?.id;
    if (activeId === 'registration') {
        // Already on hub-leader form — just close mobile menu and stay
        closeMenu();
        return;
    }
    const mode = getRegistrationMode();
    if (mode === 'participant') {
        showSection('participantReg');
    } else {
        showSection('registration');
    }
    closeMenu();
}

function applyModeToBanner(mode) {
    // Swap landing page content blocks
    const hubContent  = document.getElementById('hubLeaderContent');
    const partContent = document.getElementById('participantContent');
    if (hubContent)  hubContent.style.display  = mode === 'participant' ? 'none'  : 'block';
    if (partContent) partContent.style.display = mode === 'participant' ? 'block' : 'none';

    // Hide hub-leader-only sections in participant mode
    const becomeLeader = document.getElementById('becomeLeader');
    if (becomeLeader) becomeLeader.style.display = mode === 'participant' ? 'none' : '';

    // Mode indicator banner
    let banner = document.getElementById('modeBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'modeBanner';
        banner.className = 'mode-banner';
        document.body.appendChild(banner);
    }
    if (mode === 'participant') {
        banner.innerHTML = `
            &#128100; <strong>Participant Mode</strong> is active &mdash; the site now shows member-focused content.
            <button onclick="showSection('participantReg')">View Hub Finder</button>
        `;
        banner.classList.add('visible');
    } else {
        banner.classList.remove('visible');
    }
}

function initModeOnLoad() {
    const mode = getRegistrationMode();
    updateModeUI(mode);
    applyModeToBanner(mode);
}

// ═══════════════════════════════════════════════════════════════
//  CITY COORDINATES (India)
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

// Geocode a hub using full address → area → city, trying most specific query first
async function geocodeHub(hub) {
    // Build queries from most to least specific
    const queries = [];
    if (hub.address) queries.push(`${hub.address}, ${hub.city}, India`);
    queries.push(`${hub.area}, ${hub.city}, India`);
    queries.push(`${hub.city}, India`);

    for (const query of queries) {
        try {
            const res  = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=in`,
                { headers: { 'Accept': 'application/json' } }
            );
            const data = await res.json();
            if (data && data.length > 0) {
                return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
            }
        } catch (e) { /* try next query */ }
        await new Promise(r => setTimeout(r, 300)); // small delay between fallback attempts
    }
    return null;
}

// Geocode all hubs that don't have precise coords yet (rate-limited to 1 req/sec per Nominatim policy)
async function geocodeUnlocatedHubs() {
    const regs   = getRegistrations();
    const toCode = regs.filter(r =>
        (r.status === 'Approved' || r.status === 'Pending') && !r.lat
    );
    if (!toCode.length) return;
    let changed = false;
    for (const hub of toCode) {
        const coords = await geocodeHub(hub);
        if (coords) {
            const idx = regs.findIndex(r => r.id === hub.id);
            if (idx !== -1) {
                regs[idx].lat = coords[0];
                regs[idx].lng = coords[1];
                changed = true;
            }
        }
        await new Promise(res => setTimeout(res, 1100)); // 1 req/sec limit
    }
    if (changed) {
        saveRegistrations(regs);
        refreshMapMarkers();
    }
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
        geocodeUnlocatedHubs();
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
    geocodeUnlocatedHubs();

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

function refreshMapMarkers() {
    if (!leafletMap) return;
    hubMarkers.forEach(m => leafletMap.removeLayer(m));
    hubMarkers = [];

    // Show Approved and Pending hubs; Rejected are hidden
    allApprovedHubs = getRegistrations().filter(r => r.status === 'Approved' || r.status === 'Pending');
    filteredHubs    = [...allApprovedHubs];

    const badge = document.getElementById('mapCountBadge');
    if (badge) badge.textContent = `${allApprovedHubs.length} hub${allApprovedHubs.length !== 1 ? 's' : ''}`;

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

function buildHubPopupHTML(hub) {
    const isPending = hub.status === 'Pending';
    return `
        <div class="hub-popup">
            <div class="hp-header">&#127968; ${escHtml(hub.fullName)}'s Hub
                ${isPending ? '<span class="hp-pending-badge">Opening Soon</span>' : ''}
            </div>
            <div class="hp-body">
                <div class="hp-row"><span class="hp-icon">📍</span><span>${escHtml(hub.address || hub.area)}, ${escHtml(hub.city)}</span></div>
                <div class="hp-row"><span class="hp-icon">🏠</span><span>${escHtml(hub.venueType)}</span></div>
                <div class="hp-row"><span class="hp-icon">👥</span><span>${escHtml(hub.capacity)}</span></div>
                <div class="hp-row"><span class="hp-icon">🎓</span><span>${escHtml(hub.membership)}</span></div>
            </div>
            ${isPending
                ? '<div class="hp-pending-note">This hub is awaiting NFP approval. Registration will open shortly.</div>'
                : `<button class="hp-btn" onclick="selectHubById('${escHtml(hub.id)}')">Register at This Hub &rarr;</button>`
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
    if (badge) badge.textContent = `${filteredHubs.length} hub${filteredHubs.length !== 1 ? 's' : ''}`;
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
    const m = { 'Up to 6 People': 1, '6-10 People': 2, '10-20 People': 3, 'More than 20 People': 4 };
    return m[cap] || 99;
}

function renderHubCards(hubs) {
    const el       = document.getElementById('hubCardsList');
    const countPill = document.getElementById('hubCountPill');
    if (!el) return;
    if (countPill) countPill.textContent = hubs.length;
    if (!hubs.length) {
        el.innerHTML = `<div class="no-hubs-msg"><div style="font-size:36px">🗺️</div><p>No approved hubs found${document.getElementById('hubCitySearch')?.value ? ' for this search' : ' yet'}. Check back soon!</p></div>`;
        return;
    }
    el.innerHTML = hubs.map(hub => {
        const isPending  = hub.status === 'Pending';
        const isSelected = hub.id === selectedHubId;
        return `
        <div class="hub-card-item${isSelected ? ' selected' : ''}${isPending ? ' pending-hub' : ''}"
             id="hubcard-${escHtml(hub.id)}"
             onclick="${isPending ? '' : `highlightHubOnMap('${escHtml(hub.id)}')`}">
            <div class="hci-top">
                <div>
                    <div class="hci-name">&#127968; ${escHtml(hub.fullName)}'s Hub</div>
                    <div class="hci-city">📍 ${escHtml(hub.address ? hub.address + ', ' + hub.city : hub.area + ', ' + hub.city)}</div>
                </div>
                <span class="hci-badge${isPending ? ' hci-badge-pending' : ''}">
                    ${isPending ? 'Opening Soon' : 'Open'}
                </span>
            </div>
            <div class="hci-details">
                <span class="hci-tag">🏠 ${escHtml(hub.venueType)}</span>
                <span class="hci-tag">👥 ${escHtml(hub.capacity)}</span>
                <span class="hci-tag">🎓 ${escHtml(hub.membership)}</span>
            </div>
            ${isPending
                ? '<div class="hci-pending-note">Awaiting NFP approval — check back soon</div>'
                : `<button class="hci-btn" onclick="event.stopPropagation(); selectHubById('${escHtml(hub.id)}')">
                    Register at This Hub &rarr;
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

// Called only from "Register at This Hub" button — shows the form
function selectHubById(hubId) {
    const hub = allApprovedHubs.find(h => h.id === hubId);
    if (!hub) return;
    if (hub.status === 'Pending') return;
    // Show registration form panel
    const regPanel = document.getElementById('regFormPanel');
    const hubCard  = document.getElementById('selectedHubCard');

    if (regPanel) regPanel.classList.remove('hidden');

    if (hubCard) {
        hubCard.innerHTML = `
            <div class="shc-label">You're registering at</div>
            <div class="shc-name">&#127968; ${escHtml(hub.fullName)}'s Hub</div>
            <div class="shc-detail">📍 ${escHtml(hub.area)}, ${escHtml(hub.city)} &mdash; ${escHtml(hub.venueType)}</div>
            <div class="shc-tags">
                <span class="shc-tag">👥 ${escHtml(hub.capacity)}</span>
                <span class="shc-tag">🎓 ${escHtml(hub.membership)}</span>
                ${hub.hostedBefore === 'Yes' ? '<span class="shc-tag">✅ Experienced Host</span>' : ''}
            </div>
            <button class="shc-change" onclick="deselectHub()">↩ Change Hub</button>
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
    filteredHubs = [...allApprovedHubs];
    hubMarkers.forEach(m => m.setOpacity(1));
    renderHubCards(filteredHubs);
    const badge = document.getElementById('mapCountBadge');
    if (badge) badge.textContent = `${allApprovedHubs.length} hub${allApprovedHubs.length !== 1 ? 's' : ''}`;
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

            // Find closest hub
            let closest = null, minDist = Infinity;
            allApprovedHubs.forEach(hub => {
                const coords = getHubCoords(hub);
                if (!coords) return;
                const dist = Math.hypot(coords[0] - latitude, coords[1] - longitude);
                if (dist < minDist) { minDist = dist; closest = hub; }
            });

            if (closest) {
                showToast(`Nearest hub found in ${closest.city}!`, 'success');
                setTimeout(() => selectHubById(closest.id), 800);
            } else {
                showToast('No hubs near you yet. Check back soon!', 'info');
            }
        },
        () => showToast('Could not get your location. Please allow location access.', 'error')
    );
}

// ═══════════════════════════════════════════════════════════════
//  PARTICIPANT REGISTRATION
// ═══════════════════════════════════════════════════════════════

const PARTICIPANT_STORAGE = PARTICIPANTS_KEY;

function getParticipants() {
    try { return JSON.parse(localStorage.getItem(PARTICIPANT_STORAGE)) || []; }
    catch { return []; }
}

function saveParticipants(list) {
    localStorage.setItem(PARTICIPANT_STORAGE, JSON.stringify(list));
}

function generateParticipantId() {
    const now    = new Date();
    const y      = now.getFullYear();
    const m      = String(now.getMonth() + 1).padStart(2, '0');
    const d      = String(now.getDate()).padStart(2, '0');
    const rnd    = Math.floor(1000 + Math.random() * 9000);
    return `NFP-PART-${y}${m}${d}-${rnd}`;
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
        showToast('Please select a hub from the map or list first.', 'warning');
        valid = false;
    }
    return valid;
}

function submitParticipant() {
    if (!validateParticipantForm()) return;

    const hub  = allApprovedHubs.find(h => h.id === selectedHubId);
    if (!hub) { showToast('Selected hub not found. Please choose again.', 'error'); return; }

    const note = document.getElementById('pNote')?.value.trim() || '';
    const participant = {
        id:           generateParticipantId(),
        registeredAt: new Date().toISOString(),
        status:       'Confirmed',
        fullName:     document.getElementById('pName').value.trim(),
        email:        document.getElementById('pEmail').value.trim(),
        mobile:       document.getElementById('pMobile').value.trim(),
        membership:   document.getElementById('pMembership').value,
        note:         note,
        hubId:        hub.id,
        hubLeader:    hub.fullName,
        hubCity:      hub.city,
        hubArea:      hub.area,
        hubVenue:     hub.venueType,
    };

    const list = getParticipants();
    list.unshift(participant);
    saveParticipants(list);

    showParticipantSuccess(participant, hub);
    resetParticipantForm();
}

function showParticipantSuccess(p, hub) {
    const el = document.getElementById('pSuccessDetails');
    if (el) {
        el.innerHTML = `
            <div class="sd-row"><span class="sd-label">Participant ID</span><span class="sd-value sd-reg-id">${p.id}</span></div>
            <div class="sd-row"><span class="sd-label">Your Name</span><span class="sd-value">${escHtml(p.fullName)}</span></div>
            <div class="sd-row"><span class="sd-label">Hub Leader</span><span class="sd-value">${escHtml(hub.fullName)}</span></div>
            <div class="sd-row"><span class="sd-label">Hub Location</span><span class="sd-value">${escHtml(hub.area)}, ${escHtml(hub.city)}</span></div>
            <div class="sd-row"><span class="sd-label">Venue Type</span><span class="sd-value">${escHtml(hub.venueType)}</span></div>
            <div class="sd-row"><span class="sd-label">Registered On</span><span class="sd-value">${formatDate(p.registeredAt)}</span></div>
            <div class="sd-row"><span class="sd-label">Status</span><span class="sd-value"><span class="badge badge-approved">Confirmed</span></span></div>
        `;
    }
    showSection('participantSuccess');
    showToast('You are successfully registered at this hub!', 'success');
}

function resetParticipantForm() {
    ['pName','pEmail','pMobile','pNote'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const pm = document.getElementById('pMembership');
    if (pm) pm.value = '';
    selectedHubId = null;
    document.getElementById('regFormPanel')?.classList.add('hidden');
    if (leafletMap) {
        hubMarkers.forEach(m => m.setIcon(createHubPinIcon(false, m._isPending)));
    }
    renderHubCards(filteredHubs);
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN — PARTICIPANT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

let currentPFilter = 'all';

function updateParticipantStats() {
    const parts     = getParticipants();
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

    let parts = getParticipants();
    if (currentPFilter !== 'all') parts = parts.filter(p => p.status === currentPFilter);
    if (q) parts = parts.filter(p =>
        p.fullName.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.hubCity.toLowerCase().includes(q) ||
        p.hubLeader.toLowerCase().includes(q)
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
            <td class="td-name">${escHtml(p.fullName)}</td>
            <td class="td-email">${escHtml(p.email)}</td>
            <td>${escHtml(p.mobile)}</td>
            <td>${escHtml(p.membership)}</td>
            <td class="td-name">${escHtml(p.hubLeader)}'s Hub</td>
            <td>${escHtml(p.hubCity)}</td>
            <td>${escHtml(p.hubArea)}</td>
            <td style="max-width:160px;white-space:normal;font-size:12px;color:var(--muted)">${escHtml(p.note || '—')}</td>
            <td>${formatDate(p.registeredAt)}</td>
            <td>${participantStatusBadge(p.status)}</td>
            <td>
                <div class="action-btns">
                    ${p.status !== 'Cancelled'
                        ? `<button class="act-btn act-reject" onclick="cancelParticipant('${escHtml(p.id)}')">Cancel</button>`
                        : `<button class="act-btn act-approve" onclick="reinstateParticipant('${escHtml(p.id)}')">Reinstate</button>`
                    }
                    <button class="act-btn act-view" onclick="viewParticipantDetails('${escHtml(p.id)}')">View</button>
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

function cancelParticipant(id) {
    openConfirmModal(
        'Cancel Registration',
        'Are you sure you want to cancel this participant registration?',
        '❌',
        () => {
            const parts = getParticipants();
            const idx   = parts.findIndex(p => p.id === id);
            if (idx !== -1) { parts[idx].status = 'Cancelled'; saveParticipants(parts); }
            showToast('Registration cancelled.', 'warning');
            updateParticipantStats();
            applyParticipantFilters();
        },
        'Cancel Registration',
        true
    );
}

function reinstateParticipant(id) {
    const parts = getParticipants();
    const idx   = parts.findIndex(p => p.id === id);
    if (idx !== -1) { parts[idx].status = 'Confirmed'; saveParticipants(parts); }
    showToast('Participant reinstated.', 'success');
    updateParticipantStats();
    applyParticipantFilters();
}

function viewParticipantDetails(id) {
    const p   = getParticipants().find(p => p.id === id);
    if (!p) return;
    const hub = getRegistrations().find(r => r.id === p.hubId);
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
            <h4>Hub Details</h4>
            <div class="detail-grid">
                <div class="detail-item"><label>Hub Leader</label><span>${escHtml(p.hubLeader)}</span></div>
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
    const parts = getParticipants();
    if (!parts.length) { showToast('No participant data to export.', 'warning'); return; }
    const headers = ['Participant ID','Full Name','Email','Mobile','Membership','Hub Leader','Hub City','Hub Area','Hub Venue','Note','Registration Date','Status'];
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
//  PATCH EXISTING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// Override showSection to init map when participant page is shown
const _origShowSection = showSection;
showSection = function(id) {
    _origShowSection(id);
    if (id === 'participantReg') {
        setTimeout(() => {
            initMap();
            const mobileInput = document.getElementById('pMobile');
            if (mobileInput && !mobileInput._boundDigit) {
                mobileInput.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g,''); });
                mobileInput._boundDigit = true;
            }
        }, 100);
    }
};

// Override showAdminTab to handle participants tab
const _origShowAdminTab = showAdminTab;
showAdminTab = function(tab, linkEl) {
    _origShowAdminTab(tab, linkEl);
    if (tab === 'participants') {
        updateParticipantStats();
        applyParticipantFilters();
    }
};

// Override updateDashboard to include participant stats
const _origUpdateDashboard = updateDashboard;
updateDashboard = function() {
    _origUpdateDashboard();
    updateParticipantStats();
};

// Init mode on page load
document.addEventListener('DOMContentLoaded', () => {
    initModeOnLoad();
    initTableScrollFade();
});

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
        // Run once on load and whenever content changes (use a small delay to let table render)
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
