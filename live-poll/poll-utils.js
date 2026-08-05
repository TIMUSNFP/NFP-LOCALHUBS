// poll-utils.js — id generation, row <-> camelCase mapping, misc helpers.
const { randomUUID, randomBytes } = require('crypto');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayStamp() {
  const now = new Date();
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
}

function randomDigits4() {
  return Math.floor(1000 + Math.random() * 9000);
}

function generateSessionId() {
  return `NFP-POLL-${todayStamp()}-${randomDigits4()}`;
}
function generateQuestionId() {
  return `NFP-PQ-${randomUUID()}`;
}
function generateParticipantId() {
  return `NFP-PP-${randomUUID()}`;
}
function generateVoteId() {
  return `NFP-PV-${randomUUID()}`;
}

// 6-digit join code, e.g. 384021. Collisions are checked by the caller
// (retry-on-conflict against the unique `code` column) since this module
// has no DB access.
function generateJoinCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Opaque per-device identity, stored in the participant's browser localStorage
// so they can be re-recognised across reloads without a login.
function generateDeviceToken() {
  return randomBytes(24).toString('hex');
}

function sessionRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    currentQuestionId: row.current_question_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
  };
}

function questionRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    orderIndex: row.order_index,
    type: row.type,
    prompt: row.prompt,
    options: row.options,
    correctOption: row.correct_option,
    status: row.status,
    revealed: row.revealed,
  };
}

// Same as questionRowToJson but strips the correct answer — used everywhere
// EXCEPT the host's own question-editing views, so a curious participant
// can't read the answer out of the network tab before a quiz question closes.
function questionRowToPublicJson(row) {
  const json = questionRowToJson(row);
  delete json.correctOption;
  return json;
}

function participantRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    fullName: row.full_name,
    phone: row.phone,
    joinSource: row.join_source,
    circleLeaderHubId: row.circle_leader_hub_id,
    joinedAt: row.joined_at,
  };
}

module.exports = {
  generateSessionId,
  generateQuestionId,
  generateParticipantId,
  generateVoteId,
  generateJoinCode,
  generateDeviceToken,
  sessionRowToJson,
  questionRowToJson,
  questionRowToPublicJson,
  participantRowToJson,
};
