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
    pocRole: row.poc_role,
    lat: row.lat,
    lng: row.lng,
    rosterSentAt: row.roster_sent_at,
    pendingChangeSummary: row.pending_change_summary || null,
    changeNotifiedAt: row.change_notified_at,
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

// City-centre reference points, used only to sanity-check a Nominatim geocode
// result (reject it if implausibly far from the city) and as an ultimate
// fallback if every geocode attempt fails or gets rejected. Kept in sync with
// the identically-named table in participant/script.js (frontend fallback
// pin) — duplicated rather than shared because the frontend is plain
// browser JS with no build step to import a backend module from.
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

// Sprawling metros get a wider allowed radius (e.g. Mumbai/Navi Mumbai/Thane
// legitimately span 30-40km) — everything else uses the tighter default.
const METRO_CITIES = new Set([
  'mumbai', 'bangalore', 'bengaluru', 'delhi', 'new delhi', 'pune', 'chennai',
  'hyderabad', 'ahmedabad', 'kolkata',
]);
const DEFAULT_MAX_KM = 25;
const METRO_MAX_KM = 40;

function getCityCoords(city) {
  if (!city) return null;
  const key = Object.keys(CITY_COORDS).find((k) => k.toLowerCase() === city.toLowerCase().trim());
  return key ? CITY_COORDS[key] : null;
}

// A geocode result is only judged implausible if we have a known city-centre
// reference to compare it against — cities missing from CITY_COORDS are
// accepted as-is (same behaviour as before this check existed).
function isPlausibleGeocode([lat, lng], city) {
  const ref = getCityCoords(city);
  if (!ref) return true;
  const maxKm = METRO_CITIES.has((city || '').toLowerCase().trim()) ? METRO_MAX_KM : DEFAULT_MAX_KM;
  return haversineKm(lat, lng, ref[0], ref[1]) <= maxKm;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs one Nominatim lookup — either a structured query (params object, e.g.
// { street, postalcode, city }) or a freeform { q: '...' } query — and returns
// [lat, lng] or null. Hard timeout so a slow geocoder can never hang the request.
async function runGeocodeRequest(params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const qs = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'in', ...params });
    const res = await fetch(`${NOMINATIM_URL}?${qs}`, {
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

// Geocodes a single free-text query against Nominatim. Returns [lat, lng] or null.
async function geocodeQuery(query) {
  return runGeocodeRequest({ q: query });
}

// A bare `postalcode` structured search, when Nominatim has no data for that
// exact pincode, has been observed to silently substitute an unrelated
// postcode's centroid in the same city rather than returning no results (e.g.
// asking for Mumbai pincode 400093 came back with a point tagged 400051) — and
// because that result is still "somewhere in the right city" it would pass
// isPlausibleGeocode and get accepted, pre-empting the more precise area-level
// fallback that runs after it. Requests addressdetails and only accepts the
// result if it actually echoes back the pincode that was asked for.
async function runVerifiedPostcodeRequest(params, expectedPincode) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const qs = new URLSearchParams({ format: 'json', limit: '1', countrycodes: 'in', addressdetails: '1', ...params });
    const res = await fetch(`${NOMINATIM_URL}?${qs}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].address && data[0].address.postcode === expectedPincode) {
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

// Tries the most specific lookup first, falling back to progressively coarser ones,
// with a 300ms delay between attempts (Nominatim's usage policy caps at 1 req/sec).
// PIN code is used wherever available via Nominatim's structured `postalcode` param,
// which narrows results to the actual postal area — free-text address matching alone
// was frequently falling back to the city centroid for Indian addresses.
//
// Nominatim occasionally mismatches an address to an unrelated place with a
// similar name (or a postcode boundary that clips into water), landing the
// result far outside the actual city. Each attempt's result is checked against
// CITY_COORDS via isPlausibleGeocode before being accepted — an implausible
// result is treated as a miss and the next, coarser attempt is tried instead.
// If every attempt is missing or implausible, we fall back to the known city
// centroid rather than risk planting the pin somewhere absurd.
async function geocodeHub({ address, area, city, pincode }) {
  const attempts = [];

  if (address && pincode) {
    attempts.push(() => runVerifiedPostcodeRequest({ street: address, postalcode: pincode, city, country: 'India' }, pincode));
  }
  if (address) {
    attempts.push(() => geocodeQuery(pincode ? `${address}, ${pincode}, ${city}, India` : `${address}, ${city}, India`));
  }
  // Indian addresses often lead with a flat/plot/unit/building-name token (e.g.
  // "226, Avior Corporate Park, LBS Marg, ...") that free Nominatim frequently
  // has no record of — stripping that leading token and retrying occasionally
  // matches the surrounding road/landmark where the full string didn't.
  const strippedAddress = address && address.replace(/^\s*[\w#/.-]{1,12}\s*,\s*/, '').trim();
  if (strippedAddress && strippedAddress !== address) {
    attempts.push(() =>
      geocodeQuery(pincode ? `${strippedAddress}, ${pincode}, ${city}, India` : `${strippedAddress}, ${city}, India`)
    );
  }
  // Area-level lookups are the most reliably precise fallback for Indian
  // addresses — well-known localities like "Andheri East" are mapped in OSM
  // even when the exact building isn't. Tried before the bare-postcode
  // structured queries below, since those have been observed to silently
  // return an unrelated postcode's centroid rather than failing outright.
  if (area && pincode) {
    attempts.push(() => geocodeQuery(`${area}, ${pincode}, ${city}, India`));
  }
  attempts.push(() => geocodeQuery(`${area}, ${city}, India`));
  if (pincode) {
    attempts.push(() => runVerifiedPostcodeRequest({ postalcode: pincode, city, country: 'India' }, pincode));
    // Retried without the city constraint too — if the stored city name doesn't
    // exactly match Nominatim's administrative-area name, adding it can cause an
    // otherwise-findable postcode match to fail.
    attempts.push(() => runVerifiedPostcodeRequest({ postalcode: pincode, country: 'India' }, pincode));
  }
  attempts.push(() => geocodeQuery(`${city}, India`));

  for (const attempt of attempts) {
    const coords = await attempt();
    if (coords && isPlausibleGeocode(coords, city)) return coords;
    await sleep(300);
  }
  return getCityCoords(city);
}

module.exports = {
  generateHubId,
  generateParticipantId,
  hubRowToJson,
  participantRowToJson,
  haversineKm,
  geocodeQuery,
  geocodeHub,
  getCityCoords,
  isPlausibleGeocode,
  sleep,
};
