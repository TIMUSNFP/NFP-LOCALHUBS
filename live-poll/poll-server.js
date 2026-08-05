// poll-server.js — LOCAL development entry point only.
// On Vercel the app runs as a serverless function (see api/index.js).
const app = require('./poll-app');

const PORT = process.env.PORT || 4100;
app.listen(PORT, () => {
  console.log(`NFP Live Poll backend (local) listening on http://localhost:${PORT}`);
});
