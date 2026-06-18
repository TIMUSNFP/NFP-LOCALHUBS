# NFP Circles — Backend API

Node.js + Express + SQLite backend for the NFP Circles platform. Replaces the
localStorage-based data layer used by the legacy static site with a real API
that the hub-leader, participant, and admin frontends consume.

## Stack

- Express
- better-sqlite3 (file-based SQLite at `data/nfp.sqlite`)
- bcryptjs (admin password hashing)
- jsonwebtoken (admin auth)
- cors
- dotenv

## Install

```bash
cd backend
npm install
```

## Configure

A working `.env` is already committed for local/demo use (see `.env.example`
for the same values with comments). Replace `JWT_SECRET` and
`ADMIN_PASSWORD_HASH` before using this in real production.

Demo admin credentials:

- Email: `admin@networkfp.com`
- Password: `admin123`

## Seed demo data

```bash
npm run seed
```

Inserts the same 12 demo hubs the old static site seeded into localStorage
(6 of them `Approved`). This also runs automatically on server boot if the
`hubs` table is empty, so `npm start` alone is enough on a fresh clone.

## Run

```bash
npm start
```

Server listens on `PORT` from `.env` (default `4000`).

## Database

SQLite file lives at `backend/data/nfp.sqlite` (gitignored). Schema is created
automatically on boot if missing — see `db.js`. Tables: `hubs`, `participants`,
`pincode_cache`.

## CORS

Set `ALLOWED_ORIGINS` (comma-separated) in `.env` to restrict allowed origins.
If unset, the server reflects any origin (`origin: true`) — convenient for
local development with multiple frontend dev servers, but **lock this down
before real production use**.

## Geocoding

Hub addresses are geocoded asynchronously after creation via the free
[Nominatim](https://nominatim.openstreetmap.org/) API (OpenStreetMap), trying
`address → area → city` queries in order, most specific first. Pincode
lookups for `/api/geo/nearby-hubs` are cached in `pincode_cache` to avoid
repeat calls. Nominatim usage policy requires a `User-Agent` header and
courteous rate limiting — this app waits 300ms between fallback query
attempts and does not parallelize geocoding requests.

---

## API Reference

Base URL: `http://localhost:4000/api`

All requests/responses are JSON. All response objects use camelCase keys.

### Health

```bash
curl http://localhost:4000/api/health
```

### Public — Hubs

**Create a hub registration**

```
POST /api/hubs
```

```bash
curl -X POST http://localhost:4000/api/hubs \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test Leader",
    "email": "test.leader@example.com",
    "mobile": "9876543210",
    "membership": "CFP Professional",
    "city": "Mumbai",
    "area": "Bandra West",
    "address": "Linking Road, Bandra West",
    "pincode": "400050",
    "venueType": "Own Office",
    "capacity": "6-10 People",
    "hostedBefore": "No",
    "hostingFrequency": "Multiple Times"
  }'
```

Returns `201` with the created hub (`status: "Pending"`, `lat`/`lng` initially
`null`). The server geocodes the address in the background and updates the
row once a Nominatim match is found — poll `GET /api/hubs/:id` to see it land.

**List hubs**

```
GET /api/hubs
GET /api/hubs?status=Approved
GET /api/hubs?status=Approved,Pending
```

```bash
curl http://localhost:4000/api/hubs
curl "http://localhost:4000/api/hubs?status=Approved,Pending"
```

**Get a single hub**

```bash
curl http://localhost:4000/api/hubs/NFP-HUB-20241015-1073
```

404s with `{"error":"Hub not found"}` if the id doesn't exist.

### Public — Participants

**Register a participant against an Approved hub**

```
POST /api/participants
```

```bash
curl -X POST http://localhost:4000/api/participants \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test Participant",
    "email": "part@example.com",
    "mobile": "9123456789",
    "membership": "ProMember",
    "note": "Looking forward to it",
    "hubId": "NFP-HUB-20241015-1073"
  }'
```

Returns `201` with the created participant plus joined hub display fields:
`hubLeader`, `hubCity`, `hubArea`, `hubVenue`.

Errors:
- `404 {"error":"Hub not found"}` — `hubId` doesn't exist
- `400 {"error":"This hub is not open for registration yet."}` — hub isn't `Approved`

### Public — Geo

**Find approved hubs near a pincode**

```
GET /api/geo/nearby-hubs?pincode=400001
```

```bash
curl "http://localhost:4000/api/geo/nearby-hubs?pincode=400001"
```

Returns an array of hub objects (each with a `distanceKm` field, rounded to 1
decimal), sorted nearest-first. `400` if the pincode isn't 6 digits, `404
{"error":"Could not locate that PIN code."}` if it can't be geocoded.

### Admin

All admin routes except `/login` require `Authorization: Bearer <token>`.

**Login**

```bash
curl -X POST http://localhost:4000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@networkfp.com","password":"admin123"}'
```

Returns `{"token": "..."}` (12h expiry) on success, `401
{"error":"Invalid credentials"}` on failure.

**List all hubs (any status)**

```bash
TOKEN="paste-token-here"
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/admin/hubs
```

**Approve / reject a hub**

```bash
curl -X PATCH http://localhost:4000/api/admin/hubs/NFP-HUB-20241115-1000/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"Approved"}'
```

`status` must be `Approved` or `Rejected`. Sets `lastUpdated`. 404 if hub
doesn't exist.

**List all participants (joined with hub info)**

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/admin/participants
```

**Update a participant's status**

```bash
curl -X PATCH http://localhost:4000/api/admin/participants/NFP-PART-20260616-8822/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"Cancelled"}'
```

`status` must be `Confirmed` or `Cancelled`.

## Project layout

```
backend/
  data/               sqlite file lives here (gitignored)
  middleware/
    auth.js           requireAdmin JWT middleware
  routes/
    hubs.js           POST/GET /api/hubs, GET /api/hubs/:id
    participants.js   POST /api/participants
    geo.js            GET /api/geo/nearby-hubs
    admin.js          /api/admin/* (login + protected CRUD)
  db.js               SQLite connection + schema bootstrap
  utils.js            ID generation, row<->JSON mapping, geocoding, haversine
  seed.js             demo data seeding (12 hubs, matches legacy script.js)
  server.js           Express app entry point
  .env / .env.example environment config
```
