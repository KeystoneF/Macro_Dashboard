// Create or update an analyst: node sql/seed-user.js <email> <name>.
// Read the password from stdin or SEED_PASSWORD, never argv.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const users = require('../auth/users');

const [email, name] = process.argv.slice(2);

function askPassword() {
  if (process.env.SEED_PASSWORD) return Promise.resolve(process.env.SEED_PASSWORD);
  return new Promise((resolve) => {
    process.stdout.write('Password: ');
    const rl = require('node:readline').createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      rl.close();
      process.stdout.write('\n');
      resolve(line);
    });
  });
}

async function main() {
  if (!email || !name) {
    console.error('usage: node sql/seed-user.js <email> <name>');
    process.exit(1);
  }

  const password = await askPassword();
  if (password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
    console.error('password must be at least 10 characters and at most 72 UTF-8 bytes');
    process.exit(1);
  }

  const existing = await users.byEmail(email);
  if (existing) {
    // Resetting a password also revokes existing sessions.
    await pool.query(
      'UPDATE users SET name = $1, password_hash = $2, token_version = token_version + 1 WHERE id = $3',
      [name, await bcrypt.hash(password, 12), existing.id],
    );
    console.log(`updated ${email}, and signed out every session it had open`);
  } else {
    await users.create({ email, name, password });
    console.log(`created ${email}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
