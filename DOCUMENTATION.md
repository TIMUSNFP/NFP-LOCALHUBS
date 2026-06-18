# NFP LOCALHUBS — Full Project Documentation

## Project Overview

A multi-site platform for **NFP Circles** — hub leader registration, participant discovery, and admin management. Built with **Node.js/Express + SQLite** backend and **vanilla HTML/CSS/JS** frontend sites deployed to Vercel.

---

## Architecture

```
NFP LOCALHUBS/
├── backend/                  ← Express.js API + SQLite DB
├── sites/
│   ├── hub-leader/           ← Hub host registration site
│   ├── participant/          ← Participant discovery & join site
│   └── admin/                ← Admin management portal
├── index.html                ← Legacy single-page landing
├── script.js                 ← Shared frontend logic
├── styles.css                ← Shared frontend styles
├── pin-editor-server.js      ← Hero map pin editor (dev tool)
└── pin-editor.html           ← Pin editor UI
```

---

## Backend

**Stack:** Node.js + Express 4.19.2, SQLite (better-sqlite3), bcryptjs, jsonwebtoken, cors

| File | Purpose |
|---|---|
| `backend/server.js` | Entry point, Express app setup, route mounting |
| `backend/db.js` | SQLite connection, schema creation, table init |
| `backend/utils.js` | ID generators, row mappers, geocoding, haversine |
| `backend/seed.js` | Demo data seeder (12 hubs across 10 cities) |
| `backend/middleware/auth.js` | JWT bearer token verification middleware |
| `backend/data/nfp.sqlite` | SQLite database file |

### Running the Backend

```bash
cd backend
npm install
npm start          # production
npm run dev        # dev with nodemon
npm run seed       # seed demo data manually
```

**Default port:** `4000`

---

## Database Schema

### `hubs` — Hub leader registrations

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Format: `NFP-HUB-YYYYMMDD-NNNN` |
| `submitted_at` | TEXT | ISO 8601 |
| `last_updated` | TEXT | ISO 8601, nullable |
| `status` | TEXT | `Pending` / `Approved` / `Rejected` |
| `full_name` | TEXT | |
| `email` | TEXT | |
| `mobile` | TEXT | 10-digit |
| `membership` | TEXT | CFP Professional, QPFP Certificant, etc. |
| `city` | TEXT | |
| `area` | TEXT | |
| `address` | TEXT | nullable |
| `pincode` | TEXT | 6-digit |
| `venue_type` | TEXT | Own Office, Home, Co-working Space, etc. |
| `capacity` | TEXT | 6-10 People, 10-20 People, etc. |
| `hosted_before` | TEXT | Yes / No, nullable |
| `hosting_frequency` | TEXT | One Time Only, Multiple Times, etc., nullable |
| `lat` | REAL | nullable — async geocoded via Nominatim |
| `lng` | REAL | nullable — async geocoded via Nominatim |

### `participants` — Event participants

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Format: `NFP-PART-YYYYMMDD-NNNN` |
| `registered_at` | TEXT | ISO 8601 |
| `status` | TEXT | `Confirmed` / `Cancelled` |
| `full_name` | TEXT | |
| `email` | TEXT | |
| `mobile` | TEXT | |
| `membership` | TEXT | |
| `note` | TEXT | nullable |
| `hub_id` | TEXT FK | References `hubs.id` |

### `pincode_cache` — Geocoding cache

| Column | Type | Notes |
|---|---|---|
| `pincode` | TEXT PK | 6-digit Indian pincode |
| `lat` | REAL | |
| `lng` | REAL | |
| `cached_at` | TEXT | ISO 8601 |

---

## API Endpoints

**Base URL (local):** `http://localhost:4000/api`  
**Base URL (current frontend config):** `http://192.168.29.34:4000/api`

> Before deploying, update the hardcoded IP in all three `sites/*/script.js` files to your production backend URL.

---

### Public Endpoints (no auth required)

---

#### `GET /api/health`

Health check.

```json
{ "ok": true, "time": "2026-06-18T10:00:00.000Z" }
```

---

#### `POST /api/hubs`

Register a new hub leader. Geocoding runs async in the background.

**Request body:**

```json
{
  "fullName": "Rajesh Kumar",
  "email": "rajesh@example.com",
  "mobile": "9876543210",
  "membership": "CFP Professional",
  "city": "Mumbai",
  "area": "Andheri",
  "address": "123 Main St",
  "pincode": "400053",
  "venueType": "Own Office",
  "capacity": "10-20 People",
  "hostedBefore": "Yes",
  "hostingFrequency": "Multiple Times"
}
```

**Required fields:** `fullName`, `email`, `mobile`, `membership`, `city`, `area`, `pincode`, `venueType`, `capacity`

**Response `201`:**

```json
{
  "id": "NFP-HUB-20260618-0001",
  "submittedAt": "2026-06-18T10:00:00.000Z",
  "lastUpdated": null,
  "status": "Pending",
  "fullName": "Rajesh Kumar",
  "email": "rajesh@example.com",
  "mobile": "9876543210",
  "membership": "CFP Professional",
  "city": "Mumbai",
  "area": "Andheri",
  "address": "123 Main St",
  "pincode": "400053",
  "venueType": "Own Office",
  "capacity": "10-20 People",
  "hostedBefore": "Yes",
  "hostingFrequency": "Multiple Times",
  "lat": null,
  "lng": null
}
```

**Errors:** `400` missing required fields

---

#### `GET /api/hubs`

List hubs. Optionally filter by status.

**Query params:**

| Param | Example | Notes |
|---|---|---|
| `status` | `Approved` | Single value |
| `status` | `Approved,Pending` | Comma-separated multiple |

**Response `200`:** Array of hub objects sorted by `submittedAt` DESC.

---

#### `GET /api/hubs/:id`

Get a single hub by ID.

**Response `200`:** Hub object.  
**Errors:** `404` not found.

---

#### `POST /api/participants`

Register a participant for an approved hub.

**Request body:**

```json
{
  "fullName": "Priya Sharma",
  "email": "priya@example.com",
  "mobile": "9123456789",
  "membership": "QPFP Certificant",
  "hubId": "NFP-HUB-20260618-0001",
  "note": "Looking forward to it!"
}
```

**Required fields:** `fullName`, `email`, `mobile`, `membership`, `hubId`

**Response `201`:**

```json
{
  "id": "NFP-PART-20260618-0001",
  "registeredAt": "2026-06-18T10:00:00.000Z",
  "status": "Confirmed",
  "fullName": "Priya Sharma",
  "email": "priya@example.com",
  "mobile": "9123456789",
  "membership": "QPFP Certificant",
  "note": "Looking forward to it!",
  "hubId": "NFP-HUB-20260618-0001",
  "hubLeader": "Rajesh Kumar",
  "hubCity": "Mumbai",
  "hubArea": "Andheri",
  "hubVenue": "Own Office"
}
```

**Errors:** `400` missing fields or hub not Approved, `404` hub not found.

---

#### `GET /api/geo/nearby-hubs?pincode=400001`

Find approved hubs near a given Indian pincode, sorted by distance (nearest first).

**Query params:**

| Param | Required | Notes |
|---|---|---|
| `pincode` | Yes | 6-digit Indian pincode |

**Response `200`:**

```json
[
  {
    "id": "NFP-HUB-20260618-0001",
    "fullName": "Rajesh Kumar",
    "city": "Mumbai",
    "area": "Andheri",
    "venueType": "Own Office",
    "capacity": "10-20 People",
    "lat": 19.1136,
    "lng": 72.8697,
    "distanceKm": 3.2
  }
]
```

**Errors:** `400` invalid pincode (not 6 digits), `404` pincode cannot be geocoded.  
Pincode results are cached in `pincode_cache` to reduce Nominatim API calls.

---

#### `POST /api/admin/login`

Get an admin JWT token.

**Request body:**

```json
{ "email": "admin@networkfp.com", "password": "admin123" }
```

**Response `200`:**

```json
{ "token": "<JWT — 12h expiry>" }
```

**Errors:** `401` invalid credentials.

---

### Protected Endpoints (JWT required)

All protected routes require the header:

```
Authorization: Bearer <token>
```

**Errors:** `401` missing/invalid token, `403` insufficient permissions.

---

#### `GET /api/admin/hubs`

List all hubs across all statuses for admin review.

**Response `200`:** Array of all hub objects sorted by `submittedAt` DESC.

---

#### `PATCH /api/admin/hubs/:id/status`

Approve or reject a hub application.

**Request body:**

```json
{ "status": "Approved" }
```

**Valid values:** `Approved`, `Rejected`

**Response `200`:** Updated hub object with `lastUpdated` set to current time.

**Errors:** `400` invalid status value, `404` hub not found.

---

#### `GET /api/admin/participants`

List all participants with joined hub info.

**Response `200`:**

```json
[
  {
    "id": "NFP-PART-20260618-0001",
    "registeredAt": "2026-06-18T10:00:00.000Z",
    "status": "Confirmed",
    "fullName": "Priya Sharma",
    "email": "priya@example.com",
    "mobile": "9123456789",
    "membership": "QPFP Certificant",
    "note": "",
    "hubId": "NFP-HUB-20260618-0001",
    "hubLeader": "Rajesh Kumar",
    "hubCity": "Mumbai",
    "hubArea": "Andheri",
    "hubVenue": "Own Office"
  }
]
```

---

#### `PATCH /api/admin/participants/:id/status`

Confirm or cancel a participant registration.

**Request body:**

```json
{ "status": "Cancelled" }
```

**Valid values:** `Confirmed`, `Cancelled`

**Response `200`:** Updated participant object.

**Errors:** `400` invalid status value, `404` participant not found.

---

## Endpoint Quick Reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Health check |
| POST | `/api/hubs` | — | Register hub leader |
| GET | `/api/hubs` | — | List hubs (filterable by status) |
| GET | `/api/hubs/:id` | — | Get single hub |
| POST | `/api/participants` | — | Register participant |
| GET | `/api/geo/nearby-hubs?pincode=` | — | Find hubs near pincode |
| POST | `/api/admin/login` | — | Admin login → JWT |
| GET | `/api/admin/hubs` | JWT | All hubs (admin view) |
| PATCH | `/api/admin/hubs/:id/status` | JWT | Approve / Reject hub |
| GET | `/api/admin/participants` | JWT | All participants (admin view) |
| PATCH | `/api/admin/participants/:id/status` | JWT | Confirm / Cancel participant |

---

## Frontend Sites

### Hub Leader Site — `sites/hub-leader/`

| File | Purpose |
|---|---|
| `index.html` | Multi-section landing page + registration form |
| `script.js` | Form submission, gallery carousel, hero map |
| `styles.css` | Styling |

**Features:** Hero section, multi-step form, dynamic city/area/venue dropdowns, gallery carousel, animated hero map (15 Indian cities), toast notifications, mobile responsive.

**API calls:**
- `POST /api/hubs` — submit hub registration
- `GET /api/hubs` — fetch hub list

---

### Participant Site — `sites/participant/`

| File | Purpose |
|---|---|
| `index.html` | Landing page + hub finder + registration form |
| `script.js` | Pincode search, Leaflet.js map, participant registration |
| `styles.css` | Styling |

**Features:** Pincode-based hub finder, Leaflet.js map with hub markers, hub cards with distance + join button, participant registration form, toast notifications, mobile responsive.

**API calls:**
- `GET /api/geo/nearby-hubs?pincode=` — find hubs by pincode
- `POST /api/participants` — register as participant

---

### Admin Portal — `sites/admin/`

| File | Purpose |
|---|---|
| `index.html` | Login page + dashboard |
| `script.js` | Auth, hub/participant management, CSV export, analytics |
| `styles.css` | Styling |

**Features:** JWT login, sidebar navigation, Circle Hosts tab (approve/reject, analytics, CSV export), Participants tab (confirm/cancel, CSV export), session stored in `sessionStorage`.

**API calls:**
- `POST /api/admin/login` — authenticate
- `GET /api/admin/hubs` — load hubs
- `PATCH /api/admin/hubs/:id/status` — approve/reject
- `GET /api/admin/participants` — load participants
- `PATCH /api/admin/participants/:id/status` — update status

---

## Environment Variables

File: `backend/.env`

```env
PORT=4000
JWT_SECRET=<64-char hex string>
ADMIN_EMAIL=admin@networkfp.com
ADMIN_PASSWORD_HASH=<bcrypt hash of password>
ALLOWED_ORIGINS=    # empty = allow all origins (local dev); set to comma-separated URLs for prod
```

File: `backend/.env.example` — same structure with comments, safe to commit.

---

## Deployment

### Frontend — Vercel

The project is already linked to Vercel.

**Config:** `.vercel/project.json`  
**Project name:** `nfp-localhubs`  
**Project ID:** `prj_JBISddiQLKWPRBLCEXVpOEkGMd9m`

```bash
# Deploy from project root
vercel --prod
```

Or push to `master` if Vercel GitHub integration is connected.

> **Before deploying:** Find and replace `http://192.168.29.34:4000` with your production backend URL in:
> - `sites/hub-leader/script.js`
> - `sites/participant/script.js`
> - `sites/admin/script.js`

---

### Backend — Deployment Options

#### Option A: Railway / Render / Fly.io (recommended)

1. Push `backend/` to a repo or connect the monorepo
2. Set environment variables from `.env`
3. Set start command: `node server.js`
4. **Mount a persistent volume** at `/app/data` to preserve `nfp.sqlite`
   - Render: Persistent Disk
   - Railway: Volume mount
   - Fly.io: `fly volumes create`

#### Option B: VPS (Ubuntu/Debian)

```bash
git clone <repo>
cd backend
npm install

# create .env with production values

npm install -g pm2
pm2 start server.js --name nfp-backend
pm2 save
pm2 startup
```

#### Option C: Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY backend/ .
RUN npm install
VOLUME ["/app/data"]
EXPOSE 4000
CMD ["node", "server.js"]
```

```bash
docker build -t nfp-backend .
docker run -d \
  -p 4000:4000 \
  -v /your/host/data:/app/data \
  --env-file backend/.env \
  nfp-backend
```

---

### Database Notes for Production

- **SQLite** works well at this scale but requires a persistent volume. It will be wiped on ephemeral deployments (Vercel Functions, Lambda).
- **Migrate to PostgreSQL** if you need a serverless backend (Neon, Supabase, or Railway Postgres). The query logic is nearly identical — swap `better-sqlite3` for `pg` and convert synchronous calls to `async/await`.
- On first boot, the server auto-seeds 12 demo hubs if the `hubs` table is empty. To skip seeding in production, set a flag or clear the seed condition in `backend/seed.js`.

---

## Data Flow

```
┌─────────────────────┐
│  Hub Leader Site    │ POST /api/hubs
│   sites/hub-leader  │ ─────────────────────────────────────►
└─────────────────────┘                               ┌───────────────────────┐
                                                      │  Express Backend       │
┌─────────────────────┐                               │  localhost:4000        │
│  Participant Site   │ GET  /api/geo/nearby-hubs     │                        │
│   sites/participant │ ─────────────────────────────►│  SQLite DB             │
│                     │ POST /api/participants         │  backend/data/nfp.sqlite│
│                     │ ─────────────────────────────►│                        │
└─────────────────────┘                               │  Nominatim API         │
                                                      │  (async geocoding)     │
┌─────────────────────┐                               └───────────────────────┘
│  Admin Portal       │ POST /api/admin/login                   ▲
│   sites/admin       │ GET/PATCH /api/admin/hubs               │
│                     │ GET/PATCH /api/admin/participants        │
│                     │ ────────────────────────────────────────┘
└─────────────────────┘
  (JWT protected)
```

---

## Dev Tools

### Pin Editor Server

Drag-and-drop editor for repositioning hero map pins on `MapChart_Map.png`.

```bash
node pin-editor-server.js
# Open http://localhost:3001
```

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Serve pin editor UI |
| GET | `/map` | Serve `MapChart_Map.png` |
| GET | `/api/cities` | Return current `HUB_CITIES` array from `script.js` |
| POST | `/api/save` | Update `HUB_CITIES` in `script.js`, git commit & push |

On save, the server writes updated coordinates back to `script.js`, commits to git, and pushes to `origin/master`. Vercel auto-deploys within ~30 seconds.

---

## Demo Credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@networkfp.com` | `admin123` |

---

*Generated: 2026-06-18*
