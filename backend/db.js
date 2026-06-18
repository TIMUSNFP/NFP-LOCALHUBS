// db.js — SQLite connection + schema bootstrap for NFP Circles backend.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'nfp.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS hubs (
    id TEXT PRIMARY KEY,
    submitted_at TEXT NOT NULL,
    last_updated TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    mobile TEXT NOT NULL,
    membership TEXT NOT NULL,
    city TEXT NOT NULL,
    area TEXT NOT NULL,
    address TEXT,
    pincode TEXT NOT NULL,
    venue_type TEXT NOT NULL,
    capacity TEXT NOT NULL,
    hosted_before TEXT,
    hosting_frequency TEXT,
    lat REAL,
    lng REAL
  );

  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    registered_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Confirmed',
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    mobile TEXT NOT NULL,
    membership TEXT NOT NULL,
    note TEXT,
    hub_id TEXT NOT NULL REFERENCES hubs(id)
  );

  CREATE TABLE IF NOT EXISTS pincode_cache (
    pincode TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    cached_at TEXT NOT NULL
  );
`);

module.exports = db;
