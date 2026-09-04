// The local provider: MacroDesk issues and verifies its own JWTs against the
// users table. This is what runs until KeyStone decides how SSO against the
// KeyStocks portal should work.
const jwt = require('jsonwebtoken');

const ALG = 'HS256';
const TTL_SECONDS = 12 * 60 * 60; // one working day, so a desk is not re-prompted mid-session

function secret() {
  const s = process.env.JWT_SECRET;
  // failing loudly beats signing with a default that every deployment shares
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET missing or shorter than 32 characters');
  }
  return s;
}

// ver is the account's token_version at sign-in. A sign-out bumps the column,
// which leaves every token carrying the older number failing the check.
const issue = (user) =>
  jwt.sign(
    { sub: String(user.id), email: user.email, name: user.name, ver: user.tokenVersion ?? 0 },
    secret(),
    { algorithm: ALG, expiresIn: TTL_SECONDS, issuer: 'macrodesk' },
  );

function verify(token) {
  try {
    // algorithms is pinned: without it a forged token can claim alg none and
    // skip signature checking entirely
    const claims = jwt.verify(token, secret(), { algorithms: [ALG], issuer: 'macrodesk' });
    return { id: claims.sub, email: claims.email, name: claims.name, ver: claims.ver };
  } catch {
    return null;
  }
}

module.exports = { issue, verify, TTL_SECONDS, name: 'local' };
