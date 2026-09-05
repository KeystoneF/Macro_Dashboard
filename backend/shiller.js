// Robert Shiller's Irrational Exuberance dataset, which is the source GuruFocus
// was redrawing: the mean of the CAPE column is the 17.8 it printed as the
// all-time average.

const XLSX = require('xlsx');
const { USER_AGENT } = require('./feeds');
const { redact, describe } = require('./redact');

const PAGE = 'https://shillerdata.com/';

const SHILLER = {
  id: 'shiller',
  label: 'Shiller PE (CAPE)',
  source: 'Shillerdata',
  page: PAGE,
};

// the workbook sits on a wsimg blob whose guid changes when it is re-uploaded,
// so the link is read off the page rather than pinned
const LINK = /href="([^"]*ie_data[^"]*\.xls[^"]*)"/i;

const SHEET = 'Data';
const FIRST_ROW = 8; // rows 1 to 7 are the stacked header
const DATE = 0;
const CAPE = 12;

const TIMEOUT_MS = 30_000; // a hung outbound connection otherwise reports nothing at all
const DEBUG = process.env.SHILLER_DEBUG === '1';

// What the last download did, step by step. shillerdata.com can answer a
// datacentre ip differently than it answers a desk, and the trace is the only
// way to see which step changed: read it back off /api/valuation/shiller/diag.
let trace = [];

function step(name, detail = {}) {
  const entry = { step: name, ...detail };
  trace.push(entry);
  if (DEBUG) console.log('shiller:', redact(JSON.stringify(entry)));
}

const snippet = (html) => html.replace(/\s+/g, ' ').slice(0, 300);

// Dates are stored as YYYY.MM numbers and lose a trailing zero: October 2025 is
// 2025.1, which reads as January if the fraction is split on the point.
function period(v) {
  const year = Math.floor(v);
  const month = Math.round((v - year) * 100);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parse(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', sheets: SHEET });
  const ws = wb.Sheets[SHEET];
  step('workbook', { xlsx: XLSX.version, sheets: wb.SheetNames });
  if (!ws) throw new Error('ie_data.xls carries no Data sheet');

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true });
  const observations = [];

  for (let i = FIRST_ROW; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row[DATE] !== 'number') continue;

    const d = period(row[DATE]);
    // the column reads "NA" before 1881.01, where the ten year window has
    // nothing behind it
    const v = row[CAPE];
    if (d && typeof v === 'number' && Number.isFinite(v)) observations.push({ d, v });
  }

  step('parsed', {
    rows: rows.length,
    observations: observations.length,
    from: observations.length ? observations[0].d : null,
    to: observations.length ? observations[observations.length - 1].d : null,
  });

  if (!observations.length) throw new Error('ie_data.xls held no CAPE values');
  return observations;
}

async function download() {
  trace = [];
  step('start', { at: new Date().toISOString(), node: process.version });

  const startedPage = Date.now();
  const page = await fetch(PAGE, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const html = await page.text();
  step('page', {
    status: page.status,
    type: page.headers.get('content-type'),
    server: page.headers.get('server'),
    bytes: html.length,
    ms: Date.now() - startedPage,
  });
  if (!page.ok) {
    step('html', { snippet: snippet(html) });
    throw new Error(`shillerdata.com ${page.status}`);
  }

  const found = html.match(LINK);
  if (!found) {
    // a challenge or block page answers 200 with html carrying no link at all
    step('html', { snippet: snippet(html) });
    throw new Error('no ie_data.xls link on shillerdata.com');
  }

  // the href is protocol relative
  const url = new URL(found[1], PAGE);
  step('link', { url: url.href });

  const startedFile = Date.now();
  const file = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const buffer = Buffer.from(await file.arrayBuffer());
  step('file', {
    status: file.status,
    type: file.headers.get('content-type'),
    bytes: buffer.length,
    // d0cf11e0 is an OLE2 workbook, 3c21444f is html answered under an .xls name
    head: buffer.subarray(0, 4).toString('hex'),
    lastModified: file.headers.get('last-modified'),
    ms: Date.now() - startedFile,
  });
  if (!file.ok) throw new Error(`ie_data.xls ${file.status}`);

  return { buffer, lastModified: file.headers.get('last-modified') };
}

function summarise(observations, lastModified) {
  const last = observations[observations.length - 1];
  const sum = observations.reduce((t, o) => t + o.v, 0);
  const updated = Date.parse(lastModified || '');

  return {
    observations,
    value: last.v,
    average: sum / observations.length,
    asOf: last.d,
    from: observations[0].d,
    updated: Number.isFinite(updated) ? new Date(updated).toISOString() : null,
  };
}

const CACHE_MS = 12 * 60 * 60_000; // the file is republished about monthly

let cached = null;
let inFlight = null;

// returns the cached series, or one download and parse shared by concurrent callers
function load() {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = download()
    .then(({ buffer, lastModified }) => {
      cached = { at: Date.now(), ...summarise(parse(buffer), lastModified) };
      return cached;
    })
    .catch((err) => {
      step('failed', { error: redact(describe(err)) });
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

// a fresh download that leaves the cache alone, answering with the trace it wrote
async function diagnose() {
  const run = {
    node: process.version,
    xlsx: XLSX.version,
    debug: DEBUG,
    cached: cached
      ? {
          at: new Date(cached.at).toISOString(),
          asOf: cached.asOf,
          observations: cached.observations.length,
        }
      : null,
  };

  try {
    const { buffer, lastModified } = await download();
    const { observations, ...series } = summarise(parse(buffer), lastModified);
    Object.assign(run, { ok: true, count: observations.length }, series);
  } catch (err) {
    run.ok = false;
    run.error = redact(describe(err));
  }

  run.trace = trace;
  return run;
}

module.exports = { SHILLER, PAGE, load, diagnose, parse, period };
