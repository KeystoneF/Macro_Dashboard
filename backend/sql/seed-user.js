// Creates or repoints one analyst account. Run it to get into a fresh install:
//   node sql/seed-user.js analyst@keystone.ca "Name"
//
// The password is read from the prompt, not from argv, because an argument
// lands in shell history and in the process list where anyone on the box can
// read it. SEED_PASSWORD in the environment works too, for scripting.
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
      resolve(line.trim());
    });
  });
}

async function main() {
  if (!email || !name) {
    console.error('usage: node sql/seed-user.js <email> <name>');
    process.exit(1);
  }

  const password = await askPassword();
  if (password.length < 10) {
    console.error('password must be at least 10 characters');
    process.exit(1);
  }

  const existing = await users.byEmail(email);
  if (existing) {
    await pool.query('UPDATE users SET name = $1, password_hash = $2 WHERE id = $3', [
      name,
      await bcrypt.hash(password, 12),
      existing.id,
    ]);
    console.log(`updated ${email}`);
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
