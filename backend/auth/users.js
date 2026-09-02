const bcrypt = require('bcryptjs');
const { pool } = require('../db');

// 12 rounds: slow enough to matter against an offline crack, fast enough that a
// sign-in does not feel broken on the box this runs on.
const ROUNDS = 12;

const byEmail = async (email) => {
  const [rows] = await pool.query(
    'SELECT id, email, name, password_hash FROM users WHERE email = ? LIMIT 1',
    [String(email).trim().toLowerCase()],
  );
  return rows[0] || null;
};

const byId = async (id) => {
  const [rows] = await pool.query('SELECT id, email, name FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
};

async function create({ email, name, password }) {
  const hash = password ? await bcrypt.hash(password, ROUNDS) : null;
  const [res] = await pool.query(
    'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
    [String(email).trim().toLowerCase(), name, hash],
  );
  return { id: res.insertId, email, name };
}

// Always runs a comparison, even when the account does not exist, so the time
// taken does not tell an attacker which addresses are registered.
const DUMMY_HASH = '$2a$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

async function authenticate(email, password) {
  const user = await byEmail(email);
  const hash = (user && user.password_hash) || DUMMY_HASH;
  const ok = await bcrypt.compare(String(password ?? ''), hash);
  if (!user || !user.password_hash || !ok) return null;

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
  return { id: user.id, email: user.email, name: user.name };
}

module.exports = { byEmail, byId, create, authenticate };
