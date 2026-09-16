// Inspect both the Git index and working copies without printing secret values.
// --head checks the exact commit that share.bat exports.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parse } = require('dotenv');

const root = path.resolve(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const privatePath = (file) => {
  const name = path.posix.basename(file).toLowerCase();
  return (name.startsWith('.env') && name !== '.env.example') ||
    /^keystocks?.*\.json$/.test(name) || /\.postman_(environment|globals)\.json$/.test(name) ||
    /^(?:secrets|credentials)(?:[.-].*)?\.json$/.test(name) ||
    /\.(?:pem|key|p12|pfx|dump|sqlite|sqlite3)$/.test(name) || /^dump.*\.sql$/.test(name) ||
    /(?:^|\/)(?:node_modules|\.next|test-results|playwright-report|logs)\//.test(file);
};

function inspect(text, known = []) {
  const found = [];
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) found.push('private key');
  // Restrict generic key matches to long literal values, not variable references.
  if (/\b(?:apikey|api_key|FMP_API_KEY|FRED_API_KEY|KEYSTOCKS_API_KEY|OPEN_AI_KEY)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9_+\/-]{20,}/i.test(text)) found.push('literal API credential');
  if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/.test(text)) found.push('OpenAI credential');
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|npm_[A-Za-z0-9]{30,})/.test(text)) found.push('GitHub/npm credential');
  for (const [name, value] of known) {
    if (value.length >= 12 && (text.includes(value) || text.includes(encodeURIComponent(value)))) found.push(`configured ${name}`);
  }
  return [...new Set(found)];
}

function localSecrets() {
  const found = [];
  for (const file of ['.env', 'backend/.env', 'frontend/.env.local']) {
    const location = path.join(root, file);
    if (!fs.existsSync(location)) continue;
    for (const [key, value] of Object.entries(parse(fs.readFileSync(location)))) {
      if (/KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL/.test(key)) found.push([key, value]);
    }
  }
  const collection = path.join(root, 'KeyStocks.json');
  if (fs.existsSync(collection)) {
    const data = JSON.parse(fs.readFileSync(collection, 'utf8'));
    for (const item of data.variable || []) if (/TOKEN|KEY$/.test(item.key)) found.push([item.key, String(item.value)]);
  }
  return found;
}

function run(head = false) {
  const tracked = git(head ? ['ls-tree', '-r', '--name-only', '-z', 'HEAD'] : ['ls-files', '-z']).toString().split('\0').filter(Boolean);
  const indexed = new Set(tracked);
  const others = head ? [] : git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
  const files = [...tracked, ...others];
  const known = localSecrets();
  const findings = [];
  for (const file of files) {
    if (privatePath(file)) findings.push(`${file}: private/generated file is tracked`);
    if (indexed.has(file)) {
      const committed = git(['show', `${head ? 'HEAD' : ''}:${file}`]).toString();
      for (const reason of inspect(committed, known)) findings.push(`${file} (${head ? 'HEAD' : 'index'}): ${reason}`);
    }
    if (!head && fs.existsSync(path.join(root, file))) {
      for (const reason of inspect(fs.readFileSync(path.join(root, file), 'utf8'), known)) findings.push(`${file} (working copy): ${reason}`);
    }
  }
  if (findings.length) {
    console.error('Repository security check failed. Secret values are omitted.');
    for (const finding of findings) console.error(finding);
    return false;
  }
  console.log(`Repository security check passed: ${files.length} files checked (${head ? 'HEAD' : 'index and working copies'}).`);
  return true;
}

if (require.main === module) {
  try { process.exitCode = run(process.argv.includes('--head')) ? 0 : 1; }
  catch { console.error('Repository security check could not finish. No archive should be shared until it passes.'); process.exitCode = 1; }
}
module.exports = { inspect, privatePath };
