// FMP and FRED both take their key as a query parameter, so any error that
// carries a URL carries the key with it. Those errors are logged and sent to
// the browser as the 502 body, which would put a live key in a console, in a
// screenshot, and in whatever the analyst pastes into a bug report.
//
// Nothing upstream is trusted to keep the key out of its own error text, so
// every message leaves through here.

const secrets = () =>
  [process.env.FMP_API_KEY, process.env.FRED_API_KEY, process.env.DB_PASSWORD].filter(
    // six, not eight: the dev database password is seven characters and was
    // slipping past the value match on its way into a log line
    (v) => v && v.length >= 6,
  );

function redact(text) {
  let out = String(text ?? '');
  for (const s of secrets()) out = out.split(s).join('[redacted]');
  // a credential the env does not know about can still ride in on an upstream
  // URL or in its error prose, so the parameter name is matched wherever it
  // appears. Over-redacting a log line costs nothing; under-redacting it once
  // puts a live key somewhere permanent.
  return out.replace(
    /\b(apikey|api_key|key|token|secret|password|pwd)=\s*[^&\s"']+/gi,
    '$1=[redacted]',
  );
}

// A driver can raise a connection failure with an empty message and the reason
// only in .code, so reading .message alone answers with {"error":""} and an
// analyst is told nothing at all while the database is down.
function describe(err) {
  if (!err) return 'unknown error';
  const message = typeof err.message === 'string' ? err.message.trim() : '';
  if (message) return message;
  if (err.code) return String(err.code);
  return String(err);
}

// The single exit for a failed upstream call: log it, answer 502, leak nothing.
function fail(res, err) {
  const message = redact(describe(err));
  console.error(message);
  res.status(502).json({ error: message });
}

module.exports = { redact, describe, fail };
