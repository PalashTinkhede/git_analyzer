const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setup() {
  let host     = process.env.DB_HOST     || '127.0.0.1';
  let port     = parseInt(process.env.DB_PORT) || 3306;
  let user     = process.env.DB_USER     || 'root';
  let password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'root';
  let database = process.env.DB_NAME     || 'github_analyzer';

  const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (mysqlUrl) {
    try {
      const parsed = new URL(mysqlUrl);
      host = parsed.hostname;
      port = parseInt(parsed.port) || 3306;
      user = parsed.username;
      password = decodeURIComponent(parsed.password || '');
      database = parsed.pathname.substring(1);
    } catch (err) {
      console.warn('⚠️ Failed to parse MYSQL_URL, using individual environment variables instead:', err.message);
    }
  }

  // On Render (and other cloud providers), managed MySQL requires SSL.
  // Set DB_SSL=true in Render's environment variables to enable it.
  const useSSL = process.env.DB_SSL === 'true';

  const connectionConfig = {
    host,
    port,
    user,
    password,
    multipleStatements: true,
    ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
  };

  console.log(`🔧 DB Setup: Connecting to MySQL at ${host}:${port} as ${user}... (SSL: ${useSSL})`);

  let connection;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      connection = await mysql.createConnection(connectionConfig);
      console.log(`✅ Connected to MySQL host (attempt ${attempt}).`);
      break; // success — exit retry loop
    } catch (err) {
      lastError = err;
      console.warn(`⚠️  Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        console.log(`   Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  if (!connection) {
    console.error(`❌ Could not connect to MySQL after ${MAX_RETRIES} attempts.`);
    console.error('   Last error:', lastError?.message);
    process.exit(1); // ← Fail loudly so Render knows the deploy failed
  }

  try {
    // Create database (may fail on managed DBs where DB already exists — that's fine)
    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\`;`);
      console.log(`Database "${database}" checked/created.`);
    } catch (err) {
      // Managed DBs (e.g. Render MySQL) often pre-create the DB; skip if forbidden
      console.warn(`⚠️  Could not CREATE DATABASE (may already exist): ${err.message}`);
    }

    // Use the database
    await connection.query(`USE \`${database}\`;`);

    // Resolve schema.sql — try multiple locations to be resilient
    const possiblePaths = [
      path.join(__dirname, '../../schema.sql'),       // local / Docker
      path.join(process.cwd(), 'schema.sql'),          // root of cwd (Render)
      path.join(__dirname, '../../../schema.sql'),      // one level up
    ];

    let schemaSql = null;
    for (const schemaPath of possiblePaths) {
      if (fs.existsSync(schemaPath)) {
        schemaSql = fs.readFileSync(schemaPath, 'utf8');
        console.log(`📄 Found schema.sql at: ${schemaPath}`);
        break;
      }
    }

    if (!schemaSql) {
      throw new Error(`schema.sql not found. Tried: ${possiblePaths.join(', ')}`);
    }

    // Filter out CREATE DATABASE / USE statements (already handled above)
    const cleanQueries = schemaSql
      .split(';')
      .map(q => q.trim())
      .filter(q =>
        q.length > 0 &&
        !q.toLowerCase().startsWith('create database') &&
        !q.toLowerCase().startsWith('use ')
      );

    for (const query of cleanQueries) {
      console.log(`  ↳ Running: ${query.substring(0, 60).replace(/\n/g, ' ')}...`);
      await connection.query(query);
    }

    console.log('✅ Database and tables initialized successfully.');
  } catch (error) {
    console.error('❌ Database schema setup failed:', error.message);
    process.exit(1); // ← Fail loudly
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

setup();
