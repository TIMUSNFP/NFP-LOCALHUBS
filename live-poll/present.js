/* present.js — big-screen presenter view. Polls session state (~2s) and,
   while a question is live, its aggregate results (~1.5s). Renders pre-
   session join panel, question + live bars/word-cloud/rating/ranking, and
   an ended screen. Never touches participant identity. */
'use strict';

const codePill = document.getElementById('p-code-pill');
const main = document.getElementById('p-main');

const params = new URLSearchParams(location.search);
let code = normalizeCode(params.get('code'));

if (code.length < 4) {
  main.innerHTML = `
    <div class="p-join-text" style="text-align:center;">
      <div class="p-eyebrow">Presenter View</div>
      <p style="margin-bottom:20px; color:rgba(255,255,255,.7);">Open this page with <code>?code=YOURCODE</code>, or enter the poll code below.</p>
      <input id="p-code-input" autocapitalize="characters" maxlength="24" placeholder="e.g. ABC1234"
             style="font-size:24px; letter-spacing:2px; text-align:center; padding:14px 20px; border-radius:12px; border:none; width:320px; text-transform:uppercase;">
      <br><button class="btn btn-primary" id="p-code-go" style="width:320px; margin-top:16px;">Open</button>
    </div>`;
  document.getElementById('p-code-go').addEventListener('click', () => {
    const c = normalizeCode(document.getElementById('p-code-input').value);
    if (c.length >= 4) location.search = `?code=${c}`;
  });
  throw new Error('waiting for code');
}

codePill.textContent = code;

let lastRenderedKey = null;
let resultsTimer = null;

function renderJoinPanel(title, participantCount) {
  // Codes can be a short 6-digit default or a longer custom one (e.g.
  // "NFPCIRCLE2026") — scale the big display down so long codes still fit.
  const codeSizeClass = code.length > 10 ? 'len-long' : code.length > 6 ? 'len-med' : '';
  main.innerHTML = `
    <div class="fade-in">
    <div class="p-title">${escapeHtml(title)}</div>
    <div class="p-join-panel">
      <div class="p-qr" id="p-qr"><img src="${API_BASE}/api/qr/${code}" alt="QR code to join"></div>
      <div class="p-join-text">
        <div class="p-eyebrow">Scan the QR code to join</div>
        <div class="p-code ${codeSizeClass}">${escapeHtml(code)}</div>
        <div class="p-join-url">Enter code ${escapeHtml(code)} to join on your phone</div>
      </div>
    </div>
    <div class="p-count"><strong>${participantCount}</strong> joined so far</div>
    </div>
  `;
}

function renderIntermission(participantCount) {
  main.innerHTML = `
    <div class="fade-in">
    <div class="p-title">Get ready…</div>
    <p class="p-empty">The next question is coming up.</p>
    <div class="p-count"><strong>${participantCount}</strong> in the room</div>
    </div>
  `;
}

function renderEnded() {
  main.innerHTML = `<div class="fade-in"><div class="p-title">Thanks for participating!</div><p class="p-empty">This poll has ended.</p></div>`;
}

function barsMarkup(counts, total, correctOption) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return `<div class="p-bars">${entries.map(([label, count]) => {
    const pct = total ? Math.round((count / total) * 100) : 0;
    const widthPct = Math.round((count / max) * 100);
    const isCorrect = correctOption && label === correctOption;
    return `
      <div class="p-bar-row${isCorrect ? ' correct' : ''}">
        <div class="p-bar-label"><span>${escapeHtml(label)}${isCorrect ? ' ✓' : ''}</span><span>${count} · ${pct}%</span></div>
        <div class="p-bar-track"><div class="p-bar-fill" style="width:${widthPct}%"></div></div>
      </div>`;
  }).join('')}</div>`;
}

function renderQuestionResults(question, results) {
  const key = `${question.id}:${question.type}`;
  const isNewQuestion = key !== lastRenderedKey;
  lastRenderedKey = key;

  let body = '';
  if (question.type === 'multiple_choice' || question.type === 'true_false' || question.type === 'quiz' || question.type === 'pulse') {
    body = barsMarkup(results.counts || {}, results.total || 0, results.correctOption);
  } else if (question.type === 'rating') {
    body = `
      <div style="display:flex; gap:48px; align-items:center; justify-content:center; flex-wrap:wrap;">
        <div>
          <div class="p-rating-avg">${results.average ?? '—'}</div>
          <div class="p-rating-avg-label">average (${results.min}–${results.max})</div>
        </div>
        <div style="flex:1; min-width:260px; max-width:520px;">
          ${barsMarkup(results.counts || {}, results.total || 0)}
        </div>
      </div>`;
  } else if (question.type === 'open_text') {
    const responses = results.responses || [];
    body = responses.length
      ? `<div class="p-open-text">${responses.map((r) => `<div class="p-open-text-card">${escapeHtml(r)}</div>`).join('')}</div>`
      : `<p class="p-empty">Waiting for answers…</p>`;
  } else if (question.type === 'word_cloud') {
    const words = results.words || [];
    const max = Math.max(1, ...words.map((w) => w.count));
    body = words.length
      ? `<div class="p-wordcloud">${words.map((w) => {
          const size = 16 + Math.round((w.count / max) * 56);
          return `<span style="font-size:${size}px;">${escapeHtml(w.text)}</span>`;
        }).join('')}</div>`
      : `<p class="p-empty">Waiting for answers…</p>`;
  } else if (question.type === 'ranking') {
    const standings = results.standings || [];
    body = standings.length
      ? `<div class="p-bars">${standings.map(([item, score], i) => `
          <div class="p-bar-row${i === 0 ? ' correct' : ''}">
            <div class="p-bar-label"><span>#${i + 1} ${escapeHtml(item)}</span><span>${score} pts</span></div>
            <div class="p-bar-track"><div class="p-bar-fill" style="width:${Math.round((score / Math.max(1, standings[0][1])) * 100)}%"></div></div>
          </div>`).join('')}</div>`
      : `<p class="p-empty">Waiting for rankings…</p>`;
  }

  main.innerHTML = `
    <div class="p-question-wrap">
      <div class="p-eyebrow-row"><span class="p-tally">${results.total || 0} response${results.total === 1 ? '' : 's'}</span></div>
      <div class="p-prompt">${escapeHtml(question.prompt)}</div>
      ${body}
    </div>`;
}

async function pollResults(questionId) {
  clearInterval(resultsTimer);
  const run = async () => {
    try {
      const results = await apiFetch(`/api/questions/${questionId}/results`);
      const q = currentQuestionCache;
      if (q && q.id === questionId) renderQuestionResults(q, results);
    } catch (e) { /* transient */ }
  };
  run();
  resultsTimer = setInterval(run, 1500);
}

let currentQuestionCache = null;

async function tick() {
  try {
    const state = await apiFetch(`/api/sessions/${code}/state`);

    if (state.status === 'ended') {
      clearInterval(resultsTimer);
      if (lastRenderedKey !== 'ended') { lastRenderedKey = 'ended'; renderEnded(); }
      return;
    }
    if (!state.currentQuestion) {
      clearInterval(resultsTimer);
      currentQuestionCache = null;
      const key = state.status === 'draft' ? 'join' : 'intermission';
      if (lastRenderedKey !== key) {
        lastRenderedKey = key;
        if (state.status === 'draft') renderJoinPanel(state.title, state.participantCount);
        else renderIntermission(state.participantCount);
      } else {
        // keep the participant count fresh without a full re-render flash
        const countEl = main.querySelector('.p-count strong');
        if (countEl) countEl.textContent = state.participantCount;
      }
      return;
    }

    currentQuestionCache = state.currentQuestion;
    if (!resultsTimer || lastRenderedKey !== `${state.currentQuestion.id}:${state.currentQuestion.type}`) {
      pollResults(state.currentQuestion.id);
    }
  } catch (e) { /* transient network hiccup — keep polling silently */ }
}

tick();
setInterval(tick, 2000);
