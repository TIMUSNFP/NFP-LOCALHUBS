// utils.js — shared helpers: ID generation, row <-> camelCase mapping, geocoding, haversine.

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return `${year}${month}${day}`;
}

function randomDigits4() {
  return Math.floor(1000 + Math.random() * 9000);
}

// Mirrors generateRegId() in script.js: NFP-HUB-YYYYMMDD-NNNN
function generateHubId() {
  return `NFP-HUB-${todayStamp()}-${randomDigits4()}`;
}

// Mirrors generateParticipantId() in script.js: NFP-PART-YYYYMMDD-NNNN
function generateParticipantId() {
  return `NFP-PART-${todayStamp()}-${randomDigits4()}`;
}

// Converts a hubs DB row (snake_case) to the camelCase API shape.
function hubRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    submittedAt: row.submitted_at,
    lastUpdated: row.last_updated,
    status: row.status,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    membership: row.membership,
    city: row.city,
    area: row.area,
    address: row.address,
    pincode: row.pincode,
    venueType: row.venue_type,
    capacity: row.capacity,
    hostedBefore: row.hosted_before,
    hostingFrequency: row.hosting_frequency,
    lat: row.lat,
    lng: row.lng,
  };
}

// Converts a participants DB row (snake_case) to the camelCase API shape.
function participantRowToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    registeredAt: row.registered_at,
    status: row.status,
    fullName: row.full_name,
    email: row.email,
    mobile: row.mobile,
    membership: row.membership,
    note: row.note,
    hubId: row.hub_id,
  };
}

// Haversine distance in km between two lat/lng points.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'NFPCircles/1.0';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Geocodes a single free-text query against Nominatim. Returns [lat, lng] or null.
// Uses a hard timeout so a slow geocoder can never hang the request indefinitely.
async function geocodeQuery(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=in`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng];
    }
  } catch (e) {
    // try next query (includes abort/timeout)
  } finally {
    clearTimeout(timer);
  }
  return null;
}

// Mirrors geocodeHub() in script.js: tries address -> area -> city, most specific first,
// with a 300ms delay between fallback attempts.
async function geocodeHub({ address, area, city }) {
  const queries = [];
  if (address) queries.push(`${address}, ${city}, India`);
  queries.push(`${area}, ${city}, India`);
  queries.push(`${city}, India`);

  for (const query of queries) {
    const coords = await geocodeQuery(query);
    if (coords) return coords;
    await sleep(300);
  }
  return null;
}

module.exports = {
  generateHubId,
  generateParticipantId,
  hubRowToJson,
  participantRowToJson,
  haversineKm,
  geocodeQuery,
  geocodeHub,
  sleep,
};
