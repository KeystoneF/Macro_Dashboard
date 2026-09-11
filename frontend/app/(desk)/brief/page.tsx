'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, card } from '../../theme';
import { getJson } from '../../lib/api';
import { age, fmtPct, fmtPrice, pctColor } from '../../lib/format';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useFocusRefresh, useNavRefresh } from '../../lib/navRefresh';
import FeedItem, { type Item } from '../../components/FeedItem';
import { bySlug } from '../modules';

type Metric = {
  key: string;
  country: 'CA' | 'US';
  label: string;
  units: string;
  freq: string;
  digits: number;
  id: string;
  source: string;
  value: number | null;
  period: string | null;
  previous: { value: number; period: string } | null;
  unchangedSince: string | null;
  error?: string;
};

type MarketRow = {
  symbol: string;
  label: string;
  group: string;
  currency: string;
  unit?: string;
  decimals: number;
  price: number | null;
  quotedAt: string | null;
  changePct: Record<string, number | null>;
};

type Board = { rows: MarketRow[]; quotedAt: string | null; fetchedAt: string };
type Feed = { items: Item[]; fetchedAt: string };

// One window drives both halves of the page: the feed reaches back this far and
// the market column shows the move over the same span.
const PERIODS = [
  { key: 'daily', label: 'Daily', days: 1, change: '1D' },
  { key: 'weekly', label: 'Weekly', days: 7, change: '1W' },
  { key: 'monthly', label: 'Monthly', days: 30, change: '1M' },
] as const;

type Period = (typeof PERIODS)[number]['key'];

const MARKET_REFRESH_MS = 60_000;
// the feeds are cached five minutes upstream, so asking faster only costs a
// round trip to our own api
const NEWS_REFRESH_MS = 5 * 60_000;

const SHOWN = 6;

const COUNTRIES: [string, string][] = [
  ['all', 'Both'],
  ['CA', 'Canada'],
  ['US', 'United States'],
];

export default function BriefPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [country, setCountry] = useState('all');
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  // below this the two columns have nowhere to go, and the right one carries
  // tables that cannot shrink much further
  const narrow = useMediaQuery('(max-width: 1080px)');
  const tab = PERIODS.find((p) => p.key === period) ?? PERIODS[0];

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // fresh=1 skips the api's own quote cache, which is what a deliberate click
  // on the module is asking for
  const loadMarkets = useCallback((fresh = false) => {
    getJson<Board>(`/api/markets/brief${fresh ? '?fresh=1' : ''}`)
      .then((b) => mounted.current && (setBoard(b), setError(null)))
      .catch((e) => mounted.current && setError(e.message));
  }, []);

  const loadNews = useCallback(() => {
    getJson<Feed>('/api/news?window=30d&limit=300')
      .then((f) => mounted.current && setFeed(f))
      .catch((e) => mounted.current && setError(e.message));
  }, []);

  const loadMetrics = useCallback(() => {
    getJson<{ metrics: Metric[] }>('/api/brief/metrics')
      .then((b) => mounted.current && setMetrics(b.metrics))
      .catch((e) => mounted.current && setError(e.message));
  }, []);

  useEffect(() => {
    loadMetrics();
    loadNews();
    loadMarkets(true);
    const news = setInterval(loadNews, NEWS_REFRESH_MS);
    const markets = setInterval(() => loadMarkets(), MARKET_REFRESH_MS);
    return () => {
      clearInterval(news);
      clearInterval(markets);
    };
  }, [loadMetrics, loadNews, loadMarkets]);

  const reload = useCallback(() => {
    loadMetrics();
    loadNews();
    loadMarkets(true);
  }, [loadMetrics, loadNews, loadMarkets]);

  useNavRefresh('brief', reload);
  useFocusRefresh(reload);

  // The window is measured from when the server pulled the feeds rather than
  // from this machine's clock, so "the last 24 hours" means the day before the
  // data was collected.
  const shown = useMemo(() => {
    if (!feed) return { releases: [], headlines: [] };
    const cutoff = new Date(Date.parse(feed.fetchedAt) - tab.days * 864e5).toISOString();
    const inWindow = feed.items.filter(
      (i) => i.published >= cutoff && (country === 'all' || i.country === country),
    );
    return {
      releases: inWindow.filter((i) => i.category !== 'Markets'),
      headlines: inWindow.filter((i) => i.category === 'Markets'),
    };
  }, [feed, tab, country]);

  const watchlist = bySlug('watchlist');

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>Daily Brief</h1>
        <p style={T.sub}>Canada and the United States: what printed, and what moved</p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            style={{ ...T.control, ...(period === p.key ? T.controlOn : {}) }}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}

        <span style={T.divider} />

        {COUNTRIES.map(([key, label]) => (
          <button
            key={key}
            style={{ ...T.control, ...(country === key ? T.controlOn : {}) }}
            onClick={() => setCountry(key)}
            title="Publisher focus, not a classification of each article"
          >
            {label}
          </button>
        ))}

        <div style={T.spacer} />
        <span style={{ fontSize: 11, color: COLOR.dim }}>
          {feed ? `Feeds pulled ${feed.fetchedAt.slice(11, 16)} UTC` : 'Loading'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.55fr) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <section style={card}>
          <h2 style={T.h2}>Releases and commentary</h2>
          <p style={T.desc}>
            Newest first over the {tab.label.toLowerCase()} window. Ranking by model is not wired,
            so this is publication order.
          </p>

          <Stream
            title="Official releases"
            items={shown.releases}
            empty="Nothing published in this window"
            loading={!feed}
          />
          <Stream
            title="Market headlines"
            items={shown.headlines}
            empty="Nothing published in this window"
            loading={!feed}
          />
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={card}>
            <h2 style={T.h2}>Key metrics</h2>
            <p style={T.desc}>Latest print from each national source, with its period.</p>
            {!metrics && <p style={S.quiet}>Loading</p>}
            {(metrics ?? []).map((m, i) => (
              <MetricRow key={m.key} metric={m} last={i === (metrics ?? []).length - 1} />
            ))}
          </section>

          <section style={card}>
            <h2 style={T.h2}>Markets</h2>
            <p style={T.desc}>Last price and the move over the window.</p>
            <div style={T.scrollX}>
              <table style={{ ...T.table, minWidth: 300 }}>
                <thead>
                  <tr>
                    <th style={T.th}>Instrument</th>
                    <th style={{ ...T.th, textAlign: 'right' }}>Last</th>
                    <th style={{ ...T.th, textAlign: 'right' }}>{tab.change} %</th>
                    <th style={{ ...T.th, textAlign: 'right' }}>Quoted</th>
                  </tr>
                </thead>
                <tbody>
                  {!board && (
                    <tr>
                      <td style={{ ...T.td, color: COLOR.dim }} colSpan={4}>
                        Loading
                      </td>
                    </tr>
                  )}
                  {(board?.rows ?? []).map((r) => (
                    <tr key={r.symbol}>
                      <td style={{ ...T.td, color: COLOR.ink }}>
                        {r.label}
                        <span style={S.sub}>{r.currency}</span>
                      </td>
                      <td style={{ ...T.td, textAlign: 'right' }}>
                        {fmtPrice(r.price, r.decimals)}
                      </td>
                      <td
                        style={{
                          ...T.td,
                          textAlign: 'right',
                          color: pctColor(r.changePct[tab.change]),
                        }}
                      >
                        {fmtPct(r.changePct[tab.change])}
                      </td>
                      {/* a price that is not moving because the feed is delayed
                          looks exactly like a live one otherwise */}
                      <td style={{ ...T.td, ...S.age, textAlign: 'right' }}>{age(r.quotedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section style={card}>
            <h2 style={T.h2}>On deck</h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              Watchlist news, earnings dates and the release calendar land here with{' '}
              <Link href={`/${watchlist?.slug}`} style={S.link}>
                module {watchlist?.num}
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Stream({
  title,
  items,
  empty,
  loading,
}: {
  title: string;
  items: Item[];
  empty: string;
  loading: boolean;
}) {
  const rest = items.length - SHOWN;

  return (
    <div>
      <div style={S.streamHead}>
        {title}
        <span style={{ color: COLOR.dim }}>{loading ? '' : items.length}</span>
      </div>
      {loading && <p style={S.quiet}>Loading</p>}
      {!loading && !items.length && <p style={S.quiet}>{empty}</p>}
      {items.slice(0, SHOWN).map((item) => (
        <FeedItem key={item.id} item={item} />
      ))}
      {rest > 0 && (
        <p style={{ ...S.quiet, marginTop: 8 }}>
          {rest} more in this window, on the{' '}
          <Link href="/news" style={S.link}>
            news module
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function MetricRow({ metric, last }: { metric: Metric; last: boolean }) {
  const note = metric.error
    ? metric.error
    : metric.unchangedSince
      ? `unchanged since ${metric.unchangedSince}`
      : metric.previous
        ? `prev ${metric.previous.value.toFixed(metric.digits)}`
        : '';

  return (
    <div style={{ ...S.metricRow, borderBottom: last ? 'none' : `1px solid ${COLOR.hair}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={S.metricName}>
          {metric.country}: {metric.label}
        </div>
        <div style={S.sub}>{metric.source}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div>
          <span style={{ fontSize: 14, color: metric.value == null ? COLOR.dim : COLOR.ink }}>
            {metric.value == null ? 'n/a' : metric.value.toFixed(metric.digits)}
          </span>
          <span style={{ ...S.sub, display: 'inline', marginLeft: 5 }}>{metric.units}</span>
        </div>
        {/* the period always travels with the figure: a July print read in
            September is not this month's */}
        <div style={{ ...S.sub, color: metric.error ? COLOR.bad : COLOR.dim }}>
          {metric.period ?? 'n/a'}
          {note ? `, ${note}` : ''}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  quiet: { fontSize: 12, color: COLOR.dim },
  sub: { display: 'block', fontSize: 10.5, color: COLOR.dim },
  age: { fontSize: 10.5, color: COLOR.dim },
  link: { color: COLOR.accent, textDecoration: 'none' },
  streamHead: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10.5,
    letterSpacing: '.2px',
    color: COLOR.accent,
    padding: '14px 0 6px',
    borderBottom: `1px solid ${COLOR.hair}`,
  },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    padding: '9px 0',
  },
  metricName: { fontSize: 12.5, color: COLOR.ink },
};
