// api/index.js — Vercel serverless function entry point.
//
// Vercel turns every file under /api into a function. The vercel.json rewrite
// sends all /api/* requests here, and we hand them to the Express app, which has
// its routes mounted at /api/hubs, /api/participants, /api/geo, /api/admin.
module.exports = require('../backend/app');
