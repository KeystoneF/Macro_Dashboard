// Authentication provider adapter. Only the local provider is implemented.
const local = require('./local');

const PROVIDERS = { local };

function provider() {
  const name = process.env.AUTH_PROVIDER || 'local';
  const found = Object.hasOwn(PROVIDERS, name) ? PROVIDERS[name] : null;
  if (!found) throw new Error(`unknown AUTH_PROVIDER: ${name}`);
  return found;
}

module.exports = {
  validate: () => provider().validate(),
  verify: (token) => (token ? provider().verify(token) : null),
  issue: (user) => provider().issue(user),
  ttlSeconds: () => provider().TTL_SECONDS,
  providerName: () => provider().name,
  // an SSO provider issues nothing here: the portal owns the login form
  canIssue: () => typeof provider().issue === 'function',
};
