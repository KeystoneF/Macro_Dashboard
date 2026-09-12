const bcrypt = require('bcryptjs');
const { pool } = require('../db');

// Keep password hashing deliberately expensive.
const ROUNDS = 12;

const byEmail = async (email) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, password_hash, token_version FROM users WHERE email = $1 LIMIT 1',
    [String(email).trim().toLowerCase()],
  );
  return rows[0] || null;
};

const byId = async (id) => {
  const { rows } = await pool.query(
    'SELECT id, email, name, token_version FROM users WHERE id = $1 LIMIT 1',
    [id],
  );
  return rows[0] || null;
};

async function create({ email, name, password }) {
  const hash = password ? await bcrypt.hash(password, ROUNDS) : null;
  const { rows } = await pool.query(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [String(email).trim().toLowerCase(), name, hash],
  );
  return { id: rows[0].id, email, name };
}

// Run bcrypt for unknown accounts too, to reduce timing differences.
const DUMMY_HASH = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function authenticate(email, password) {
  const user = await byEmail(email);
  const hash = (user && user.password_hash) || DUMMY_HASH;
  const ok = await bcrypt.compare(String(password ?? ''), hash);
  if (!user || !user.password_hash || !ok) return null;

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  return { id: user.id, email: user.email, name: user.name, tokenVersion: user.token_version };
}

// Revoke this version without affecting sessions issued after an earlier logout.
async function bumpTokenVersion(id, version) {
  const { rows } = await pool.query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1 AND token_version = $2 RETURNING token_version',
    [id, version],
  );
  return rows[0] ? rows[0].token_version : null;
}

module.exports = { byEmail, byId, create, authenticate, bumpTokenVersion };
