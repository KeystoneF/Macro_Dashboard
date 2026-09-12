// Local JWT issuer and verifier.
const jwt = require('jsonwebtoken');

const ALG = 'HS256';
const TTL_SECONDS = 12 * 60 * 60; // One working day.

function secret() {
  const s = process.env.JWT_SECRET;
  // Refuse to start with a missing or weak secret.
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET missing or shorter than 32 characters');
  }
  return s;
}

// Signing out increments token_version and revokes older sessions.
const issue = (user) =>
  jwt.sign(
    { sub: String(user.id), email: user.email, name: user.name, ver: user.tokenVersion ?? 0 },
    secret(),
    { algorithm: ALG, expiresIn: TTL_SECONDS, issuer: 'macrodesk' },
  );

function verify(token) {
  try {
    // Only accept the signing algorithm we issue.
    const claims = jwt.verify(token, secret(), { algorithms: [ALG], issuer: 'macrodesk' });
    if (!/^\d+$/.test(claims.sub) || !Number.isSafeInteger(claims.ver) || claims.ver < 0) return null;
    return { id: claims.sub, email: claims.email, name: claims.name, ver: claims.ver };
  } catch {
    return null;
  }
}

module.exports = { issue, verify, validate: secret, TTL_SECONDS, name: 'local' };
