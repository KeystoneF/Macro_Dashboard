// Robert Shiller's Irrational Exuberance dataset, which is the source GuruFocus
// was redrawing: the mean of the CAPE column is the 17.8 it printed as the
// all-time average.

const XLSX = require('xlsx');
const { USER_AGENT } = require('./feeds');

const PAGE = 'https://shillerdata.com/';

const SHILLER = {
  id: 'shiller',
  label: 'Shiller PE (CAPE)',
  source: 'Robert J. Shiller, Yale',
  page: PAGE,
};

// the workbook sits on a wsimg blob whose guid changes when it is re-uploaded,
// so the link is read off the page rather than pinned
const LINK = /href="([^"]*ie_data[^"]*\.xls[^"]*)"/i;

const SHEET = 'Data';
const FIRST_ROW = 8; // rows 1 to 7 are the stacked header
const DATE = 0;
const CAPE = 12;

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

  if (!observations.length) throw new Error('ie_data.xls held no CAPE values');
  return observations;
}

async function download() {
  const page = await fetch(PAGE, { headers: { 'User-Agent': USER_AGENT } });
  if (!page.ok) throw new Error(`shillerdata.com ${page.status}`);

  const found = (await page.text()).match(LINK);
  if (!found) throw new Error('no ie_data.xls link on shillerdata.com');

  // the href is protocol relative
  const file = await fetch(new URL(found[1], PAGE), { headers: { 'User-Agent': USER_AGENT } });
  if (!file.ok) throw new Error(`ie_data.xls ${file.status}`);

  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    lastModified: file.headers.get('last-modified'),
  };
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
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

module.exports = { SHILLER, PAGE, load, parse, period };
