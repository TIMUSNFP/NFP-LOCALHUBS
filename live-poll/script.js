/* script.js — join screen logic. */
'use strict';

const stepCode = document.getElementById('step-code');
const stepIdentify = document.getElementById('step-identify');
const stepEnded = document.getElementById('step-ended');
const codeInput = document.getElementById('code-input');
const codeBanner = document.getElementById('code-banner');
const codeContinueBtn = document.getElementById('code-continue');
const identifyBanner = document.getElementById('identify-banner');
const identifySubmitBtn = document.getElementById('identify-submit');
const pollTitleEyebrow = document.getElementById('poll-title-eyebrow');

let currentCode = null;

function setBanner(el, message, type) {
  el.innerHTML = message ? `<div class="banner banner-${type}">${escapeHtml(message)}</div>` : '';
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.querySelector('.btn-label').textContent = busy ? '' : label;
  const existingSpinner = btn.querySelector('.spinner');
  if (busy && !existingSpinner) {
    const s = document.createElement('span');
    s.className = 'spinner';
    btn.appendChild(s);
  } else if (!busy && existingSpinner) {
    existingSpinner.remove();
  }
}

async function tryEnterCode(code) {
  setBanner(codeBanner, '', '');
  setBusy(codeContinueBtn, true, 'Continue');
  try {
    const state = await apiFetch(`/api/sessions/${code}/state`);
    currentCode = code;

    // Returning device on this same poll? Skip straight to voting.
    const savedToken = getDeviceToken(code);
    if (savedToken) {
      try {
        const joinRes = await apiFetch(`/api/sessions/${code}/join`, {
          method: 'POST',
          body: JSON.stringify({ deviceToken: savedToken }),
        });
        setParticipant(code, joinRes.participant);
        location.href = `vote.html?code=${code}`;
        return;
      } catch (e) {
        // fall through to the identify step if silent rejoin fails
      }
    }

    if (state.status === 'ended') {
      stepCode.style.display = 'none';
      stepEnded.style.display = '';
      return;
    }

    pollTitleEyebrow.textContent = state.title ? state.title : 'Step 2 of 2';
    stepCode.style.display = 'none';
    stepIdentify.style.display = '';
  } catch (e) {
    setBanner(codeBanner, e.status === 404 ? 'No poll found for that code — check and try again.' : e.message, 'error');
  } finally {
    setBusy(codeContinueBtn, false, 'Continue');
  }
}

codeContinueBtn.addEventListener('click', () => {
  const code = normalizeCode(codeInput.value);
  if (code.length < 4) {
    setBanner(codeBanner, 'Enter the poll code.', 'error');
    return;
  }
  tryEnterCode(code);
});
codeInput.addEventListener('input', () => {
  codeInput.value = normalizeCode(codeInput.value);
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') codeContinueBtn.click();
});

identifySubmitBtn.addEventListener('click', async () => {
  setBanner(identifyBanner, '', '');

  const fullName = document.getElementById('full-name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  if (!fullName || !phone) {
    setBanner(identifyBanner, 'Enter your name and phone number.', 'error');
    return;
  }
  const payload = { fullName, phone };

  const existingToken = getDeviceToken(currentCode);
  if (existingToken) payload.deviceToken = existingToken;

  setBusy(identifySubmitBtn, true, 'Join poll');
  try {
    const res = await apiFetch(`/api/sessions/${currentCode}/join`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setDeviceToken(currentCode, res.deviceToken);
    setParticipant(currentCode, res.participant);
    location.href = `vote.html?code=${currentCode}`;
  } catch (e) {
    setBanner(identifyBanner, e.message, 'error');
  } finally {
    setBusy(identifySubmitBtn, false, 'Join poll');
  }
});

// Auto-fill from ?code= (QR code link) and jump straight in.
(function init() {
  const params = new URLSearchParams(location.search);
  const qCode = normalizeCode(params.get('code'));
  if (qCode.length >= 4) {
    codeInput.value = qCode;
    tryEnterCode(qCode);
  } else {
    codeInput.focus();
  }
})();
