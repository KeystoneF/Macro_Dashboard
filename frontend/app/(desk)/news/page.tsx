'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, PLOT, card } from '../../theme';
import { getJson } from '../../lib/api';

type Item = {
  id: string;
  source: string;
  feedId: string;
  country: 'CA' | 'US';
  category: string;
  title: string;
  link: string;
  published: string;
  summary: string;
  publisher: string | null;
};

type SourceStat = {
  id: string;
  source: string;
  category: string;
  country: string;
  count: number;
  error: string | null;
};

type Feed = { items: Item[]; total: number; sources: SourceStat[]; fetchedAt: string };

const WINDOW_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30 };

const WINDOWS: [string, string][] = [
  ['24h', 'Last 24h'],
  ['7d', 'Last 7d'],
  ['30d', 'Last 30d'],
];

// News is cached upstream for five minutes, so asking more often than that only
// costs a round trip to our own API.
const REFRESH_MS = 5 * 60_000;

const SOURCE_COLOR: Record<string, string> = {
  CNBC: COLOR.us,
  FMP: PLOT[3],
  StatCan: COLOR.ca,
  'Bank of Canada': COLOR.accent,
};

export default function NewsPage() {
  const [window, setWindow] = useState('7d');
  const [country, setCountry] = useState<'all' | 'CA' | 'US'>('all');
  const [source, setSource] = useState('all');
  const [query, setQuery] = useState('');
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One fetch of the widest window, then every control filters what is already
  // here. Filtering server side meant a round trip per keystroke in the search
  // box, which is what made this page feel slow: the feeds answer in under half
  // a second, but typing "inflation" was nine requests and nine re-renders.
  useEffect(() => {
    let live = true;
    const load = () =>
      getJson<Feed>('/api/news?window=30d&limit=300')
        .then((f) => live && (setFeed(f), setError(null)))
        .catch((e) => live && setError(e.message));

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  // The window is measured from when the server pulled the feeds, not from the
  // browser's clock. It is the honest reference: "the last 24 hours" means the
  // day before this data was collected, and it does not shift if a machine's
  // time is off.
  const shown = useMemo(() => {
    if (!feed) return [];
    const cutoff = new Date(
      Date.parse(feed.fetchedAt) - WINDOW_DAYS[window] * 864e5,
    ).toISOString();
    const q = query.trim().toLowerCase();
    return feed.items.filter(
      (i) =>
        i.published >= cutoff &&
        (country === 'all' || i.country === country) &&
        (source === 'all' || i.feedId === source) &&
        (!q || `${i.title} ${i.summary} ${i.source}`.toLowerCase().includes(q)),
    );
  }, [feed, window, country, source, query]);

  const sources = useMemo(() => feed?.sources ?? [], [feed]);
  const broken = sources.filter((s) => s.error);

  // one row per publisher for the filter, since the Bank publishes three feeds
  const publishers = useMemo(() => {
    const out = new Map<string, { label: string; feedIds: string[] }>();
    for (const s of sources) {
      const found = out.get(s.source);
      if (found) found.feedIds.push(s.id);
      else out.set(s.source, { label: s.source, feedIds: [s.id] });
    }
    return [...out.values()];
  }, [sources]);

  const grouped = useMemo(() => {
    const out: { day: string; items: Item[] }[] = [];
    for (const item of shown) {
      const day = item.published.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
  }, [shown]);

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>News &amp; Commentary</h1>
        <p style={T.sub}>CNBC, FMP, Statistics Canada and the Bank of Canada, newest first</p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search headlines"
          style={{ ...T.input, flex: '1 1 180px', minWidth: 0 }}
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          style={T.input}
        >
          <option value="all">All sources</option>
          {publishers.flatMap((p) =>
            p.feedIds.map((id) => {
              const s = sources.find((x) => x.id === id);
              return (
                <option key={id} value={id}>
                  {p.label}
                  {p.feedIds.length > 1 && s ? ` · ${s.category}` : ''}
                </option>
              );
            }),
          )}
        </select>
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value as 'all' | 'CA' | 'US')}
          style={T.input}
          title="Publisher focus, not a classification of each article"
        >
          <option value="all">Both countries</option>
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>

        <span style={T.divider} />

        {WINDOWS.map(([key, label]) => (
          <button
            key={key}
            style={{ ...T.control, ...(window === key ? T.controlOn : {}) }}
            onClick={() => setWindow(key)}
          >
            {label}
          </button>
        ))}

        <div style={T.spacer} />
        <span style={{ fontSize: 11, color: COLOR.dim }}>
          {feed ? `Pulled ${feed.fetchedAt.slice(11, 16)} UTC` : 'Loading'}
        </span>
      </div>

      {broken.length > 0 && (
        <div style={S.warning}>
          <p style={{ ...T.desc, margin: 0, color: COLOR.ink }}>
            {broken.length} of {sources.length} feeds did not answer, so this page is not the
            whole stream: {broken.map((b) => `${b.source} (${b.error})`).join(', ')}
          </p>
        </div>
      )}

      <div style={S.grid}>
        <section style={card}>
          <div style={T.cardHead}>
            <div>
              <h2 style={T.h2}>Raw feed</h2>
            </div>
            <span style={{ fontSize: 11.5, color: COLOR.dim }}>
              {feed ? `${shown.length} of ${feed.items.length}` : ''}
            </span>
          </div>

          {!feed && <p style={{ fontSize: 12, color: COLOR.dim }}>Loading</p>}
          {feed && !shown.length && (
            <p style={{ fontSize: 12, color: COLOR.dim }}>
              Nothing in this window matches those filters.
            </p>
          )}

          {grouped.map((g) => (
            <div key={g.day}>
              <div style={S.dayHead}>{g.day}</div>
              {g.items.map((item) => (
                <a
                  key={item.id}
                  href={item.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={S.item}
                >
                  <div style={S.itemHead}>
                    <span
                      style={{
                        ...S.badge,
                        color: SOURCE_COLOR[item.source] ?? COLOR.dim,
                        borderColor: SOURCE_COLOR[item.source] ?? COLOR.line,
                      }}
                    >
                      {item.source}
                    </span>
                    <span style={S.category}>{item.category}</span>
                    {item.publisher && <span style={S.category}>{item.publisher}</span>}
                    <span style={S.time}>{item.published.slice(11, 16)} UTC</span>
                  </div>
                  <div style={S.title}>{item.title}</div>
                  {item.summary && <div style={S.summary}>{item.summary}</div>}
                </a>
              ))}
            </div>
          ))}
        </section>

        <section style={card}>
          <h2 style={T.h2}>Sources</h2>
          <p style={T.desc}>Items pulled on the last sweep</p>
          <table style={T.table}>
            <thead>
              <tr>
                <th style={T.th}>Feed</th>
                <th style={T.th}>Type</th>
                <th style={{ ...T.th, textAlign: 'right' }}>Items</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...T.td, color: s.error ? COLOR.bad : COLOR.ink }}>
                    {s.source}
                    <span style={{ display: 'block', fontSize: 10.5, color: COLOR.dim }}>
                      {s.country}
                    </span>
                  </td>
                  <td style={{ ...T.td, color: COLOR.dim }}>{s.category}</td>
                  <td
                    style={{
                      ...T.td,
                      textAlign: 'right',
                      color: s.error ? COLOR.bad : COLOR.dim,
                    }}
                  >
                    {s.error ? 'down' : s.count}
                  </td>
                </tr>
              ))}
              {!sources.length && (
                <tr>
                  <td style={{ ...T.td, color: COLOR.dim }} colSpan={3}>
                    Loading
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}

const S: Record<string, CSSProperties> = {
  // card sets the `border` shorthand, so the whole edge is restated in longhand
  // rather than overriding borderColor alone, which is the mix React warns on
  warning: {
    ...card,
    border: undefined,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: COLOR.ca,
    marginBottom: 16,
  },
  grid: T.splitWide,
  dayHead: {
    fontSize: 10.5,
    letterSpacing: '.2px',
    color: COLOR.accent,
    padding: '15px 0 7px',
    borderBottom: `1px solid ${COLOR.hair}`,
  },
  item: {
    display: 'block',
    padding: '11px 0',
    borderBottom: `1px solid ${COLOR.hair}`,
    textDecoration: 'none',
    color: 'inherit',
  },
  itemHead: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5, flexWrap: 'wrap' },
  badge: {
    fontSize: 9.5,
    letterSpacing: '.2px',
    padding: '2px 7px',
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: 'solid',
    whiteSpace: 'nowrap',
  },
  category: { fontSize: 10.5, color: COLOR.dim },
  time: { fontSize: 10.5, color: COLOR.dim, marginLeft: 'auto' },
  title: { fontSize: 13.5, color: COLOR.ink, lineHeight: 1.45 },
  summary: { fontSize: 12, color: COLOR.dim, lineHeight: 1.5, marginTop: 4 },
};
