// Nav order and numbering follow design/0-shell.html. `state` mirrors the module
// table in CLAUDE.md and drives the banner on every not-yet-built route, so a
// module that is only a mockup can never be mistaken for one showing live data.

export type ModuleState = 'live' | 'stubbed' | 'blocked' | 'mockup';

export type Module = {
  num: string;
  slug: string;
  label: string;
  title: string;
  group: string;
  mockup: string;
  state: ModuleState;
  note?: string;
};

export const MODULES: Module[] = [
  {
    num: '01',
    slug: 'brief',
    label: 'Daily Brief',
    title: 'Daily / Weekly / Monthly Brief',
    group: 'Daily Workflow',
    mockup: '1-daily-brief.html',
    state: 'mockup',
  },
  {
    num: '02',
    slug: 'news',
    label: 'News & Commentary',
    title: 'News & Commentary Aggregator',
    group: 'Daily Workflow',
    mockup: '6-news-aggregator.html',
    state: 'live',
  },
  {
    num: '03',
    slug: 'series',
    label: 'Series Explorer',
    title: 'Time Series Explorer',
    group: 'Data & Charting',
    mockup: '2-time-series-explorer.html',
    state: 'live',
  },
  {
    num: '04',
    slug: 'yield-curve',
    label: 'Yield Curve',
    title: 'Yield Curve',
    group: 'Data & Charting',
    mockup: '3-yield-curve.html',
    state: 'live',
  },
  {
    num: '05',
    slug: 'fx',
    label: 'FX & Commodities',
    title: 'FX & Commodities Board',
    group: 'Data & Charting',
    mockup: '7-fx-commodities.html',
    state: 'live',
  },
  {
    num: '06',
    slug: 'international',
    label: 'International',
    title: 'International / OECD Comparison',
    group: 'Data & Charting',
    mockup: '8-international-oecd.html',
    state: 'live',
  },
  {
    num: '07',
    slug: 'sectors',
    label: 'Sector & Valuation',
    title: 'Sector Tracker & Valuation',
    group: 'Coverage',
    mockup: '4-sector-tracker.html',
    state: 'live',
    note: "Valuation is the publishers' own charts: neither GuruFocus nor Yardeni sells a feed.",
  },
  {
    num: '08',
    slug: 'watchlist',
    label: 'Watchlist & Calendar',
    title: 'Watchlist, Earnings & Calendar',
    group: 'Coverage',
    mockup: '5-watchlist-news.html',
    state: 'mockup',
  },
  {
    num: '09',
    slug: 'heatmap',
    label: 'Heatmap',
    title: 'Market-Cap Return Heatmap',
    group: 'Coverage',
    mockup: '9-heatmap.html',
    state: 'live',
  },
];

export const GROUPS = ['Daily Workflow', 'Data & Charting', 'Coverage'];

export const bySlug = (slug: string) => MODULES.find((m) => m.slug === slug);
