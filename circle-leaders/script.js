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

// ═══════════════════ HERO MAP — CITY PIN POSITIONS ═══════════════════
// Positions are direct x/y percentages of the map image (Images/MapChart_Map.png),
// NOT lat/lng run through a projection — that indirection was fragile (every
// time the map image got replaced, all 15 pins needed hand recalibration).
// Same image and coordinates as the participant site, for a matching map.
const HUB_CITIES = [
    { name:'Chandigarh', x:34.57, y:24.03, delay:1.6, lg:false, lbl:'right' },
    { name:'Delhi NCR', x:36.74, y:30.99, delay:0, lg:true, lbl:'right' },
    { name:'Jaipur', x:30.22, y:36.36, delay:0.5, lg:false, lbl:'left' },
    { name:'Lucknow', x:49.57, y:36.65, delay:0.9, lg:false, lbl:'right' },
    { name:'Ahmedabad', x:19.13, y:46.23, delay:0.3, lg:false, lbl:'left' },
    { name:'Bhopal', x:38.04, y:45.21, delay:1.8, lg:false, lbl:'right' },
    { name:'Kolkata', x:71.74, y:46.52, delay:0.8, lg:true, lbl:'left' },
    { name:'Nagpur', x:43.7, y:52.32, delay:1.2, lg:false, lbl:'right' },
    { name:'Mumbai', x:18.04, y:56.53, delay:0.4, lg:true, lbl:'left' },
    { name:'Pune', x:21.3, y:58.85, delay:0.7, lg:false, lbl:'right' },
    { name:'Hyderabad', x:37.1, y:68.24, delay:1, lg:true, lbl:'left' },
    { name:'Vizag', x:53.7, y:61.17, delay:2, lg:false, lbl:'left' },
    { name:'Bengaluru', x:33.04, y:72.2, delay:0.6, lg:true, lbl:'left' },
    { name:'Chennai', x:43.48, y:74.52, delay:0.2, lg:true, lbl:'right' },
    { name:'Kochi', x:31.8, y:79.0, delay:1.4, lg:false, lbl:'left' },
];

function renderHeroMapPins() {
    const container = document.getElementById('heroMapPins');
    if (!container) return;
    container.innerHTML = HUB_CITIES.map(c => {
        const dot = c.lg ? 'map-pin-dot map-pin-dot--lg' : 'map-pin-dot';
        return `<div class="map-pin" style="left:${c.x}%;top:${c.y}%">` +
               `<div class="map-pin-pulse" style="animation-delay:${c.delay}s"></div>` +
               `<div class="${dot}"></div>` +
               `<span class="map-pin-label lbl-${c.lbl}">${c.name}</span>` +
               `</div>`;
    }).join('');
}

// ═══════════════════ STATE ═══════════════════
let currentStep = 1;
let hubEmailDuplicate  = false;
let hubMobileDuplicate = false;

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

// handleNavbarScroll, toggleMenu, closeMenu, isValidEmail, formatDate, escHtml,
// showToast now live in shared/common.js (loaded before this file).

function bindMobileInputs() {
    // Only allow digits in mobile & pincode fields
    const mobileEl  = document.getElementById('mobile');
    const pincodeEl = document.getElementById('pincode');
    if (mobileEl) {
        mobileEl.addEventListener('input', e => {
            e.target.value = e.target.value.replace(/\D/g, '');
            hubMobileDuplicate = false;
            clearErr('mobileErr');
        });
        mobileEl.addEventListener('blur', () => checkHubDuplicate('mobile'));
    }
    if (pincodeEl) pincodeEl.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '');
        clearErr('pincodeErr');
    });
    // Live clear on valid inputs + blur duplicate check on email
    ['fullName','area'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => clearErr(id + 'Err'));
    });
    const emailEl = document.getElementById('email');
    if (emailEl) {
        emailEl.addEventListener('input', () => { hubEmailDuplicate = false; clearErr('emailErr'); });
        emailEl.addEventListener('blur', () => checkHubDuplicate('email'));
    }
    ['city','membership','venueType','capacity'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => clearErr(id + 'Err'));
    });
}

// Check a single field for duplicate registrations. Called on blur so the user
// sees "Email ID already registered!" immediately below the field — no toast popup.
async function checkHubDuplicate(field) {
    const email  = document.getElementById('email')?.value.trim() || '';
    const mobile = document.getElementById('mobile')?.value.trim() || '';
    if (field === 'email'  && (!email  || !isValidEmail(email)))   return;
    if (field === 'mobile' && !/^\d{10}$/.test(mobile))            return;
    try {
        const params = new URLSearchParams();
        if (field === 'email')  params.set('email',  email);
        if (field === 'mobile') params.set('mobile', mobile);
        const res = await fetch(`${API_BASE}/api/hubs/check?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        if (field === 'email'  && data.emailExists)  { hubEmailDuplicate  = true; setErr('emailErr',  'Email ID already registered!'); }
        if (field === 'mobile' && data.mobileExists) { hubMobileDuplicate = true; setErr('mobileErr', 'Mobile number already registered!'); }
    } catch (e) { /* network error — silently ignore, server will catch on submit */ }
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
    // Block step 2 if a duplicate was detected on blur (flags survive the clearErr loop above).
    if (hubEmailDuplicate)  { setErr('emailErr',  'Email ID already registered!');        valid = false; }
    if (hubMobileDuplicate) { setErr('mobileErr', 'Mobile number already registered!'); valid = false; }
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
        if (res.ok) {
            const s = await res.json();
            hubFormOpen = s.hubFormOpen !== false;
            if (s.activeEditionEventDate) {
                const label = `Only host on ${formatDate(s.activeEditionEventDate)}`;
                const labelEl = document.getElementById('freqOnceLabel');
                const inputEl = document.getElementById('freqOnce');
                if (labelEl) labelEl.textContent = label;
                if (inputEl) inputEl.value = label;
            }
        }
    } catch (e) { /* assume open if settings can't be read */ }
    const closedScreen = document.getElementById('hubClosedScreen');
    const openUI = document.getElementById('hubOpenUI');
    if (closedScreen) closedScreen.style.display = hubFormOpen ? 'none' : 'flex';
    if (openUI) openUI.style.display = hubFormOpen ? '' : 'none';
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

    const hostedEl  = document.querySelector('input[name="hostedBefore"]:checked');
    const freqEl    = document.querySelector('input[name="hostingFrequency"]:checked');
    const pocAssign = document.getElementById('pocAssign').checked;
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
        pocRole:          pocAssign ? 'assign' : 'self',
    };

    try {
        const res = await fetch(`${API_BASE}/api/hubs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409) {
            // Duplicate email/mobile — show inline below the relevant field(s) on step 1.
            try {
                const email  = document.getElementById('email').value.trim();
                const mobile = document.getElementById('mobile').value.trim();
                const ck = await fetch(`${API_BASE}/api/hubs/check?email=${encodeURIComponent(email)}&mobile=${encodeURIComponent(mobile)}`);
                if (ck.ok) {
                    const d = await ck.json();
                    if (d.emailExists)  setErr('emailErr',  'Email ID already registered!');
                    if (d.mobileExists) setErr('mobileErr', 'Mobile number already registered!');
                } else {
                    setErr('emailErr', 'Email or mobile already registered!');
                }
            } catch (e) {
                setErr('emailErr', 'Email or mobile already registered!');
            }
            goToStep(1);
            shakeFirstError();
            return;
        }
        if (res.status !== 201) {
            showToast(body.error || 'Could not submit your application — please try again.', 'error');
            return;
        }
        showSuccessScreen(body);
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
    document.getElementById('successOverlay').classList.add('visible');
    goToStep(1);
    showToast('Application submitted successfully!', 'success');
}

function closeSuccessModal() {
    document.getElementById('successOverlay').classList.remove('visible');
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
    hubEmailDuplicate  = false;
    hubMobileDuplicate = false;
    updateHubSubmitGate();
    goToStep(1);
}

function resetAndRegister() {
    resetForm();
    showSection('registration');
}

