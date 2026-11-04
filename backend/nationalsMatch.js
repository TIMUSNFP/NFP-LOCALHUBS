// nationalsMatch.js — turns /nationals sign-ups into an Excel work list for the RMs.
//   node backend/nationalsMatch.js [nationalsEdition=3] [hubEdition=<active edition>] [outFile]
// Participants get their 3 nearest Approved circles with seats left (by distance from the place they typed,
// else their pincode, else their city).
// Leaders get how many participant leads wait within 10 km. Cities with waiting participants and no
// circle nearby are listed as "needs a leader". Read-only: nothing is written except the pincode cache.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const XLSX = require('xlsx');
const db = require('./db');
const { haversineKm, geocodeQuery } = require('./utils');

const NEAR_KM = 25;      // a circle farther than this is not "nearby" for a participant
const DEMAND_KM = 10;    // participants within this distance count as demand for a leader
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function coordsFor(pincode) {
  const c = await db.get('SELECT lat, lng FROM pincode_cache WHERE pincode = $1', [pincode]);
  if (c) return [c.lat, c.lng];
  const got = await geocodeQuery(`${pincode}, India`);
  await sleep(1100); // Nominatim allows about one request per second
  if (!got) return null;
  await db.run('INSERT INTO pincode_cache (pincode, lat, lng, cached_at) VALUES ($1,$2,$3,$4) ON CONFLICT (pincode) DO NOTHING', [pincode, got[0], got[1], new Date().toISOString()]);
  return got;
}

(async () => {
  const nEd = parseInt(process.argv[2], 10) || 3;
  const active = parseInt((await db.get("SELECT value FROM settings WHERE key = 'active_edition'")).value, 10);
  const hEd = parseInt(process.argv[3], 10) || active;
  const out = process.argv[4] || 'C:/Users/Network FP/Downloads/Nationals leads - nearest circles.xlsx';

  const leads = await db.all('SELECT * FROM nationals_responses WHERE edition = $1 ORDER BY city, full_name', [nEd]);
  const hubs = await db.all(
    `SELECT h.id, h.full_name, h.area, h.city, h.lat, h.lng, h.capacity,
            (SELECT COUNT(*)::int FROM participants p WHERE p.hub_id = h.id AND p.status <> 'Cancelled') AS filled
       FROM hubs h WHERE h.status = 'Approved' AND h.edition = $1 AND h.lat IS NOT NULL AND h.lng IS NOT NULL`, [hEd]);
  hubs.forEach((h) => { const cap = parseInt(String(h.capacity).replace(/[^0-9]/g, ''), 10); h.left = cap ? Math.max(cap - h.filled, 0) : 99; });

  // Where each person wants to attend: the place they typed, else their pincode, else just their city.
  // Place and city lookups are remembered for this run; an unfound place falls through to the next source.
  const memo = {};
  const place = async (q) => {
    if (!(q in memo)) { memo[q] = await geocodeQuery(`${q}, India`); await sleep(1100); }
    return memo[q];
  };
  for (const l of leads) {
    const area = (l.preferred_area || '').trim();
    let xy = null, by = '';
    if (area) { xy = await place(`${area}, ${l.city}`); by = 'Preferred area'; }
    if (!xy && l.pincode) { xy = await coordsFor(l.pincode); by = 'Pincode'; }
    if (!xy) { xy = await place(l.city); by = 'City centre only'; }
    l.xy = xy; l.by = xy ? by : 'Not found, check by hand';
  }

  const isPart = (l) => l.role.startsWith('Participant');
  const parts = leads.filter(isPart);

  const partRows = parts.map((l) => {
    const near = (l.xy ? hubs.filter((h) => h.left > 0).map((h) => ({ h, km: haversineKm(l.xy[0], l.xy[1], h.lat, h.lng) })).filter((x) => x.km <= NEAR_KM).sort((a, b) => a.km - b.km).slice(0, 3) : []);
    const row = { Name: l.full_name, Mobile: l.mobile, Email: l.email, City: l.city, Pincode: l.pincode || '', 'Preferred area': l.preferred_area || '', 'Located by': l.by, 'May host': l.role === 'Participant, may host' ? 'Yes' : '', 'Circles nearby': near.length || 'None within ' + NEAR_KM + ' km' };
    [0, 1, 2].forEach((i) => {
      const n = near[i];
      row[`Circle ${i + 1}`] = n ? `${n.h.full_name}, ${n.h.area}` : '';
      row[`Circle ${i + 1} km`] = n ? Math.round(n.km * 10) / 10 : '';
      row[`Circle ${i + 1} seats`] = n ? n.h.left : '';
    });
    return { ...row, 'Circle booked': '', RM: '', Status: '', Notes: '' };
  });

  const leaderRows = leads.filter((l) => !isPart(l)).map((l) => ({
    Name: l.full_name, Mobile: l.mobile, Email: l.email, City: l.city, Pincode: l.pincode || '', Type: l.role,
    'Led before': l.led_before === 'yes' ? 'Yes' : 'No', 'Earlier circle': l.previous_hub_id || '', 'Same venue': l.same_venue || '',
    Address: l.address || '', 'Venue type': l.venue_type || '', Capacity: l.capacity || '',
    'Participants waiting within 10 km': l.xy ? parts.filter((p) => p.xy && haversineKm(l.xy[0], l.xy[1], p.xy[0], p.xy[1]) <= DEMAND_KM).length : '',
    RM: '', Status: '', Notes: '',
  }));

  const waiting = {};
  partRows.filter((r) => typeof r['Circles nearby'] === 'string').forEach((r) => { (waiting[r.City] ||= { City: r.City, 'Participants with no circle nearby': 0, 'Of them, could host': 0 })['Participants with no circle nearby']++; if (r['May host']) waiting[r.City]['Of them, could host']++; });

  const wb = XLSX.utils.book_new();
  const add = (data, name) => { const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ Note: 'No rows yet' }]); ws['!autofilter'] = { ref: ws['!ref'] }; XLSX.utils.book_append_sheet(wb, ws, name); };
  add(partRows, 'Participants');
  add(leaderRows, 'Leaders');
  add(Object.values(waiting).sort((a, b) => b['Participants with no circle nearby'] - a['Participants with no circle nearby']), 'Cities needing a leader');
  XLSX.writeFile(wb, out);
  console.log(`edition ${nEd} leads: ${leads.length} | participants ${partRows.length} (no circle nearby: ${partRows.filter((r) => typeof r['Circles nearby'] === 'string').length}) | leaders ${leaderRows.length} | matched against edition ${hEd} circles: ${hubs.length}`);
  console.log('saved', out);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
