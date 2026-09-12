// Rank sourced facts. Model commentary never supplies the displayed figures.

const { redact, describe } = require('./redact');
const { ask, configured, MODEL } = require('./openai');
const { facts, countries, MODULE, NATIONAL, periodTime } = require('./desk');

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

// Reject numbers that do not appear in the referenced fact.
function grounded(line, f) {
  const hay = [f.label, f.value, f.period, f.note, f.title, f.source].filter(Boolean).join(' ');
  return (line.match(DIGITS) || []).every((n) => hay.includes(n));
}

// Drop commentary that only repeats the label.
const WORDS = /[a-z0-9]+/g;
const NEW_WORDS = 2;

const ownWords = (f) =>
  new Set([f.label, f.title, f.value, f.note, f.source].filter(Boolean).join(' ').toLowerCase().match(WORDS) || []);

function addsSomething(line, f) {
  const own = ownWords(f);
  const fresh = new Set((line.toLowerCase().match(WORDS) || []).filter((w) => !own.has(w)));
  return fresh.size >= NEW_WORDS;
}

// Strip a repeated label before a colon.
const HEAD_MAX = 48;

function stripLabelEcho(line, f) {
  const at = line.indexOf(':');
  if (at < 1 || at > HEAD_MAX) return line;

  const own = ownWords(f);
  const head = (line.slice(0, at).toLowerCase().match(WORDS) || []);
  if (!head.length || !head.every((w) => own.has(w))) return line;

  const rest = line.slice(at + 1).trim();
  return rest || line;
}

// A level alone does not support a claim about direction.
const DIRECTION =
  /\b(rose|rise[sn]?|rising|fell|fall(s|en|ing)?|climb(ed|ing)?|drop(ped|ping)?|gain(ed|ing)?|declin(ed|ing)|advanc(ed|ing)|jump(ed|ing)?|slip(ped|ping)?|surg(ed|ing)|widen(ed|ing)?|narrow(ed|ing)?|steepen(ed|ing)?|flatten(ed|ing)?|increas(ed|ing)|decreas(ed|ing)|rallied|tumbled|weaken(ed|ing)?|strengthen(ed|ing)?|higher|lower|mov(e|es|ed|ing)|uptick|downtick)\b/i;

// The other half of the same claim: saying a figure has held still is also a
// statement about change, and only the fact's own note can carry it.
const STEADY = /\b(steady|unchanged|held|holds|holding|flat|stable|pause[ds]?)\b/i;

// Check country names separately from numeric claims.
const LETTER = /[a-z0-9]/;

function says(text, phrase) {
  const hay = text.toLowerCase();
  for (let at = hay.indexOf(phrase); at !== -1; at = hay.indexOf(phrase, at + 1)) {
    const before = at === 0 ? ' ' : hay[at - 1];
    const after = hay[at + phrase.length] ?? ' ';
    if (!LETTER.test(before) && !LETTER.test(after)) return true;
  }
  return false;
}

const saysAny = (text, phrases) => phrases.some((p) => says(text, p));

// the two with a national source get their adjectives as well, because they are
// the two the desk writes about most and the model uses the forms alike
const ALIAS = {
  CAN: ['canada', 'canadian'],
  USA: ['united states', 'u.s.', 'us', 'usa', 'american'],
};

const countryTests = (list) => list.map((c) => ALIAS[c.code] || [c.name.toLowerCase()]);

function namesAnotherCountry(line, f, tests) {
  const own = [f.label, f.title, f.source, NATIONAL[f.country] || f.country]
    .filter(Boolean)
    .join(' ');
  return tests.some((t) => saysAny(line, t) && !saysAny(own, t));
}

function assertsUnsupportedChange(line, f) {
  if (f.carriesChange) return false;
  if (DIRECTION.test(line)) return true;
  return STEADY.test(line) && !/unchanged/i.test(f.note || '');
}

const tidy = (line) =>
  String(line || '')
    // Strip leading fact IDs before checking the prose.
    .replace(/^\s*f\d+\b[\s:.,-]*/i, '')
    // it reaches for the typographic hyphens as well, and "month-over-month"
    // should be the one on the keyboard
    .replace(/[‐‑‒]/g, '-')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LINE_MAX);

function rank(items, bundle, tests) {
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
    // Keep the sourced fact even when its commentary fails validation.
    const line = stripLabelEcho(tidy(item.line), f);
    const keep =
      line &&
      grounded(line, f) &&
      addsSomething(line, f) &&
      !assertsUnsupportedChange(line, f) &&
      !namesAnotherCountry(line, f, tests);

    seen.add(f.id);
    perModule.set(f.module, taken + 1);
    out.push({ rank: out.length + 1, line: keep ? line : null, fact: f });
    if (out.length === TAKE) break;
  }
  return out;
}

// Fall back to the newest facts when ranking is unavailable.
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
    return { ...base, items: newestFirst(bundle), ranked: false, model: null, modelError: 'OPEN_AI_KEY was not set when the api started' };
  }
  if (!bundle.facts.length) {
    return { ...base, items: [], ranked: false, model: null, modelError: null };
  }

  // the country list is the OECD snapshot the bundle already holds, so this
  // costs nothing upstream
  const tests = countryTests(await countries().catch(() => []));

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

    return { ...base, items: rank(parsed.items, bundle, tests), ranked: true, model, modelError: null };
  } catch (err) {
    // the panel is not empty when the ranking fails: the facts behind it were
    // still pulled, so they render newest first and the panel says why
    const modelError = redact(describe(err));
    console.error('digest ranking failed:', modelError);
    return { ...base, items: newestFirst(bundle), ranked: false, model: MODEL, modelError };
  }
}

// Share one ranking request per window and country.
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
      held.delete(key);
      held.set(key, { at: Date.now(), data });
      if (held.size > 200) held.delete(held.keys().next().value);
      return data;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

module.exports = { digest, TAKE };
