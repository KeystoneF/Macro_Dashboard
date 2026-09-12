// The brief's ranked panel, which design/1-daily-brief.html calls "Top Releases
// & Articles Ranked by Model".
//
// The model is handed the facts the nine modules already pulled and picks which
// ones an analyst should read first. It never supplies a figure: every value on
// the panel is rendered from the fact it points at, and a line quoting a number
// that is not in that fact is dropped. So the ranking is the model's and the
// data stays the source's, which is what the no-estimate policy requires.

const { redact, describe } = require('./redact');
const { ask, configured, MODEL } = require('./openai');
const { facts, MODULE, periodTime } = require('./desk');

const CACHE_MS = 30 * 60_000;
// A ranking that failed is worth asking for again well before one that worked,
// so a transient 500 from the provider does not cost the panel half an hour.
const RETRY_MS = 5 * 60_000;

const TAKE = 6;
const PER_MODULE = 2; // or one busy module takes the whole panel
const LINE_MAX = 160;

const INSTRUCTIONS = [
  'You rank facts for a macroeconomic research desk at a Canadian investment firm.',
  'Every fact below was pulled from a named source by one of nine desk modules. You have no other data and no memory of any market.',
  '',
  `Pick at most ${TAKE} facts an analyst should see first, most important first, and reference each by its exact id.`,
  'Write one line per pick saying what an analyst should notice in it, at most 18 words.',
  '',
  'How to choose:',
  `- At most ${PER_MODULE} facts from any one module, so the panel covers the desk rather than one corner of it.`,
  '- Prefer a fact whose printedInWindow is true: it landed inside the window being read. It is a hint for you, so never write the word window or the field name in a line.',
  '- Prefer a large move, a policy change, or a release over a figure that has not moved.',
  '- If a fact is routine, leave it out. Fewer items is a valid answer.',
  '',
  'Rules you must not break:',
  '- Never write a number, a date, a percentage or a count. The desk prints the fact beside your line.',
  '- Never name a country, series, instrument or market that is not in the fact you referenced.',
  '- Never say whether a figure beat or missed an expectation: no consensus or forecast is in the data.',
  '- Never explain what an indicator measures. The analyst knows. Say what is worth noticing here.',
  '- Never repeat the label back. The row already carries it, so the line has to add something.',
  '- Never give a cause or a reason for a move. Nothing in the data says why anything happened.',
  '- Never say a figure rose, fell, widened or narrowed unless the fact you referenced carries a change. A level is not a direction.',
  '- Do not use em dashes or en dashes.',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'the id of the fact this ranks' },
          line: { type: 'string', description: 'why it matters, no figures' },
        },
        required: ['ref', 'line'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// What the model is shown. Anything not here does not exist as far as it is
// concerned, so a link or an internal key never leaves this process.
const forModel = (f) => ({
  id: f.id,
  module: f.moduleLabel,
  printedInWindow: f.printedInWindow,
  label: f.label,
  ...(f.title ? { headline: f.title } : {}),
  ...(f.value ? { value: f.value } : {}),
  ...(f.period ? { period: f.period } : {}),
  ...(f.note ? { note: f.note } : {}),
  source: f.source,
});

const DIGITS = /\d+(?:[.,]\d+)?/g;

// A line may only carry a number that is already in the fact it points at. The
// model is told not to write figures at all, so this catches the case where it
// does anyway rather than trusting the instruction.
function grounded(line, f) {
  const hay = [f.label, f.value, f.period, f.note, f.title, f.source].filter(Boolean).join(' ');
  return (line.match(DIGITS) || []).every((n) => hay.includes(n));
}

// A line that only says the label again is worse than no line, and the model is
// weak at the instruction telling it not to. The fact keeps its place; the
// commentary is what gets dropped.
const WORDS = /[a-z0-9]+/g;
const NEW_WORDS = 2;

function addsSomething(line, f) {
  const own = new Set(String([f.label, f.title, f.value, f.note, f.source].filter(Boolean).join(' ')).toLowerCase().match(WORDS) || []);
  const fresh = new Set((line.toLowerCase().match(WORDS) || []).filter((w) => !own.has(w)));
  return fresh.size >= NEW_WORDS;
}

const tidy = (line) =>
  String(line || '')
    // it writes the fact's own id at the head of the line often enough to handle
    // here, with or without punctuation after it, and the digits in it would
    // fail the check below and cost the line
    .replace(/^\s*f\d+\b[\s:.,-]*/i, '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LINE_MAX);

function rank(items, bundle) {
  const byId = new Map(bundle.facts.map((f) => [f.id, f]));
  const out = [];
  const seen = new Set();
  const perModule = new Map();

  for (const item of items || []) {
    const f = byId.get(String(item.ref));
    if (!f || seen.has(f.id)) continue;
    // the cap is in the instructions too, and enforced here rather than trusted there
    const taken = perModule.get(f.module) || 0;
    if (taken >= PER_MODULE) continue;
    // A line that fails either check costs the line, not the pick: the fact it
    // points at was still pulled from a source, and the commentary is the only
    // part that was not.
    const line = tidy(item.line);
    const keep = line && grounded(line, f) && addsSomething(line, f);

    seen.add(f.id);
    perModule.set(f.module, taken + 1);
    out.push({ rank: out.length + 1, line: keep ? line : null, fact: f });
    if (out.length === TAKE) break;
  }
  return out;
}

// The model being unavailable must not empty the panel. Newest first is the
// order the rest of the brief already uses, and no line is written for a pick
// nobody ranked.
const newestFirst = (bundle) =>
  [...bundle.facts]
    .filter((f) => f.period)
    .sort((a, b) => periodTime(b.published || b.period) - periodTime(a.published || a.period))
    .slice(0, TAKE)
    .map((f, i) => ({ rank: i + 1, line: null, fact: f }));

async function build({ window, country }) {
  const bundle = await facts({ window, country });

  const base = {
    window: bundle.window,
    country: bundle.country,
    facts: bundle.facts.length,
    missing: bundle.missing,
    skipped: bundle.skipped,
    modules: [...new Set(bundle.facts.map((f) => f.module))].map((slug) => MODULE[slug].num).sort(),
    gatheredAt: bundle.gatheredAt,
  };

  if (!configured()) {
    return { ...base, items: newestFirst(bundle), ranked: false, model: null, modelError: 'OPEN_AI_KEY is not set' };
  }
  if (!bundle.facts.length) {
    return { ...base, items: [], ranked: false, model: null, modelError: null };
  }

  try {
    const { parsed, model } = await ask({
      instructions: INSTRUCTIONS,
      input: JSON.stringify({
        window: bundle.window,
        country: bundle.country,
        facts: bundle.facts.map(forModel),
      }),
      schemaName: 'desk_ranking',
      schema: SCHEMA,
    });

    return { ...base, items: rank(parsed.items, bundle), ranked: true, model, modelError: null };
  } catch (err) {
    // the panel is not empty when the ranking fails: the facts behind it were
    // still pulled, so they render newest first and the panel says why
    const modelError = redact(describe(err));
    console.error('digest ranking failed:', modelError);
    return { ...base, items: newestFirst(bundle), ranked: false, model: MODEL, modelError };
  }
}

// One ranking per window and country per half hour, which is also what keeps a
// room full of analysts from each buying their own. Holds the promise, not the
// value, so four of them opening the page together share one call.
const held = new Map();
const inFlight = new Map();

function digest({ window, country }) {
  const key = `${window}:${country}`;
  const hit = held.get(key);
  if (hit && Date.now() - hit.at < (hit.data.ranked ? CACHE_MS : RETRY_MS)) {
    return Promise.resolve(hit.data);
  }

  const running = inFlight.get(key);
  if (running) return running;

  const work = build({ window, country })
    .then((data) => {
      held.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

module.exports = { digest, TAKE };
