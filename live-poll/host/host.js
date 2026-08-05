/* host/host.js — host console: login, session/question management, live
   flow control, CSV export. Reuses the same admin JWT as the main NFP
   Circles admin panel (poll-middleware.js on the backend). */
'use strict';

const TOKEN_KEY = 'nfp-poll-host-token';

const screens = {
  login: document.getElementById('login-screen'),
  list: document.getElementById('list-screen'),
  detail: document.getElementById('detail-screen'),
};
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => { el.style.display = k === name ? '' : 'none'; });
}

function token() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); }

async function hostFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token()}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    showScreen('login');
    throw new Error('Session expired — please log in again.');
  }
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
  return { body, raw: res };
}

function setBanner(el, message, type = 'error') {
  el.innerHTML = message ? `<div class="banner banner-${type}">${escapeHtml(message)}</div>` : '';
}
function setBusy(btn, busy, label) {
  btn.disabled = busy;
  const labelEl = btn.querySelector('.btn-label');
  if (labelEl) labelEl.textContent = busy ? '' : label;
  let spinner = btn.querySelector('.spinner');
  if (busy && !spinner) { spinner = document.createElement('span'); spinner.className = 'spinner'; btn.appendChild(spinner); }
  else if (!busy && spinner) spinner.remove();
}

/* ── Login ─────────────────────────────────────────────────────────── */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const banner = document.getElementById('login-banner');
  const btn = document.getElementById('login-submit');
  setBanner(banner, '');
  setBusy(btn, true, 'Log in');
  try {
    const res = await fetch(`${API_BASE}/api/host/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Invalid credentials');
    setToken(body.token);
    showScreen('list');
    loadSessionList();
  } catch (err) {
    setBanner(banner, err.message);
  } finally {
    setBusy(btn, false, 'Log in');
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  clearToken();
  showScreen('login');
});

/* ── Session list ──────────────────────────────────────────────────── */
async function loadSessionList() {
  const listEl = document.getElementById('session-list');
  listEl.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const { body: sessions } = await hostFetch('/api/host/sessions');
    if (!sessions.length) {
      listEl.innerHTML = '<p class="hint">No polls yet — create one to get started.</p>';
      return;
    }
    listEl.innerHTML = sessions.map((s) => `
      <div class="q-row" style="cursor:pointer;" data-id="${s.id}">
        <div class="q-info">
          <div class="q-type-label">Code ${s.code}</div>
          <div class="q-prompt-text">${escapeHtml(s.title)}</div>
        </div>
        <span class="q-badge ${s.status === 'live' ? 'live' : s.status === 'ended' ? 'closed' : 'pending'}">${s.status}</span>
      </div>`).join('');
    listEl.querySelectorAll('.q-row').forEach((row) => {
      row.addEventListener('click', () => openSession(row.dataset.id));
    });
  } catch (err) {
    listEl.innerHTML = `<div class="banner banner-error">${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('back-to-list').addEventListener('click', () => {
  stopLiveResultsPolling();
  showScreen('list');
  loadSessionList();
});

/* ── New session modal ────────────────────────────────────────────── */
const modal = document.getElementById('new-session-modal');
document.getElementById('new-session-btn').addEventListener('click', () => { modal.style.display = 'flex'; });
document.getElementById('new-session-cancel').addEventListener('click', () => { modal.style.display = 'none'; });
document.getElementById('new-session-create').addEventListener('click', async (e) => {
  const banner = document.getElementById('new-session-banner');
  const title = document.getElementById('new-session-title').value.trim();
  const code = document.getElementById('new-session-code').value.trim();
  if (!title) { setBanner(banner, 'Enter a title.'); return; }
  setBusy(e.currentTarget, true, 'Create');
  try {
    const { body: session } = await hostFetch('/api/host/sessions', {
      method: 'POST',
      body: JSON.stringify({ title, code: code || undefined }),
    });
    modal.style.display = 'none';
    document.getElementById('new-session-title').value = '';
    document.getElementById('new-session-code').value = '';
    openSession(session.id);
  } catch (err) {
    setBanner(banner, err.message);
  } finally {
    setBusy(e.currentTarget, false, 'Create');
  }
});

document.getElementById('change-code-btn').addEventListener('click', async () => {
  const newCode = prompt('New join code (letters and numbers only, min 4 characters):');
  if (newCode === null) return;
  try {
    await hostFetch(`/api/host/sessions/${currentSessionId}/code`, {
      method: 'POST',
      body: JSON.stringify({ code: newCode }),
    });
    await refreshDetail();
    showToast('Join code updated.');
  } catch (err) {
    showToast(err.message);
  }
});

/* ── Session detail ───────────────────────────────────────────────── */
let currentSessionId = null;
let liveResultsTimer = null;

function stopLiveResultsPolling() {
  clearInterval(liveResultsTimer);
  liveResultsTimer = null;
}

async function openSession(id) {
  currentSessionId = id;
  showScreen('detail');
  await refreshDetail();
}

async function refreshDetail() {
  const { body: session } = await hostFetch(`/api/host/sessions/${currentSessionId}`);
  renderDetail(session);
}

function renderDetail(session) {
  document.getElementById('detail-title').textContent = session.title;
  document.getElementById('detail-code-badge').textContent = `Code ${session.code}`;
  const statusEl = document.getElementById('detail-status');
  statusEl.textContent = session.status;
  statusEl.className = `status-pill ${session.status === 'live' ? 'live' : session.status === 'ended' ? 'ended' : ''}`;
  document.getElementById('detail-participant-count').textContent = `${session.participantCount} joined`;

  document.getElementById('link-present').href = `../present.html?code=${session.code}`;
  document.getElementById('link-join').href = `../index.html?code=${session.code}`;

  renderControlBar(session);
  renderQuestionList(session);

  const liveQ = session.questions.find((q) => q.id === session.currentQuestionId);
  if (liveQ) {
    startLiveResultsPolling(liveQ);
  } else {
    stopLiveResultsPolling();
    document.getElementById('live-results').innerHTML = '<p class="hint">Open a question to see live results here.</p>';
  }
}

function renderControlBar(session) {
  const bar = document.getElementById('control-bar');
  const restartBtn = `<button class="btn btn-outline btn-sm" id="cb-restart">Restart Poll</button>`;

  if (session.status === 'draft') {
    bar.innerHTML = `<button class="btn btn-primary btn-sm" id="cb-start">Start Poll</button>`;
    document.getElementById('cb-start').addEventListener('click', (e) => runAction(e.currentTarget, `/api/host/sessions/${session.id}/start`, 'Start Poll'));
  } else if (session.status === 'live') {
    const parts = [];
    if (session.currentQuestionId) {
      parts.push(`<button class="btn btn-primary btn-sm" id="cb-close">Close &amp; Reveal Results</button>`);
    } else {
      parts.push(`<span class="cb-empty">Open a question below to go live with it.</span>`);
    }
    parts.push(`<button class="btn btn-outline btn-sm" id="cb-next">Next (clear screen)</button>`);
    parts.push(`<button class="btn btn-danger btn-sm" id="cb-end">End Poll</button>`);
    parts.push(restartBtn);
    bar.innerHTML = parts.join('');
    if (session.currentQuestionId) {
      document.getElementById('cb-close').addEventListener('click', (e) =>
        runAction(e.currentTarget, `/api/host/sessions/${session.id}/questions/${session.currentQuestionId}/close`, 'Close & Reveal Results'));
    }
    document.getElementById('cb-next').addEventListener('click', (e) => runAction(e.currentTarget, `/api/host/sessions/${session.id}/next`, 'Next'));
    document.getElementById('cb-end').addEventListener('click', (e) => {
      if (!confirm('End this poll? Participants will see it as ended.')) return;
      runAction(e.currentTarget, `/api/host/sessions/${session.id}/end`, 'End Poll');
    });
  } else {
    bar.innerHTML = `<span class="cb-empty">This poll has ended.</span>` + restartBtn;
  }

  const restart = document.getElementById('cb-restart');
  if (restart) {
    restart.addEventListener('click', (e) => {
      if (!confirm('Restart this poll? This clears every participant and vote collected so far — export the CSV first if you need that data. The same questions stay, ready to run again from a fresh Start.')) return;
      runAction(e.currentTarget, `/api/host/sessions/${session.id}/restart`, 'Restart Poll');
    });
  }
}

async function runAction(btn, path, label) {
  setBusy(btn, true, label);
  try {
    await hostFetch(path, { method: 'POST' });
    await refreshDetail();
  } catch (err) {
    showToast(err.message);
  } finally {
    setBusy(btn, false, label);
  }
}

const TYPE_LABELS = {
  multiple_choice: 'Multiple Choice', true_false: 'True / False', rating: 'Rating',
  word_cloud: 'Word Cloud', open_text: 'Open Question', quiz: 'Quiz', ranking: 'Ranking', pulse: 'Pulse Check',
};

function renderQuestionList(session) {
  const listEl = document.getElementById('question-list');
  if (!session.questions.length) {
    listEl.innerHTML = '<p class="hint">No questions yet — add one below.</p>';
    return;
  }
  listEl.innerHTML = session.questions.map((q) => {
    const isLive = q.id === session.currentQuestionId;
    const canOpen = session.status === 'live' && !isLive;
    return `
      <div class="q-row">
        <span class="q-order">${q.orderIndex}</span>
        <div class="q-info">
          <div class="q-type-label">${TYPE_LABELS[q.type] || q.type}</div>
          <div class="q-prompt-text">${escapeHtml(q.prompt)}</div>
        </div>
        <span class="q-badge ${isLive ? 'live' : q.status}">${isLive ? 'live now' : q.status}</span>
        ${canOpen ? `<button class="btn btn-outline btn-sm" data-open="${q.id}">${q.status === 'closed' ? 'Reopen' : 'Open'}</button>` : ''}
        ${q.status === 'pending' ? `<button class="btn btn-outline btn-sm" data-edit="${q.id}">Edit</button>` : ''}
        ${q.status === 'pending' ? `<button class="btn btn-ghost btn-sm" data-delete="${q.id}" aria-label="Delete question">✕</button>` : ''}
      </div>`;
  }).join('');

  listEl.querySelectorAll('[data-open]').forEach((btn) => {
    btn.addEventListener('click', (e) =>
      runAction(e.currentTarget, `/api/host/sessions/${session.id}/questions/${btn.dataset.open}/open`, btn.textContent));
  });
  listEl.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const question = session.questions.find((q) => q.id === btn.dataset.edit);
      if (question) enterEditMode(question);
    });
  });
  listEl.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      if (!confirm('Delete this question?')) return;
      try {
        await hostFetch(`/api/host/sessions/${session.id}/questions/${btn.dataset.delete}`, { method: 'DELETE' });
        await refreshDetail();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

/* ── Add question form ────────────────────────────────────────────── */
const qTypeSelect = document.getElementById('q-type');
const qTypeFields = document.getElementById('q-type-fields');

function choiceRowsMarkup(values) {
  return values.map((v, i) => `
    <div class="dyn-choice-row" data-choice-row>
      <input type="text" value="${escapeHtml(v)}" placeholder="Option ${i + 1}">
      <button type="button" data-remove-choice aria-label="Remove option">×</button>
    </div>`).join('');
}

function renderTypeFields(type) {
  if (type === 'multiple_choice' || type === 'quiz') {
    qTypeFields.innerHTML = `
      <div class="field"><label>Answer options</label><div id="choice-rows">${choiceRowsMarkup(['', ''])}</div>
      <button type="button" class="dyn-add-choice" id="add-choice">+ Add option</button></div>
      ${type === 'quiz' ? `<div class="field"><label for="correct-select">Correct answer</label><select id="correct-select"></select></div>` : ''}
    `;
    wireChoiceRows(type);
  } else if (type === 'true_false') {
    qTypeFields.innerHTML = `<div class="field"><label for="tf-correct">Correct answer (optional — leave blank if not a quiz)</label>
      <select id="tf-correct"><option value="">— none —</option><option value="True">True</option><option value="False">False</option></select></div>`;
  } else if (type === 'rating') {
    qTypeFields.innerHTML = `
      <div style="display:flex; gap:10px;">
        <div class="field"><label for="rate-min">Min</label><input id="rate-min" type="number" value="1"></div>
        <div class="field"><label for="rate-max">Max</label><input id="rate-max" type="number" value="5"></div>
      </div>
      <div style="display:flex; gap:10px;">
        <div class="field"><label for="rate-low">Low label</label><input id="rate-low" placeholder="e.g. Poor"></div>
        <div class="field"><label for="rate-high">High label</label><input id="rate-high" placeholder="e.g. Excellent"></div>
      </div>`;
  } else if (type === 'ranking') {
    qTypeFields.innerHTML = `
      <div class="field"><label>Items to rank</label><div id="choice-rows">${choiceRowsMarkup(['', ''])}</div>
      <button type="button" class="dyn-add-choice" id="add-choice">+ Add item</button></div>`;
    wireChoiceRows(type);
  } else {
    qTypeFields.innerHTML = '';
  }
}

function wireChoiceRows(type) {
  const container = document.getElementById('choice-rows');
  const addBtn = document.getElementById('add-choice');
  function refreshCorrectOptions() {
    const sel = document.getElementById('correct-select');
    if (!sel) return;
    const values = [...container.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    sel.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  }
  container.addEventListener('input', refreshCorrectOptions);
  container.addEventListener('click', (e) => {
    if (e.target.matches('[data-remove-choice]')) {
      if (container.querySelectorAll('[data-choice-row]').length > 2) {
        e.target.closest('[data-choice-row]').remove();
        refreshCorrectOptions();
      }
    }
  });
  addBtn.addEventListener('click', () => {
    container.insertAdjacentHTML('beforeend', choiceRowsMarkup(['']));
    refreshCorrectOptions();
  });
  refreshCorrectOptions();
}

qTypeSelect.addEventListener('change', () => renderTypeFields(qTypeSelect.value));
renderTypeFields(qTypeSelect.value);

/* ── Edit mode: reuses the Add-a-question form/fields ─────────────── */
let editingQuestionId = null;
const addQuestionDetails = document.querySelector('.host-add-question');
const addQuestionBtn = document.getElementById('add-question-btn');

function exitEditMode() {
  editingQuestionId = null;
  document.getElementById('q-prompt').value = '';
  qTypeSelect.disabled = false;
  renderTypeFields(qTypeSelect.value);
  addQuestionBtn.querySelector('.btn-label').textContent = 'Add question';
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) cancelBtn.remove();
}

function enterEditMode(question) {
  editingQuestionId = question.id;
  addQuestionDetails.open = true;
  qTypeSelect.value = question.type;
  qTypeSelect.disabled = true; // changing type mid-edit would orphan the options shape
  document.getElementById('q-prompt').value = question.prompt;
  renderTypeFields(question.type);

  if (question.type === 'multiple_choice' || question.type === 'quiz' || question.type === 'ranking') {
    const values = question.options?.choices || question.options?.items || [];
    document.getElementById('choice-rows').innerHTML = choiceRowsMarkup(values.length ? values : ['', '']);
    wireChoiceRows(question.type);
    if (question.type === 'quiz') {
      const sel = document.getElementById('correct-select');
      if (sel) sel.value = question.correctOption || '';
    }
  } else if (question.type === 'true_false') {
    document.getElementById('tf-correct').value = question.correctOption || '';
  } else if (question.type === 'rating') {
    document.getElementById('rate-min').value = question.options?.min ?? 1;
    document.getElementById('rate-max').value = question.options?.max ?? 5;
    document.getElementById('rate-low').value = question.options?.lowLabel || '';
    document.getElementById('rate-high').value = question.options?.highLabel || '';
  }

  addQuestionBtn.querySelector('.btn-label').textContent = 'Save changes';
  if (!document.getElementById('cancel-edit-btn')) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.id = 'cancel-edit-btn';
    cancel.className = 'btn btn-ghost btn-sm';
    cancel.textContent = 'Cancel edit';
    cancel.style.marginLeft = '8px';
    cancel.addEventListener('click', exitEditMode);
    addQuestionBtn.insertAdjacentElement('afterend', cancel);
  }
  addQuestionDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('add-question-btn').addEventListener('click', async (e) => {
  const banner = document.getElementById('add-question-banner');
  setBanner(banner, '');
  const type = qTypeSelect.value;
  const prompt = document.getElementById('q-prompt').value.trim();
  if (!prompt) { setBanner(banner, 'Enter a question prompt.'); return; }

  let options = {};
  let correctOption = null;

  if (type === 'multiple_choice' || type === 'quiz') {
    const choices = [...document.querySelectorAll('#choice-rows input')].map((i) => i.value.trim()).filter(Boolean);
    if (choices.length < 2) { setBanner(banner, 'Add at least 2 answer options.'); return; }
    options = { choices };
    if (type === 'quiz') {
      correctOption = document.getElementById('correct-select').value;
      if (!correctOption) { setBanner(banner, 'Choose the correct answer.'); return; }
    }
  } else if (type === 'true_false') {
    options = { choices: ['True', 'False'] };
    const tf = document.getElementById('tf-correct').value;
    if (tf) correctOption = tf;
  } else if (type === 'rating') {
    options = {
      min: Number(document.getElementById('rate-min').value) || 1,
      max: Number(document.getElementById('rate-max').value) || 5,
      lowLabel: document.getElementById('rate-low').value.trim(),
      highLabel: document.getElementById('rate-high').value.trim(),
    };
  } else if (type === 'ranking') {
    const items = [...document.querySelectorAll('#choice-rows input')].map((i) => i.value.trim()).filter(Boolean);
    if (items.length < 2) { setBanner(banner, 'Add at least 2 items to rank.'); return; }
    options = { items };
  } else if (type === 'pulse') {
    options = { choices: ['up', 'neutral', 'down'] };
  }
  // word_cloud needs no options.

  const isEditing = Boolean(editingQuestionId);
  const busyLabel = isEditing ? 'Save changes' : 'Add question';
  setBusy(e.currentTarget, true, busyLabel);
  try {
    if (isEditing) {
      await hostFetch(`/api/host/sessions/${currentSessionId}/questions/${editingQuestionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ type, prompt, options, correctOption }),
      });
      exitEditMode();
      showToast('Question updated.');
    } else {
      await hostFetch(`/api/host/sessions/${currentSessionId}/questions`, {
        method: 'POST',
        body: JSON.stringify({ type, prompt, options, correctOption }),
      });
      document.getElementById('q-prompt').value = '';
      renderTypeFields(type);
    }
    await refreshDetail();
  } catch (err) {
    setBanner(banner, err.message);
  } finally {
    setBusy(e.currentTarget, false, busyLabel);
  }
});

/* ── Live results (host view) ─────────────────────────────────────── */
function startLiveResultsPolling(question) {
  stopLiveResultsPolling();
  const panel = document.getElementById('live-results');
  const run = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/questions/${question.id}/results`);
      const results = await res.json();
      panel.innerHTML = `<p class="hint" style="margin-bottom:10px;">${escapeHtml(question.prompt)} — ${results.total || 0} response${results.total === 1 ? '' : 's'}</p>` + hostResultsMarkup(question, results);
    } catch (e) { /* transient */ }
  };
  run();
  liveResultsTimer = setInterval(run, 1500);
}

function hostResultsMarkup(question, results) {
  if (question.type === 'open_text') {
    const responses = results.responses || [];
    return responses.length
      ? `<div style="max-height:340px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">${responses.map((r) => `<div style="padding:8px 10px; border:1px solid var(--border); border-radius:8px; font-size:13px;">${escapeHtml(r)}</div>`).join('')}</div>`
      : '<p class="hint">No answers yet.</p>';
  }
  if (question.type === 'word_cloud') {
    const words = results.words || [];
    return words.length
      ? words.map((w) => `<span style="display:inline-block; margin:2px 6px 2px 0; font-weight:700; color:var(--primary);">${escapeHtml(w.text)} (${w.count})</span>`).join('')
      : '<p class="hint">No answers yet.</p>';
  }
  if (question.type === 'rating') {
    return `<p style="font-size:28px; font-weight:700; color:var(--primary); margin-bottom:8px;">${results.average ?? '—'}</p>` + barsHtml(results.counts, results.total);
  }
  if (question.type === 'ranking') {
    const standings = results.standings || [];
    return standings.length
      ? standings.map(([item, score], i) => `<div class="bar-row"><div class="bar-label"><span>#${i + 1} ${escapeHtml(item)}</span><span>${score} pts</span></div></div>`).join('')
      : '<p class="hint">No rankings yet.</p>';
  }
  return barsHtml(results.counts || {}, results.total || 0);
}

function barsHtml(counts, total) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return '<p class="hint">No answers yet.</p>';
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return entries.map(([label, count]) => `
    <div class="bar-row">
      <div class="bar-label"><span>${escapeHtml(label)}</span><span>${count}${total ? ` · ${Math.round((count / total) * 100)}%` : ''}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((count / max) * 100)}%"></div></div>
    </div>`).join('');
}

/* ── CSV export ────────────────────────────────────────────────────── */
document.getElementById('export-btn').addEventListener('click', async (e) => {
  setBusy(e.currentTarget, true, 'Export CSV');
  try {
    const res = await fetch(`${API_BASE}/api/host/sessions/${currentSessionId}/export.csv`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error('Export failed.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'poll-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message);
  } finally {
    setBusy(e.currentTarget, false, 'Export CSV');
  }
});

/* ── Boot ──────────────────────────────────────────────────────────── */
(async function init() {
  if (!token()) { showScreen('login'); return; }
  try {
    await hostFetch('/api/host/sessions');
    showScreen('list');
    loadSessionList();
  } catch (e) {
    showScreen('login');
  }
})();
