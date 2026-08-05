// poll-middleware.js — requires a valid admin JWT in the Authorization header.
// Mirrors ../backend/middleware/auth.js exactly: this app reuses the SAME
// JWT_SECRET as the main NFP Circles admin panel, so a token issued by either
// login endpoint is valid on either app.
const jwt = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const header = req.headers['authorization'] || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { requireAdmin };
