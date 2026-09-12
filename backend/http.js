// Keep stalled providers from holding requests open indefinitely.
function fetchWithTimeout(url, { timeoutMs = 20_000, signal, ...options } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...options,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

module.exports = fetchWithTimeout;
