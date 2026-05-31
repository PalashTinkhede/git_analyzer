// src/config/redis.js
const Redis = require('ioredis');
require('dotenv').config();

// Create Redis client with safe defaults
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Render's managed Redis uses TLS (rediss://) — must disable cert validation
const tlsOptions = redisUrl.startsWith('rediss://')
  ? { tls: { rejectUnauthorized: false } }
  : {};

const redis = new Redis(redisUrl, {
  lazyConnect: true,         // don't crash on startup if Redis is down
  enableOfflineQueue: false, // don't queue commands when disconnected
  maxRetriesPerRequest: 1,   // fail fast, don't hang
  connectTimeout: 5000,      // 5 second connection timeout
  ...tlsOptions,
});

// Log connection events
redis.on('connect',      ()    => console.log('✅ Redis connected'));
redis.on('ready',        ()    => console.log('✅ Redis ready'));
redis.on('error',        (err) => console.warn('⚠️  Redis error (app continues without cache):', err.message));
redis.on('reconnecting', ()    => console.log('🔄 Redis reconnecting...'));

// ── HELPER FUNCTIONS ──────────────────────────────────────────────────────────
// All wrapped in try/catch so a Redis failure never crashes the app.
// If Redis is down: gets return null, sets are silently skipped.

/**
 * Get a cached value by key.
 * Returns parsed object or null if not found / Redis down.
 */
async function getCache(key) {
  try {
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.warn(`Cache GET failed for key "${key}":`, err.message);
    return null;
  }
}

/**
 * Set a value in cache with TTL (seconds).
 * Silently skips if Redis is unavailable.
 */
async function setCache(key, value, ttlSeconds) {
  try {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    console.warn(`Cache SET failed for key "${key}":`, err.message);
  }
}

/**
 * Delete one or more specific cache keys.
 * Usage: deleteCache('key1', 'key2', 'key3')
 */
async function deleteCache(...keys) {
  try {
    if (keys.length === 0) return;
    await redis.del(...keys);
  } catch (err) {
    console.warn('Cache DELETE failed:', err.message);
  }
}

/**
 * Delete all keys matching a glob pattern.
 * Usage: deleteCachePattern('db:profiles:*')
 * WARNING: uses KEYS command — fine for small datasets, avoid on huge Redis.
 */
async function deleteCachePattern(pattern) {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`🗑️  Deleted ${keys.length} cache keys matching "${pattern}"`);
    }
  } catch (err) {
    console.warn(`Cache pattern DELETE failed for "${pattern}":`, err.message);
  }
}

/**
 * Get cache stats — useful for a /cache/stats endpoint.
 */
async function getCacheStats() {
  try {
    const info     = await redis.info('stats');
    const keyCount = await redis.dbsize();
    const hits     = info.match(/keyspace_hits:(\d+)/)?.[1]   || '0';
    const misses   = info.match(/keyspace_misses:(\d+)/)?.[1] || '0';
    const total    = parseInt(hits) + parseInt(misses);
    return {
      connected: true,
      totalKeys: keyCount,
      hits:      parseInt(hits),
      misses:    parseInt(misses),
      hitRate:   total > 0 ? ((parseInt(hits) / total) * 100).toFixed(1) + '%' : 'N/A',
    };
  } catch {
    return { connected: false };
  }
}

module.exports = { redis, getCache, setCache, deleteCache, deleteCachePattern, getCacheStats };
