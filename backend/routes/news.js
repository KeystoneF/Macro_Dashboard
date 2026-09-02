const express = require('express');
const router = express.Router();
const { XMLParser } = require('fast-xml-parser');
const { FEEDS, USER_AGENT, WINDOWS } = require('../feeds');
const { fail, redact } = require('../redact');

const FMP_BASE = 'https://financialmodelingprep.com/stable';

// News is not a tick. Five minutes is well inside every publisher's cadence and
// keeps a room full of analysts off the upstreams.
const CACHE_MS = 5 * 60_000;

let cached = { at: 0, items: [], sources: [] };
let inFlight = null;

// attributes are needed: an Atom entry keeps its URL in link/@href
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// Feed items become href on a page an analyst clicks, and the URL is whatever
// the publisher put in the XML. React neutralises javascript: and browsers
// refuse top-level data: navigation, but both are someone else's mitigation.
// Only the two schemes a news link should ever use get through.
const safeLink = (url) => (/^https?:\/\//i.test(String(url ?? '').trim()) ? String(url).trim() : null);

// StatCan writes Atom titles as XHTML, so a title arrives as a tree of div and
// span nodes rather than a string and reading #text off the top finds nothing.
// A node's own text comes before its children's, which keeps the refper span in
// "Canada's balance of international payments, second quarter 2026" at the end
// where it was written.
function textOf(node) {
  if (node == null) return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ');

  let out = node['#text'] != null ? String(node['#text']) : '';
  for (const [k, v] of Object.entries(node)) {
    if (k === '#text' || k.startsWith('@_')) continue;
    const child = textOf(v);
    if (child) out += out ? ` ${child}` : child;
  }
  return out;
}

// Feed text arrives as HTML fragments with entities. The UI renders it as plain
// text, so tags come out and the handful of entities that actually show up go
// back to their characters.
function plain(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_MAX = 300;
const SUMMARY_MAX = 260;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Publishers disagree on the date field and on its format. RFC 822 from RSS,
// ISO from Atom and Dublin Core. Anything unparseable is dropped rather than
// dated today, which would float an undated item to the top of the feed.
function when(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(typeof c === 'object' ? c['#text'] : c);
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

function parseFeed(feed, body) {
  if (feed.kind === 'fmp') {
    return asArray(body).map((a) => ({
      title: plain(a.title),
      link: safeLink(a.url),
      // FMP sends "2026-08-27 13:02:40", which Date reads as local time. It is
      // UTC, so the marker is added rather than letting the clock shift.
      published: when(String(a.publishedDate ?? '').replace(' ', 'T') + 'Z'),
      summary: plain(a.text),
      publisher: a.publisher || null,
    }));
  }

  const doc = parser.parse(body);

  if (feed.kind === 'atom') {
    return asArray(doc.feed && doc.feed.entry).map((e) => ({
      title: plain(textOf(e.title)),
      link: safeLink(asArray(e.link).map((l) => (l && l['@_href']) || l)[0]),
      published: when(e.updated, e.published),
      summary: plain(textOf(e.summary) || textOf(e.content)),
      publisher: null,
    }));
  }

  // RSS 2.0 nests items under channel; RSS 1.0 hangs them off rdf:RDF directly
  const items = feed.kind === 'rdf'
    ? asArray(doc['rdf:RDF'] && doc['rdf:RDF'].item)
    : asArray(doc.rss && doc.rss.channel && doc.rss.channel.item);

  return items.map((i) => ({
    title: plain(textOf(i.title)),
    link: safeLink(textOf(i.link)),
    published: when(i.pubDate, i['dc:date'], i.date),
    summary: plain(textOf(i.description)),
    publisher: null,
  }));
}

async function fetchFeed(feed) {
  const url =
    feed.kind === 'fmp'
      ? `${FMP_BASE}${feed.url}&apikey=${process.env.FMP_API_KEY}`
      : feed.url;

  if (feed.kind === 'fmp' && !process.env.FMP_API_KEY) throw new Error('FMP_API_KEY missing');

  const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } });
  if (!r.ok) throw new Error(`${feed.id} ${r.status}`);

  const raw = feed.kind === 'fmp' ? await r.json() : await r.text();

  return parseFeed(feed, raw)
    .filter((i) => i.title && i.link && i.published)
    .map((i) => ({
      // link is the natural key: the same story can appear twice when a feed
      // republishes it after an edit
      id: `${feed.id}:${i.link}`,
      source: feed.source,
      feedId: feed.id,
      country: feed.country,
      category: feed.category,
      title: clip(i.title, TITLE_MAX),
      link: i.link,
      published: i.published,
      summary: clip(i.summary, SUMMARY_MAX),
      publisher: i.publisher,
    }));
}

async function collect() {
  const results = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        return { feed, items: await fetchFeed(feed), error: null };
      } catch (err) {
        // one dead feed must not empty the page: the others still render and
        // the source reports why it is missing
        return { feed, items: [], error: redact(err.message) };
      }
    }),
  );

  const seen = new Set();
  const items = [];
  for (const r of results) {
    for (const item of r.items) {
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      items.push(item);
    }
  }

  items.sort((a, b) => b.published.localeCompare(a.published));

  return {
    items,
    sources: results.map((r) => ({
      id: r.feed.id,
      source: r.feed.source,
      category: r.feed.category,
      country: r.feed.country,
      count: r.items.length,
      error: r.error,
    })),
  };
}

// One sweep at a time. Without this, four analysts opening the page together
// each start their own fan-out across six publishers.
function load() {
  if (Date.now() - cached.at < CACHE_MS && cached.items.length) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = collect()
    .then((data) => {
      cached = { at: Date.now(), ...data };
      return cached;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

// Warmed at boot and refreshed just under the cache life, so a request always
// finds a warm cache. Without this one unlucky analyst every five minutes waits
// out a fan-out across six publishers.
const REFRESH_MS = CACHE_MS - 30_000;

load().catch((err) => console.error('news warm failed:', redact(err.message)));

const refresh = setInterval(() => {
  cached = { ...cached, at: 0 };
  load().catch((err) => console.error('news refresh failed:', redact(err.message)));
}, REFRESH_MS);

refresh.unref();

router.get('/', async (req, res) => {
  const window = String(req.query.window || '7d');
  const country = String(req.query.country || 'all');
  const feedId = String(req.query.source || 'all');
  const q = String(req.query.q || '').toLowerCase().trim();
  const limit = Math.min(300, Number(req.query.limit) || 120);

  if (!(window in WINDOWS)) return res.status(400).json({ error: `unknown window: ${window}` });

  try {
    const { items, sources } = await load();
    const cutoff = new Date(Date.now() - WINDOWS[window] * 864e5).toISOString();

    const filtered = items.filter(
      (i) =>
        i.published >= cutoff &&
        (country === 'all' || i.country === country) &&
        (feedId === 'all' || i.feedId === feedId) &&
        (!q || `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(q)),
    );

    res.json({
      items: filtered.slice(0, limit),
      total: filtered.length,
      sources,
      fetchedAt: new Date(cached.at).toISOString(),
    });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
