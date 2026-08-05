/* vote.js — participant voting screen. Polls session state, renders the live
   question, submits votes. Core types: multiple_choice, true_false, rating,
   word_cloud. quiz/ranking/pulse render too, but are the "added after the
   baseline is verified" tier per the build plan. */
'use strict';

const root = document.getElementById('vote-root');
const codeBadge = document.getElementById('poll-code-badge');

const params = new URLSearchParams(location.search);
const code = normalizeCode(params.get('code'));

if (code.length < 4) {
  location.href = 'index.html';
}
const participant = getParticipant(code);
const deviceToken = getDeviceToken(code);
if (!participant || !deviceToken) {
  location.href = `index.html?code=${code}`;
}

codeBadge.textContent = `Code ${code}`;

const POLL_MS = 2000;
let lastQuestionId = null;
let votedQuestionIds = new Set(JSON.parse(localStorage.getItem(`nfp-poll:${code}:voted`) || '[]'));
let submitting = false;
let pollTimer = null;

function markVoted(questionId, answer) {
  votedQuestionIds.add(questionId);
  localStorage.setItem(`nfp-poll:${code}:voted`, JSON.stringify([...votedQuestionIds]));
  localStorage.setItem(`nfp-poll:${code}:answer:${questionId}`, JSON.stringify(answer));
}
function savedAnswer(questionId) {
  const raw = localStorage.getItem(`nfp-poll:${code}:answer:${questionId}`);
  return raw ? JSON.parse(raw) : null;
}

function renderWaiting(title, subtitle, icon) {
  root.innerHTML = `
    <div class="waiting">
      <div class="pulse-dot">${icon || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>'}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(subtitle || '')}</p>
    </div>`;
}

function letterFor(i) {
  return String.fromCharCode(65 + i);
}

async function submitVote(questionId, answer, onDone) {
  if (submitting) return;
  submitting = true;
  try {
    await apiFetch(`/api/questions/${questionId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ deviceToken, answer }),
    });
    markVoted(questionId, answer);
    onDone && onDone();
  } catch (e) {
    showToast(e.message || 'Could not submit your answer — try again.');
  } finally {
    submitting = false;
  }
}

function renderChoiceQuestion(question, alreadyVoted) {
  const choices = question.options?.choices || [];
  const saved = alreadyVoted ? savedAnswer(question.id) : null;
  root.innerHTML = `
    <div class="fade-in">
    <div class="q-eyebrow">${question.type === 'true_false' ? 'True or False' : 'Multiple Choice'}</div>
    <div class="q-prompt">${escapeHtml(question.prompt)}</div>
    <div class="options" role="group" aria-label="Answer options">
      ${choices.map((c, i) => `
        <button type="button" class="option-btn${saved?.option === c ? ' selected' : ''}" data-choice="${escapeHtml(c)}" ${alreadyVoted ? 'disabled' : ''}>
          <span class="letter">${letterFor(i)}</span>
          <span>${escapeHtml(c)}</span>
        </button>
      `).join('')}
    </div>
    ${alreadyVoted ? '<p style="margin-top:16px; color:var(--success); font-weight:700; font-size:14px;">✓ Answer submitted — waiting for results…</p>' : ''}
    </div>
  `;
  if (!alreadyVoted) {
    root.querySelectorAll('.option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.option-btn').forEach((b) => (b.disabled = true));
        btn.classList.add('selected');
        submitVote(question.id, { option: btn.dataset.choice }, () => renderChoiceQuestion(question, true));
      });
    });
  }
}

function renderRatingQuestion(question, alreadyVoted) {
  const min = question.options?.min ?? 1;
  const max = question.options?.max ?? 5;
  const lowLabel = question.options?.lowLabel || 'Low';
  const highLabel = question.options?.highLabel || 'High';
  const saved = alreadyVoted ? savedAnswer(question.id) : null;
  const values = [];
  for (let v = min; v <= max; v++) values.push(v);

  root.innerHTML = `
    <div class="fade-in">
    <div class="q-eyebrow">Rate it</div>
    <div class="q-prompt">${escapeHtml(question.prompt)}</div>
    <div class="rating-scale" role="group" aria-label="Rating">
      ${values.map((v) => `<button type="button" class="${saved?.value === v ? 'selected' : ''}" data-value="${v}" ${alreadyVoted ? 'disabled' : ''}>${v}</button>`).join('')}
    </div>
    <div class="rating-labels"><span>${escapeHtml(lowLabel)}</span><span>${escapeHtml(highLabel)}</span></div>
    ${alreadyVoted ? '<p style="margin-top:16px; color:var(--success); font-weight:700; font-size:14px;">✓ Answer submitted — waiting for results…</p>' : ''}
    </div>
  `;
  if (!alreadyVoted) {
    root.querySelectorAll('.rating-scale button').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.rating-scale button').forEach((b) => (b.disabled = true));
        btn.classList.add('selected');
        submitVote(question.id, { value: Number(btn.dataset.value) }, () => renderRatingQuestion(question, true));
      });
    });
  }
}

function renderTextQuestion(question, alreadyVoted) {
  const isWordCloud = question.type === 'word_cloud';
  const maxLength = isWordCloud ? 30 : 240;
  const placeholder = isWordCloud ? 'One or two words…' : 'Type your answer…';
  const eyebrow = isWordCloud ? 'Word Cloud' : 'Open Question';
  const saved = alreadyVoted ? savedAnswer(question.id) : null;
  root.innerHTML = `
    <div class="fade-in">
    <div class="q-eyebrow">${eyebrow}</div>
    <div class="q-prompt">${escapeHtml(question.prompt)}</div>
    <textarea class="textarea-answer" id="text-answer-input" maxlength="${maxLength}" placeholder="${placeholder}" ${alreadyVoted ? 'disabled' : ''} style="${isWordCloud ? 'min-height:60px;' : ''}">${saved ? escapeHtml(saved.text) : ''}</textarea>
    <div class="char-count"><span id="text-answer-count">${saved ? saved.text.length : 0}</span>/${maxLength}</div>
    ${alreadyVoted
      ? '<p style="margin-top:8px; color:var(--success); font-weight:700; font-size:14px;">✓ Answer submitted — waiting for results…</p>'
      : '<button class="btn btn-primary" id="text-answer-submit" style="margin-top:8px;"><span class="btn-label">Submit</span></button>'}
    </div>
  `;
  if (!alreadyVoted) {
    const textarea = document.getElementById('text-answer-input');
    const count = document.getElementById('text-answer-count');
    textarea.addEventListener('input', () => { count.textContent = textarea.value.length; });
    document.getElementById('text-answer-submit').addEventListener('click', (e) => {
      const text = textarea.value.trim();
      if (!text) { showToast('Type an answer first.'); return; }
      e.currentTarget.disabled = true;
      submitVote(question.id, { text }, () => renderTextQuestion(question, true));
    });
  }
}

function renderPulseQuestion(question, alreadyVoted) {
  const choices = question.options?.choices || ['up', 'neutral', 'down'];
  const meta = {
    up: { label: 'Loving it', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v11M15 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.76a2 2 0 0 0 1.79-2.11L8 4a2 2 0 0 1 2-2h.11a2 2 0 0 1 2 2v6h5a2 2 0 0 1 2 2l-1.5 7a2 2 0 0 1-2 1.5H15z"/></svg>' },
    neutral: { label: 'Okay', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="9" y1="9" x2="9" y2="9"/><line x1="15" y1="9" x2="15" y2="9"/></svg>' },
    down: { label: 'Not for me', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V3M9 3h11a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2.76a2 2 0 0 0-1.79 2.11L16 20a2 2 0 0 1-2 2h-.11a2 2 0 0 1-2-2v-6h-5a2 2 0 0 1-2-2l1.5-7A2 2 0 0 1 8.38 3H9z"/></svg>' },
  };
  const saved = alreadyVoted ? savedAnswer(question.id) : null;
  root.innerHTML = `
    <div class="fade-in">
    <div class="q-eyebrow">Quick Reaction</div>
    <div class="q-prompt">${escapeHtml(question.prompt)}</div>
    <div class="pulse-row">
      ${choices.map((c) => `
        <button type="button" class="pulse-btn${saved?.option === c ? ' selected' : ''}" data-choice="${escapeHtml(c)}" ${alreadyVoted ? 'disabled' : ''} aria-label="${escapeHtml(meta[c]?.label || c)}">
          ${meta[c]?.icon || ''}
          <span>${escapeHtml(meta[c]?.label || c)}</span>
        </button>
      `).join('')}
    </div>
    ${alreadyVoted ? '<p style="margin-top:16px; color:var(--success); font-weight:700; font-size:14px; text-align:center;">✓ Thanks for sharing!</p>' : ''}
    </div>
  `;
  if (!alreadyVoted) {
    root.querySelectorAll('.pulse-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.pulse-btn').forEach((b) => (b.disabled = true));
        btn.classList.add('selected');
        submitVote(question.id, { option: btn.dataset.choice }, () => renderPulseQuestion(question, true));
      });
    });
  }
}

function renderRankingQuestion(question, alreadyVoted) {
  const items = question.options?.items || [];
  const saved = alreadyVoted ? savedAnswer(question.id) : null;
  let order = saved?.order || [...items];

  root.innerHTML = `
    <div class="fade-in">
    <div class="q-eyebrow">Rank These</div>
    <div class="q-prompt">${escapeHtml(question.prompt)}</div>
    <p class="hint" style="margin-bottom:12px;">${alreadyVoted ? 'Your final order:' : 'Drag to reorder, best first.'}</p>
    <div class="ranking-list" id="ranking-list"></div>
    ${alreadyVoted ? '<p style="margin-top:16px; color:var(--success); font-weight:700; font-size:14px;">✓ Answer submitted — waiting for results…</p>' : '<button class="btn btn-primary" id="ranking-submit" style="margin-top:16px;"><span class="btn-label">Submit ranking</span></button>'}
    </div>
  `;

  const list = document.getElementById('ranking-list');
  function draw() {
    list.innerHTML = order.map((item, i) => `
      <div class="ranking-item" draggable="${!alreadyVoted}" data-item="${escapeHtml(item)}">
        <span class="rank-num">${i + 1}</span>
        <span>${escapeHtml(item)}</span>
        ${!alreadyVoted ? '<span class="drag-handle" aria-hidden="true">⋮⋮</span>' : ''}
      </div>`).join('');
    if (!alreadyVoted) attachDrag();
  }
  function attachDrag() {
    let dragEl = null;
    list.querySelectorAll('.ranking-item').forEach((el) => {
      el.addEventListener('dragstart', () => { dragEl = el; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); syncOrderFromDom(); });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!dragEl || dragEl === el) return;
        const rect = el.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.insertBefore(dragEl, before ? el : el.nextSibling);
      });
    });
  }
  function syncOrderFromDom() {
    order = [...list.querySelectorAll('.ranking-item')].map((el) => el.dataset.item);
    list.querySelectorAll('.rank-num').forEach((el, i) => { el.textContent = i + 1; });
  }
  draw();

  if (!alreadyVoted) {
    document.getElementById('ranking-submit').addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      submitVote(question.id, { order }, () => renderRankingQuestion(question, true));
    });
  }
}

function renderQuestion(question) {
  const alreadyVoted = votedQuestionIds.has(question.id);
  if (question.type === 'multiple_choice' || question.type === 'true_false' || question.type === 'quiz') {
    renderChoiceQuestion(question, alreadyVoted);
  } else if (question.type === 'rating') {
    renderRatingQuestion(question, alreadyVoted);
  } else if (question.type === 'word_cloud' || question.type === 'open_text') {
    renderTextQuestion(question, alreadyVoted);
  } else if (question.type === 'pulse') {
    renderPulseQuestion(question, alreadyVoted);
  } else if (question.type === 'ranking') {
    renderRankingQuestion(question, alreadyVoted);
  } else {
    renderWaiting('Get ready', 'A new question is coming up shortly.');
  }
}

async function tick() {
  try {
    const state = await apiFetch(`/api/sessions/${code}/state`);

    if (state.status === 'draft') {
      renderWaiting('Hang tight!', 'The poll hasn’t started yet — keep this page open.');
      lastQuestionId = null;
      return;
    }
    if (state.status === 'ended') {
      renderWaiting('Thanks for joining!', 'This poll has ended.', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>');
      clearInterval(pollTimer);
      return;
    }
    if (!state.currentQuestion) {
      renderWaiting('Waiting for the next question…', 'Keep your eyes on the big screen.');
      lastQuestionId = null;
      return;
    }
    if (state.currentQuestion.id !== lastQuestionId) {
      lastQuestionId = state.currentQuestion.id;
      renderQuestion(state.currentQuestion);
    }
  } catch (e) {
    // transient network hiccup — keep polling silently
  }
}

tick();
pollTimer = setInterval(tick, POLL_MS);
