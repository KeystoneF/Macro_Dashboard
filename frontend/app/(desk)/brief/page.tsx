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
import { MODULES, bySlug } from '../modules';

type Metric = {
  key: string;
  country: string;
  countryName: string;
  kind: string;
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

type Country = { code: string; name: string; feed: string | null; national: boolean };

type Panel = {
  metrics: Metric[];
  truncated: number;
  countries: Country[];
  snapshotError: string | null;
};

// One fact as the module that owns it pulled it. The value is a string here on
// purpose: it is formatted where it was read, so nothing downstream can round
// it a second time.
type Fact = {
  id: string;
  module: string;
  moduleNum: string;
  moduleLabel: string;
  country?: string;
  label: string;
  value: string | null;
  period: string | null;
  note?: string | null;
  title?: string;
  link?: string;
  published?: string;
  source: string;
};

type Digest = {
  window: string;
  country: string;
  items: { rank: number; line: string | null; fact: Fact }[];
  ranked: boolean;
  model: string | null;
  modelError: string | null;
  facts: number;
  missing: { module: string; num: string; error: string }[];
  skipped: { module: string; num: string; reason: string }[];
  modules: string[];
  gatheredAt: string;
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

const ALL = 'all';

export default function BriefPage() {
  const [period, setPeriod] = useState<Period>('daily');
  const [country, setCountry] = useState(ALL);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
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

  const loadPanel = useCallback(() => {
    getJson<Panel>(`/api/brief/metrics?country=${country}`)
      .then((b) => mounted.current && setPanel(b))
      .catch((e) => mounted.current && setError(e.message));
  }, [country]);

  const loadDigest = useCallback(() => {
    getJson<Digest>(`/api/brief/digest?window=${period}&country=${country}`)
      .then((d) => mounted.current && setDigest(d))
      .catch((e) => mounted.current && setError(e.message));
  }, [period, country]);

  useEffect(() => {
    loadPanel();
    loadDigest();
  }, [loadPanel, loadDigest]);

  useEffect(() => {
    loadNews();
    loadMarkets(true);
    const news = setInterval(loadNews, NEWS_REFRESH_MS);
    const markets = setInterval(() => loadMarkets(), MARKET_REFRESH_MS);
    return () => {
      clearInterval(news);
      clearInterval(markets);
    };
  }, [loadNews, loadMarkets]);

  const reload = useCallback(() => {
    loadPanel();
    loadDigest();
    loadNews();
    loadMarkets(true);
  }, [loadPanel, loadDigest, loadNews, loadMarkets]);

  useNavRefresh('brief', reload);
  useFocusRefresh(reload);

  // the answer names the window and country it was built for, so a ranking for
  // the previous pick is not left on screen while the next one is in flight
  const ranking = digest && digest.window === period && digest.country === country ? digest : null;

  const picked = panel?.countries.find((c) => c.code === country) ?? null;
  // the aggregator's publishers cover two countries, so any other choice has no
  // headlines of its own rather than every publisher's
  const feedless = country !== ALL && !picked?.feed;

  // The window is measured from when the server pulled the feeds rather than
  // from this machine's clock, so "the last 24 hours" means the day before the
  // data was collected.
  const shown = useMemo(() => {
    if (!feed) return { releases: [], headlines: [] };
    const cutoff = new Date(Date.parse(feed.fetchedAt) - tab.days * 864e5).toISOString();
    const inWindow = feed.items.filter(
      (i) => i.published >= cutoff && (!picked?.feed || i.country === picked.feed),
    );
    return {
      releases: inWindow.filter((i) => i.category !== 'Markets'),
      headlines: inWindow.filter((i) => i.category === 'Markets'),
    };
  }, [feed, tab, picked]);

  const watchlist = bySlug('watchlist');

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>Daily Brief</h1>
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

        <select
          style={{ ...T.input, maxWidth: 220 }}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          title="Applies to the prints, the ranking and the publisher focus"
        >
          <option value={ALL}>All countries</option>
          {(panel?.countries ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Ranked digest={ranking} />

          <section style={card}>
            <h2 style={T.h2}>Releases and commentary</h2>
            <p style={T.desc}>Newest first.</p>

            {feedless && (
              <p style={S.quiet}>
                No publisher in the aggregator covers {picked?.name ?? 'this country'}.
              </p>
            )}
            {!feedless && (
              <>
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
              </>
            )}
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section style={card}>
            <h2 style={T.h2}>Key metrics</h2>
            <p style={T.desc}>
              {country === ALL ? 'Newest print first.' : 'Latest print, with its period.'}
            </p>
            {!panel && <p style={S.quiet}>Loading</p>}
            {panel && !panel.metrics.length && <p style={S.quiet}>No print on file for this country</p>}
            {(panel?.metrics ?? []).map((m, i) => (
              <MetricRow key={m.key} metric={m} last={i === panel!.metrics.length - 1} />
            ))}
            {!!panel?.truncated && (
              <p style={{ ...S.quiet, marginTop: 10 }}>
                {panel.truncated} more across the{' '}
                <Link href="/international" style={S.link}>
                  international module
                </Link>
                .
              </p>
            )}
            {panel?.snapshotError && (
              <p style={{ ...S.quiet, color: COLOR.bad, marginTop: 10 }}>{panel.snapshotError}</p>
            )}
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
              Needs{' '}
              <Link href={`/${watchlist?.slug}`} style={S.link}>
                mod 8
              </Link>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

// The panel design/1-daily-brief.html calls "Top Releases & Articles Ranked by
// Model". The model orders the picks and writes the line; every figure on the
// row is the one the owning module pulled.
function Ranked({ digest }: { digest: Digest | null }) {
  const covered = (digest?.modules ?? [])
    .map((num) => MODULES.find((m) => m.num === num))
    .filter(Boolean).length;

  return (
    <section style={card}>
      <div style={T.cardHead}>
        <div style={{ minWidth: 0 }}>
          <h2 style={T.h2}>Ranked by model</h2>
          <p style={{ ...T.desc, marginBottom: 0 }}>
            {digest && !digest.ranked
              ? 'Ranking unavailable.'
              : 'The model picks from what the modules pulled. Every figure is the source’s.'}
          </p>
        </div>
        {digest?.ranked && digest.model && (
          <span style={{ fontSize: 10.5, color: COLOR.dim, whiteSpace: 'nowrap' }}>
            {digest.model}
          </span>
        )}
      </div>

      {!digest && <p style={S.quiet}>Reading the desk</p>}
      {digest && !digest.items.length && (
        <p style={S.quiet}>Nothing to rank in this window</p>
      )}

      {(digest?.items ?? []).map((item, i) => (
        <RankedRow
          key={item.fact.id}
          rank={item.rank}
          line={item.line}
          fact={item.fact}
          last={i === digest!.items.length - 1}
        />
      ))}

      {digest && (
        <p style={{ ...S.quiet, marginTop: 12 }}>
          {digest.facts} facts from {covered} of {MODULES.length} modules
          {digest.missing.length
            ? `, ${digest.missing.map((m) => `module ${m.num} unavailable`).join(', ')}`
            : ''}
          {digest.modelError ? `. ${digest.modelError}` : ''}
        </p>
      )}
    </section>
  );
}

function RankedRow({
  rank,
  line,
  fact,
  last,
}: {
  rank: number;
  line: string | null;
  fact: Fact;
  last: boolean;
}) {
  const owner = MODULES.find((m) => m.slug === fact.module);
  const stamp = [fact.period, fact.note, fact.source].filter(Boolean).join(', ');

  return (
    <div style={{ ...S.rankRow, borderBottom: last ? 'none' : `1px solid ${COLOR.hair}` }}>
      <div style={S.rank}>{String(rank).padStart(2, '0')}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={S.rankHead}>
          {owner && (
            <Link href={`/${owner.slug}`} style={S.moduleBadge}>
              {owner.num} {owner.label}
            </Link>
          )}
          {fact.value && <span style={S.rankValue}>{fact.value}</span>}
        </div>

        {fact.title && fact.link ? (
          <a href={fact.link} target="_blank" rel="noreferrer noopener" style={S.rankTitle}>
            {fact.title}
          </a>
        ) : (
          <div style={S.rankTitle}>{fact.label}</div>
        )}

        {fact.title && <div style={S.sub}>{fact.label}</div>}
        {line && <div style={S.rankLine}>{line}</div>}
        {stamp && <div style={S.sub}>{stamp}</div>}
      </div>
    </div>
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
          {metric.countryName}: {metric.label}
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
  rankRow: { display: 'flex', gap: 12, padding: '12px 0' },
  rank: {
    fontFamily: T.FONT.display,
    fontStyle: 'italic',
    fontSize: 19,
    color: COLOR.accent,
    width: 28,
    flexShrink: 0,
    lineHeight: 1.2,
  },
  rankHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 4,
  },
  moduleBadge: {
    fontSize: 9.5,
    letterSpacing: '.2px',
    color: COLOR.dim,
    padding: '2px 7px',
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: COLOR.line,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  },
  rankValue: { fontSize: 13, color: COLOR.ink, whiteSpace: 'nowrap' },
  rankTitle: {
    display: 'block',
    fontSize: 13.5,
    color: COLOR.ink,
    lineHeight: 1.45,
    textDecoration: 'none',
  },
  rankLine: { fontSize: 12, color: COLOR.dim, lineHeight: 1.5, marginTop: 4 },
  metricRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    padding: '9px 0',
  },
  metricName: { fontSize: 12.5, color: COLOR.ink },
};
