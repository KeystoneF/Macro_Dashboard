// News and commentary sources for the aggregator. Three different XML dialects
// and one JSON API, all normalised to the same item shape in routes/news.js.
//
// `country` is the publisher's focus, not a claim about any individual article.
// StatCan and the Bank of Canada publish Canadian releases; CNBC and the FMP
// aggregate are US market coverage. The filter is labelled that way in the UI so
// nobody reads it as per-article classification.

const FEEDS = [
  {
    id: 'cnbc',
    source: 'CNBC',
    kind: 'rss',
    country: 'US',
    category: 'Markets',
    // CNBC sits behind Akamai and answers 403 to a request with no User-Agent
    url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html',
  },
  {
    id: 'statcan',
    source: 'StatCan',
    kind: 'atom',
    country: 'CA',
    category: 'Data release',
    // subject 0 is The Daily across every subject, rather than one topic feed
    url: 'https://www150.statcan.gc.ca/n1/rss/dai-quo/0-eng.atom',
  },
  {
    id: 'boc-press',
    source: 'Bank of Canada',
    kind: 'rdf',
    country: 'CA',
    category: 'Press release',
    url: 'https://www.bankofcanada.ca/content_type/press-releases/feed/',
  },
  {
    id: 'boc-speeches',
    source: 'Bank of Canada',
    kind: 'rdf',
    country: 'CA',
    category: 'Speech',
    url: 'https://www.bankofcanada.ca/content_type/speeches/feed/',
  },
  {
    id: 'boc-publications',
    source: 'Bank of Canada',
    kind: 'rdf',
    country: 'CA',
    category: 'Publication',
    url: 'https://www.bankofcanada.ca/content_type/publications/feed/',
  },
  {
    id: 'fmp',
    source: 'FMP',
    kind: 'fmp',
    country: 'US',
    category: 'Markets',
    url: '/news/general-latest?limit=60',
  },
];

// Identifying the fetcher rather than pretending to be a browser. CNBC needs
// something here, and a real contact string is the polite version of that.
const USER_AGENT = 'KeyStoneMacroDesk/0.1 (macroeconomic research dashboard)';

const WINDOWS = { '24h': 1, '7d': 7, '30d': 30 };

module.exports = { FEEDS, USER_AGENT, WINDOWS };
