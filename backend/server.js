// server.js — LOCAL development entry point only.
//
// On Vercel the app runs as a serverless function (see api/index.js) and this
// file is NOT used. Run locally with:  npm run dev
const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`NFP Circles backend (local) listening on http://localhost:${PORT}`);
});
