/* ══════════════════════════════════════════════════════
   NFP Circles — Hub Leader Site JavaScript
   Features: Multi-step host application form, API submission,
             Gallery carousel, Toasts, Hero map pins
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
let currentStep = 1;

// ═══════════════════ INIT ═══════════════════
document.addEventListener('DOMContentLoaded', () => {
    handleNavbarScroll();
    bindMobileInputs();
    initGallery();
    initGrowthBar();
    renderHeroMapPins();
    loadHubFormState();
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

// Show/hide the "specify your venue" text field when "Other" is chosen.
function toggleVenueOther() {
    const sel   = document.getElementById('venueType');
    const other = document.getElementById('venueOther');
    if (!sel || !other) return;
    const show = sel.value === 'Other';
    other.style.display = show ? 'block' : 'none';
    if (!show) { other.value = ''; clearErr('venueOtherErr'); }
}

// Whether the admin currently has the Hub Leader application form open.
let hubFormOpen = true;

async function loadHubFormState() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        if (res.ok) { const s = await res.json(); hubFormOpen = s.hubFormOpen !== false; }
    } catch (e) { /* assume open if settings can't be read */ }
    const banner = document.getElementById('hubClosedBanner');
    if (banner) banner.style.display = hubFormOpen ? 'none' : 'block';
    updateHubSubmitGate();
}

// Enable Submit only when the form is open AND both declaration checkboxes are ticked.
function updateHubSubmitGate() {
    const btn = document.getElementById('hubSubmitBtn');
    if (!btn) return;
    const ok = hubFormOpen
        && document.getElementById('hubDecl1')?.checked
        && document.getElementById('hubDecl2')?.checked;
    btn.disabled = !ok;
}

function validateStep2() {
    let valid = true;
    const city      = document.getElementById('city').value.trim();
    const area      = document.getElementById('area').value.trim();
    const address   = document.getElementById('address').value.trim();
    const pincode   = document.getElementById('pincode').value.trim();
    const venueType = document.getElementById('venueType').value;
    const venueOther = document.getElementById('venueOther').value.trim();
    const capacity  = document.getElementById('capacity').value;
    ['cityErr','areaErr','addressErr','pincodeErr','venueTypeErr','venueOtherErr','capacityErr'].forEach(clearErr);
    if (!city) { setErr('cityErr', 'City is required.'); valid = false; }
    if (!area) { setErr('areaErr', 'Area / Locality is required.'); valid = false; }
    if (!address) { setErr('addressErr', 'Full address is required so participants can find you.'); valid = false; }
    if (!pincode) { setErr('pincodeErr', 'PIN Code is required.'); valid = false; }
    else if (!/^\d{6}$/.test(pincode)) { setErr('pincodeErr', 'PIN Code must be exactly 6 digits.'); valid = false; }
    if (!venueType) { setErr('venueTypeErr', 'Please select a venue type.'); valid = false; }
    else if (venueType === 'Other' && !venueOther) { setErr('venueOtherErr', 'Please specify your venue.'); valid = false; }
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
function formatDate(date) {
    const d = new Date(date);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Guard against double submission: once a submit is in flight, ignore further
// clicks until it finishes. This is what prevents the same hub registering twice.
let hubSubmitting = false;

async function submitRegistration() {
    if (hubSubmitting) return;
    hubSubmitting = true;

    const submitBtn = document.getElementById('hubSubmitBtn');
    const originalLabel = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'Submitting…';
    }

    const hostedEl = document.querySelector('input[name="hostedBefore"]:checked');
    const freqEl   = document.querySelector('input[name="hostingFrequency"]:checked');
    const payload = {
        fullName:         document.getElementById('fullName').value.trim(),
        email:            document.getElementById('email').value.trim(),
        mobile:           document.getElementById('mobile').value.trim(),
        membership:       document.getElementById('membership').value,
        city:             document.getElementById('city').value.trim(),
        area:             document.getElementById('area').value.trim(),
        address:          document.getElementById('address').value.trim(),
        pincode:          document.getElementById('pincode').value.trim(),
        venueType:        (document.getElementById('venueType').value === 'Other'
                            ? (document.getElementById('venueOther').value.trim() || 'Other')
                            : document.getElementById('venueType').value),
        capacity:         document.getElementById('capacity').value,
        hostedBefore:     hostedEl ? hostedEl.value : 'No',
        hostingFrequency: freqEl   ? freqEl.value   : 'One Time Only',
    };

    try {
        const res = await fetch(`${API_BASE}/api/hubs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.status !== 201) {
            showToast('Could not submit your application — please try again.', 'error');
            return;
        }
        const hub = await res.json();
        showSuccessScreen(hub);
        resetForm();
    } catch (err) {
        showToast('Could not submit your application — please try again.', 'error');
    } finally {
        // Always restore the button label and release the guard, so a genuine retry works.
        // Re-apply the declaration gate rather than blindly enabling.
        hubSubmitting = false;
        if (submitBtn) submitBtn.innerHTML = originalLabel;
        updateHubSubmitGate();
    }
}

function showSuccessScreen(reg) {
    const el = document.getElementById('successDetails');
    el.innerHTML = `
        <div class="sd-row">
            <span class="sd-label">Registration ID</span>
            <span class="sd-value sd-reg-id">${escHtml(reg.id)}</span>
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
            <span class="sd-value">${formatDate(reg.submittedAt || Date.now())}</span>
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
    // Reset venue "Other" field and the declaration checkboxes, then re-lock submit.
    const venueOther = document.getElementById('venueOther');
    if (venueOther) { venueOther.value = ''; venueOther.style.display = 'none'; }
    ['hubDecl1','hubDecl2'].forEach(id => { const el = document.getElementById(id); if (el) el.checked = false; });
    ['fullNameErr','emailErr','mobileErr','membershipErr','cityErr','areaErr','pincodeErr','venueTypeErr','venueOtherErr','capacityErr'].forEach(clearErr);
    updateHubSubmitGate();
    goToStep(1);
}

function resetAndRegister() {
    resetForm();
    showSection('registration');
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

function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
