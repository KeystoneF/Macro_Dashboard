'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, RADIUS, card } from '../../theme';
import { niceScale, tickDigits } from '../../lib/scale';
import { getJson } from '../../lib/api';
import { svgToPng } from '../../lib/png';
import { plotH, plotW, type Frame } from '../../components/chart';

type Row = {
  symbol: string;
  label: string;
  price: number | null;
  changePct: Record<string, number | null>;
  relative: Record<string, number | null>;
};

type Benchmark = { symbol: string; label: string; price: number | null; changePct: Record<string, number | null> };
type Sectors = { rows: Row[]; benchmark: Benchmark; quotedAt: string | null; fetchedAt: string };

type Valuation = {
  shiller: {
    label: string;
    source: string;
    page: string;
    value: number | null;
    average: number | null;
    asOf: string | null;
    error: string | null;
  };
  yardeni: { page: string; source: string; charts: { id: string; label: string }[] };
};

const PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
const REFRESH_MS = 60_000;

const CHART_URL = (id: string) => `/api/valuation/chart/${id}`;

const FRAME: Frame = { w: 900, h: 300, pad: { top: 16, right: 18, bottom: 54, left: 52 } };

export default function SectorTrackerPage() {
  const [period, setPeriod] = useState('YTD');
  const [data, setData] = useState<Sectors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [peChart, setPeChart] = useState('sp-mag7-smid');
  const chartRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      getJson<Sectors>('/api/markets/sectors')
        .then((d) => live && (setData(d), setError(null)))
        .catch((e) => live && setError(e.message));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  // loaded once, not on the quote timer
  useEffect(() => {
    let live = true;
    getJson<Valuation>('/api/valuation')
      .then((v) => live && setValuation(v))
      .catch(() => live && setValuation(null));
    return () => {
      live = false;
    };
  }, []);

  // strongest first, which is how a rotation table is read
  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const x = a.changePct[period];
      const y = b.changePct[period];
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }, [data, period]);

  const chart = useMemo(() => {
    const values = ranked.map((r) => r.changePct[period]).filter((v): v is number => v != null);
    if (!values.length) return null;

    const bench = data?.benchmark.changePct[period] ?? null;
    const span = [...values, 0, ...(bench == null ? [] : [bench])];
    const { lo, hi, ticks, step } = niceScale(Math.min(...span), Math.max(...span));

    return {
      ticks,
      digits: tickDigits(step ?? 1),
      bench,
      y: (v: number) => FRAME.pad.top + plotH(FRAME) * (1 - (v - lo) / (hi - lo)),
      band: plotW(FRAME) / ranked.length,
    };
  }, [ranked, period, data]);

  const benchChange = data?.benchmark.changePct[period] ?? null;

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>Sector &amp; Valuation</h1>
        <p style={T.sub}>S&amp;P 500 GICS sector performance, one State Street ETF per sector</p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        {PERIODS.map((p) => (
          <button
            key={p}
            style={{ ...T.control, ...(period === p ? T.controlOn : {}) }}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
        <span style={{ fontSize: 11, color: COLOR.dim, marginLeft: 6 }}>
          {data?.quotedAt ? `Oldest quote ${data.quotedAt.slice(11, 19)} UTC` : 'Loading'}
        </span>

        <div style={T.spacer} />
        <button
          style={T.control}
          onClick={() =>
            chartRef.current && svgToPng(chartRef.current, `sectors-${period}.png`, COLOR.bg, FONT.body)
          }
        >
          PNG
        </button>
        <a style={{ ...T.control, ...T.controlPrimary }} href="/api/markets/csv?kind=sectors">
          CSV
        </a>
      </div>

      <section style={{ ...card, marginBottom: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>Sector rotation, {period}</h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              Percent change. The dashed line is {data?.benchmark.label ?? 'the benchmark'} at{' '}
              {fmtPct(benchChange)}
            </p>
          </div>
        </div>

        {!chart ? (
          <p style={{ fontSize: 12, color: COLOR.dim }}>Loading</p>
        ) : (
          <svg ref={chartRef} viewBox={`0 0 ${FRAME.w} ${FRAME.h}`} style={{ width: '100%', height: 'auto' }}>
            {chart.ticks.map((t) => (
              <g key={t}>
                <line
                  x1={FRAME.pad.left}
                  x2={FRAME.w - FRAME.pad.right}
                  y1={chart.y(t)}
                  y2={chart.y(t)}
                  stroke={COLOR.hair}
                />
                <text
                  x={FRAME.pad.left - 8}
                  y={chart.y(t) + 4}
                  fill={COLOR.dim}
                  fontSize="10"
                  textAnchor="end"
                >
                  {t.toFixed(chart.digits)}
                </text>
              </g>
            ))}

            {/* zero is the line that decides gain from loss, not just a gridline */}
            <line
              x1={FRAME.pad.left}
              x2={FRAME.w - FRAME.pad.right}
              y1={chart.y(0)}
              y2={chart.y(0)}
              stroke={COLOR.line}
            />

            {ranked.map((r, i) => {
              const v = r.changePct[period];
              if (v == null) return null;
              const w = chart.band * 0.62;
              const cx = FRAME.pad.left + chart.band * (i + 0.5);
              const top = chart.y(v);
              const zero = chart.y(0);
              return (
                <g key={r.symbol}>
                  <rect
                    x={cx - w / 2}
                    y={Math.min(top, zero)}
                    width={w}
                    height={Math.max(1, Math.abs(zero - top))}
                    fill={v < 0 ? COLOR.bad : COLOR.good}
                    opacity={0.85}
                  />
                  <text
                    x={cx}
                    y={FRAME.h - 34}
                    fill={COLOR.dim}
                    fontSize="10"
                    textAnchor="middle"
                  >
                    {r.symbol}
                  </text>
                  <text
                    x={cx}
                    y={FRAME.h - 20}
                    fill={v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good}
                    fontSize="9.5"
                    textAnchor="middle"
                  >
                    {fmtPct(v)}
                  </text>
                </g>
              );
            })}

            {chart.bench != null && (
              <line
                x1={FRAME.pad.left}
                x2={FRAME.w - FRAME.pad.right}
                y1={chart.y(chart.bench)}
                y2={chart.y(chart.bench)}
                stroke={COLOR.accent}
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
            )}
          </svg>
        )}
      </section>

      <div style={S.grid}>
        <section style={card}>
          <h2 style={T.h2}>Sector performance</h2>
          <p style={T.desc}>
            Relatively shows how far the sector ran ahead of or behind{' '}
            {data?.benchmark.label ?? 'the benchmark'}.
          </p>
          <div style={T.scrollX}>
            <table style={{ ...T.table, minWidth: 620 }}>
            <thead>
              <tr>
                <th style={T.th}>Sector</th>
                <th style={T.th}>ETF</th>
                <th style={{ ...T.th, textAlign: 'right' }}>Last</th>
                {PERIODS.map((p) => (
                  <th
                    key={p}
                    style={{
                      ...T.th,
                      textAlign: 'right',
                      color: p === period ? COLOR.ink : COLOR.dim,
                    }}
                  >
                    {p}
                  </th>
                ))}
                <th style={{ ...T.th, textAlign: 'right' }}>Rel {period}</th>
              </tr>
            </thead>
            <tbody>
              {!data && (
                <tr>
                  <td style={{ ...T.td, color: COLOR.dim }} colSpan={10}>
                    Loading
                  </td>
                </tr>
              )}
              {ranked.map((r) => (
                <tr key={r.symbol}>
                  <td style={{ ...T.td, color: COLOR.ink }}>{r.label}</td>
                  <td style={{ ...T.td, color: COLOR.dim }}>{r.symbol}</td>
                  <td style={{ ...T.td, textAlign: 'right', color: COLOR.dim }}>
                    {r.price == null ? 'n/a' : r.price.toFixed(2)}
                  </td>
                  {PERIODS.map((p) => (
                    <td
                      key={p}
                      style={{
                        ...T.td,
                        textAlign: 'right',
                        color: pctColor(r.changePct[p]),
                        opacity: p === period ? 1 : 0.62,
                      }}
                    >
                      {fmtPct(r.changePct[p])}
                    </td>
                  ))}
                  <td
                    style={{
                      ...T.td,
                      textAlign: 'right',
                      color: pctColor(r.relative[period]),
                    }}
                  >
                    {fmtPct(r.relative[period])}
                  </td>
                </tr>
              ))}
              {data && (
                <tr>
                  <td style={{ ...T.td, color: COLOR.dim }}>{data.benchmark.label}</td>
                  <td style={{ ...T.td, color: COLOR.dim }}>{data.benchmark.symbol}</td>
                  <td style={{ ...T.td, textAlign: 'right', color: COLOR.dim }}>
                    {data.benchmark.price == null ? 'n/a' : data.benchmark.price.toFixed(2)}
                  </td>
                  {PERIODS.map((p) => (
                    <td
                      key={p}
                      style={{
                        ...T.td,
                        textAlign: 'right',
                        color: pctColor(data.benchmark.changePct[p]),
                        opacity: p === period ? 1 : 0.62,
                      }}
                    >
                      {fmtPct(data.benchmark.changePct[p])}
                    </td>
                  ))}
                  <td style={{ ...T.td, textAlign: 'right', color: COLOR.dim }}>n/a</td>
                </tr>
              )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={card}>
          <div style={T.cardHead}>
            <div>
              <h2 style={T.h2}>Shiller PE</h2>
              <p style={{ ...T.desc, marginBottom: 0 }}>Cyclically adjusted, as GuruFocus publishes it</p>
            </div>
            <div style={T.readout}>{stampOf(valuation?.shiller.asOf)}</div>
          </div>
          <table style={T.table}>
            <tbody>
              <Reference label="Current" value={valuation?.shiller.value} />
              <Reference label="All-time historical average" value={valuation?.shiller.average} />
            </tbody>
          </table>
          <PublisherChart
            src={CHART_URL('shiller')}
            alt="Shiller PE ratio, published by GuruFocus"
            page={valuation?.shiller.page}
            credit={valuation?.shiller.source}
          />
        </section>
      </div>

      <section style={{ ...card, marginTop: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>Forward P/E ratios</h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              Yardeni Research, draws from LSEG Datastream
            </p>
          </div>
        </div>

        <div style={T.controls}>
          <select value={peChart} onChange={(e) => setPeChart(e.target.value)} style={T.input}>
            {(valuation?.yardeni.charts ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <div style={T.spacer} />
          <a style={T.control} href={CHART_URL(peChart)} download={`${peChart}.png`}>
            PNG
          </a>
        </div>

        <PublisherChart
          // remounts on change, clearing the previous chart's error state
          key={peChart}
          src={CHART_URL(peChart)}
          alt={valuation?.yardeni.charts.find((c) => c.id === peChart)?.label ?? 'Forward P/E ratios'}
          page={valuation?.yardeni.page}
          credit={valuation?.yardeni.source}
          // floor width, the panel scrolls below it
          minWidth={820}
        />
      </section>
    </main>
  );
}

// one figure row, n/a until the value is read
function Reference({ label, value }: { label: string; value?: number | null }) {
  return (
    <tr>
      <td style={{ ...T.td, color: COLOR.dim, width: '55%' }}>{label}</td>
      <td
        style={{
          ...T.td,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: value == null ? COLOR.dim : COLOR.ink,
        }}
      >
        {value == null ? 'n/a' : value.toFixed(1)}
      </td>
    </tr>
  );
}

// publisher's chart, linked to its page. onError replaces a broken image
function PublisherChart({
  src,
  alt,
  page,
  credit,
  minWidth,
}: {
  src: string;
  alt: string;
  page?: string;
  credit?: string;
  minWidth?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <p style={{ ...T.desc, margin: '14px 0 0' }}>Chart unavailable from {credit ?? 'the publisher'}</p>;
  }

  return (
    <figure style={{ margin: '14px 0 0' }}>
      <div style={minWidth ? T.scrollX : undefined}>
        <a href={page} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image
              re-encodes the file through its own loader */}
          <img src={src} alt={alt} style={{ ...S.paper, minWidth }} onError={() => setFailed(true)} />
        </a>
      </div>
      <figcaption style={{ ...T.desc, margin: '8px 0 0' }}>{credit}</figcaption>
    </figure>
  );
}

// formats the stamp read off the chart
const stampOf = (iso?: string | null) =>
  iso ? `As of ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : 'As of n/a';

const fmtPct = (v: number | null | undefined) =>
  v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

const pctColor = (v: number | null | undefined) =>
  v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good;

const S: Record<string, CSSProperties> = {
  grid: T.splitWide,

  // white ground behind the publisher's chart
  paper: {
    display: 'block',
    width: '100%',
    height: 'auto',
    background: '#FFF',
    borderRadius: RADIUS.card,
  },
};
