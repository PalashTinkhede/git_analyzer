const mysql = require('mysql2/promise');
require('dotenv').config();

// Set DB_SSL=true in Render (or any cloud environment) to enable SSL
const useSSL = process.env.DB_SSL === 'true';

// Support connection URL (like Railway's MYSQL_URL or DATABASE_URL)
let host = process.env.DB_HOST || '127.0.0.1';
let port = parseInt(process.env.DB_PORT) || 3306;
let user = process.env.DB_USER || 'root';
let password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root';
let database = process.env.DB_NAME || 'github_analyzer';

const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
if (mysqlUrl) {
  try {
    const parsed = new URL(mysqlUrl);
    host = parsed.hostname;
    port = parseInt(parsed.port) || 27871;
    user = parsed.username;
    password = decodeURIComponent(parsed.password || '');
    database = parsed.pathname.substring(1);
  } catch (err) {
    console.warn('⚠️ Failed to parse MYSQL_URL, using individual environment variables instead:', err.message);
  }
}

const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL connected');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL connection failed:', err.message);
    // In production (Render), a failed DB connection is fatal
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  });

module.exports = pool;

