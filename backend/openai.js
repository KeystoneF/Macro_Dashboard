// Keep the API key in the Authorization header and redact upstream errors.

const BASE = 'https://api.openai.com/v1/responses';

// Ranking only needs to choose from the supplied facts.
const MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';

const TIMEOUT_MS = 60_000; // a hung outbound connection otherwise holds the panel open

const configured = () => Boolean(process.env.OPEN_AI_KEY);

// Cap model calls per process to bound spend.
const HOUR_MS = 3600_000;
const CEILING = Number(process.env.OPENAI_MAX_CALLS_PER_HOUR) || 60;

const calls = [];

function used() {
  const cutoff = Date.now() - HOUR_MS;
  while (calls.length && calls[0] < cutoff) calls.shift();
  return calls.length;
}

const budget = () => ({ used: used(), ceiling: CEILING });

// The raw Responses body has no output_text: that is an SDK convenience, so the
// message is walked out of the output list. Reasoning items come first.
function outputText(body) {
  for (const item of body.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) if (part.type === 'output_text') return part.text;
  }
  return null;
}

// Strict json_schema, so the answer parses or the call failed. `store: false`
// keeps desk data out of OpenAI's dashboard retention.
async function ask({ instructions, input, schemaName, schema, maxOutputTokens = 2000 }) {
  const key = process.env.OPEN_AI_KEY;
  if (!key) throw new Error('OPEN_AI_KEY missing');
  if (used() >= CEILING) throw new Error(`this server has used ${used()} of its ${CEILING} model calls an hour`);

  calls.push(Date.now());

  const r = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: maxOutputTokens,
      text: {
        verbosity: 'low',
        format: { type: 'json_schema', name: schemaName, strict: true, schema },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const detail = body && body.error && body.error.message ? `: ${body.error.message}` : '';
    throw new Error(`openai ${r.status}${detail}`);
  }

  // a truncated answer is not a failed request, and parsing it would throw
  // somewhere less obvious
  if (body.status === 'incomplete') {
    const why = (body.incomplete_details && body.incomplete_details.reason) || 'unknown';
    throw new Error(`openai answer incomplete: ${why}`);
  }

  const text = outputText(body);
  if (!text) throw new Error('openai returned no message');

  return { parsed: JSON.parse(text), model: body.model || MODEL };
}

module.exports = { ask, configured, budget, MODEL };
