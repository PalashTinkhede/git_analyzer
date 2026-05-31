require('dotenv').config();
const express       = require('express');
const rateLimit     = require('express-rate-limit');
const profileRoutes = require('./routes/profiles');

// Import both configs — they connect and log status on startup
require('./config/db');     // ✅ MySQL connected
require('./config/redis');  // ✅ Redis connected

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

// Parse JSON bodies
app.use(express.json());

// Global rate limiter: 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});
app.use(limiter);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api', profileRoutes);

// Root health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'GitHub Profile Analyzer API — with Redis cache',
    version: '2.0.0',
    endpoints: {
      analyze:    'POST   /api/analyze/:username',
      list:       'GET    /api/profiles',
      single:     'GET    /api/profiles/:username',
      compare:    'GET    /api/compare?a=user1&b=user2',
      delete:     'DELETE /api/profiles/:username',
      clearCache: 'DELETE /api/cache/:username',
      cacheStats: 'GET    /api/cache/stats',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

module.exports = app;
