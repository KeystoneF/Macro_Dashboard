// The swap point for single sign-on.
//
// Everything else in the app asks this module who a token belongs to and never
// learns which provider answered. Pointing MacroDesk at the KeyStocks portal
// means adding a sibling of local.js that verifies their JWT and setting
// AUTH_PROVIDER, and touching nothing in the routes or the frontend.
//
// What a keystocks.js would need from Raman:
//   - where the portal keeps the token, a cookie name or a localStorage key
//   - the signing algorithm, and the shared secret or the public key
//   - which claim identifies the analyst
//
// Reading their session at all also needs the two apps on one origin or one
// parent domain. Different origins cannot see each other's cookies or storage,
// so no amount of code here substitutes for that hosting decision.
const local = require('./local');

const PROVIDERS = { local };

function provider() {
  const name = process.env.AUTH_PROVIDER || 'local';
  const found = PROVIDERS[name];
  if (!found) throw new Error(`unknown AUTH_PROVIDER: ${name}`);
  return found;
}

module.exports = {
  verify: (token) => (token ? provider().verify(token) : null),
  issue: (user) => provider().issue(user),
  ttlSeconds: () => provider().TTL_SECONDS,
  providerName: () => provider().name,
  // an SSO provider issues nothing here: the portal owns the login form
  canIssue: () => typeof provider().issue === 'function',
};
