// Strip credentials before logging or returning upstream errors.

const secrets = () => {
  let databasePassword;
  try { databasePassword = decodeURIComponent(new URL(process.env.DATABASE_URL).password); } catch { /* No URL configured. */ }
  return [
    process.env.FMP_API_KEY,
    process.env.FRED_API_KEY,
    process.env.KEYSTOCKS_API_KEY,
    process.env.OPEN_AI_KEY,
    process.env.JWT_SECRET,
    process.env.DB_PASSWORD,
    process.env.DATABASE_URL,
    databasePassword,
  ].filter(
    // six, not eight: the dev database password is seven characters and was
    // slipping past the value match on its way into a log line
    (v) => v && v.length >= 6,
  );
};

function redact(text) {
  let out = String(text ?? '');
  for (const s of secrets()) {
    out = out.split(s).join('[redacted]');
    out = out.split(encodeURIComponent(s)).join('[redacted]');
  }
  out = out.replace(/(postgres(?:ql)?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[redacted]@');
  // Also redact named credentials that are not in this process's environment.
  out = out.replace(
    /\b(apikey|api_key|key|token|secret|password|pwd)=\s*[^&\s"']+/gi,
    '$1=[redacted]',
  );
  // OpenAI takes its key in an Authorization header rather than in the query
  // string, so it reaches an error as a bearer token or as a bare sk- id
  out = out.replace(/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 [redacted]');
  out = out.replace(/\b(authorization|x-api-key)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'\]}]+/gi, '$1$2[redacted]');
  return out.replace(/\bsk-[A-Za-z0-9._-]{8,}/g, '[redacted]');
}

// Include nested causes and driver codes when the top-level message is vague.
function describe(err) {
  if (!err) return 'unknown error';

  const parts = [];
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    const code = e.code ? String(e.code) : '';
    let part = typeof e.message === 'string' ? e.message.trim() : '';
    if (!part) part = code || String(e);
    else if (code && !part.includes(code)) part += ` (${code})`;
    if (part && !parts.includes(part)) parts.push(part);
  }

  return parts.join(': ') || 'unknown error';
}

// Keep upstream/internal details in redacted server logs, not browser responses.
function fail(res, err) {
  const message = redact(describe(err));
  console.error(message);
  res.status(502).json({ error: 'The data provider is unavailable or not configured. Please try again or contact the administrator.' });
}

module.exports = { redact, describe, fail };
