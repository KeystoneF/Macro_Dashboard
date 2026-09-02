const mysql = require('mysql2/promise');

// pooled from the start, connection-per-request bit us on the last project
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 3000, // fail fast, otherwise /api/health just hangs when mysql is down
  timezone: 'Z', // store and read UTC, learned this the hard way on RSS timestamps
});

async function ping() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

module.exports = { pool, ping };
