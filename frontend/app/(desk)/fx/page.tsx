'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, card } from '../../theme';
import { niceScale, tickDigits } from '../../lib/scale';
import { getJson } from '../../lib/api';
import { svgToPng } from '../../lib/png';
import { toTime, yearTicks, type Obs } from '../../lib/time';
import { Gridlines, HoverRule, XLabels, timeAt, plotW, plotH, type Frame } from '../../components/chart';
import Sparkline from '../../components/Sparkline';
import { useFocusRefresh, useNavRefresh } from '../../lib/navRefresh';

type Row = {
  symbol: string;
  label: string;
  group: string;
  currency: string;
  unit?: string;
  decimals: number;
  name: string | null;
  quotedAt: string | null;
  price: number | null;
  dayChange: number | null;
  dayLow: number | null;
  dayHigh: number | null;
  yearLow: number | null;
  yearHigh: number | null;
  changePct: Record<string, number | null>;
};

type Board = { rows: Row[]; quotedAt: string | null; fetchedAt: string };
type History = {
  symbol: string;
  label: string;
  currency: string;
  range: string;
  interval: string;
  timezone: string;
  note?: string;
  points: Obs[];
};

const PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
const FRAME: Frame = { w: 900, h: 300, pad: { top: 14, right: 18, bottom: 30, left: 62 } };

// Prices move while the page is open, so the boards refresh themselves. The API
// holds a quote for fifteen seconds, so this is what decides how current the
// board is; a minute of it on top of a minute of cache was putting two minute
// old prices under a label that read as live.
const REFRESH_MS = 20_000;

export default function FxCommoditiesPage() {
  const [period, setPeriod] = useState('1D');
  const [fx, setFx] = useState<Board | null>(null);
  const [commodities, setCommodities] = useState<Board | null>(null);
  const [selected, setSelected] = useState('USDCAD');
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);

  // held in a ref rather than in state: unmounting has to be able to silence a
  // reply that is already in flight, and every caller below shares one switch
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // fresh=1 skips the API's own quote cache. A poll can take the cached copy,
  // but an analyst who just clicked the module is asking for the current print.
  const load = useCallback((fresh = false) => {
    const q = fresh ? '?fresh=1' : '';
    getJson<Board>(`/api/markets/fx${q}`)
      .then((b) => mounted.current && (setFx(b), setError(null)))
      .catch((e) => mounted.current && setError(e.message));
    getJson<Board>(`/api/markets/commodities${q}`)
      .then((b) => mounted.current && setCommodities(b))
      .catch((e) => mounted.current && setError(e.message));
  }, []);

  const reload = useCallback(() => load(true), [load]);

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useNavRefresh('fx', reload);
  useFocusRefresh(reload);

  useEffect(() => {
    let live = true;
    getJson<History>(`/api/markets/history?symbol=${selected}&range=${period}`)
      .then((h) => live && setHistory(h))
      .catch(() => live && setHistory(null));
    return () => {
      live = false;
    };
  }, [selected, period]);

  // the detail panel's chart belongs to the selected symbol and range, so an
  // answer for a stale pair is ignored rather than drawn under the new heading
  const shown = history && history.symbol === selected && history.range === period ? history : null;

  const scale = useMemo(() => {
    if (!shown || shown.points.length < 2) return null;
    const values = shown.points.map((p) => p.v);
    const times = shown.points.map((p) => toTime(p.d));
    const { lo, hi, ticks, step } = niceScale(Math.min(...values), Math.max(...values));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);
    return {
      ticks,
      digits: Math.max(tickDigits(step ?? 1), 2),
      t0,
      t1,
      x: (t: number) => FRAME.pad.left + (plotW(FRAME) * (t - t0)) / (t1 - t0 || 1),
      y: (v: number) => FRAME.pad.top + plotH(FRAME) * (1 - (v - lo) / (hi - lo)),
      years: yearTicks(t0, t1),
    };
  }, [shown]);

  const selectedRow = [...(fx?.rows ?? []), ...(commodities?.rows ?? [])].find(
    (r) => r.symbol === selected,
  );

  // the oldest print across both boards, because that is how current the
  // screen actually is. FMP delays some instruments more than others and this
  // used to be the time of our own fetch, which said nothing about either.
  const quotedAt = [fx?.quotedAt, commodities?.quotedAt].filter(Boolean).sort()[0] ?? null;

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>FX &amp; Commodities</h1>
        <p style={T.sub}>Currency pairs and commodity prices via FMP</p>
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
          {quotedAt ? `Oldest quote ${quotedAt.slice(11, 19)} UTC` : 'Loading'}
        </span>

        <div style={T.spacer} />
        <a style={T.control} href="/api/markets/csv?kind=fx">
          FX CSV
        </a>
        <a style={{ ...T.control, ...T.controlPrimary }} href="/api/markets/csv?kind=commodities">
          Commodities CSV
        </a>
      </div>

      <div style={S.grid}>
        <BoardTable
          title="FX: majors and CAD crosses"
          note="Click a row to load the detail chart below"
          board={fx}
          period={period}
          selected={selected}
          onSelect={setSelected}
        />
        <BoardTable
          title="Commodities"
          note="Energy, metals and agriculture"
          board={commodities}
          period={period}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      <section style={{ ...card, marginTop: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>{selectedRow ? selectedRow.label : selected} detail</h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              {selectedRow
                ? `${fmtPrice(selectedRow.price, selectedRow.decimals)} ${priceUnit(selectedRow)}${quoteAge(selectedRow)}${shown?.points.length ? `, ${barNote(shown)}` : ''}`
                : 'Loading'}
            </p>
          </div>
          <div style={T.readout}>
            {hover != null && shown ? (
              <>
                <b style={{ color: COLOR.ink }}>
                  {nearestPoint(shown.points, hover)?.d.replace('T', ' ')}
                </b>
                <span style={{ color: COLOR.accent }}>
                  {fmtPrice(nearestPoint(shown.points, hover)?.v ?? null, selectedRow?.decimals ?? 4)}
                </span>
              </>
            ) : (
              <span>{selectedRow ? rangeNote(selectedRow) : ''}</span>
            )}
          </div>
        </div>

        {!scale || !shown ? (
          <p style={{ fontSize: 12, color: COLOR.dim }}>
            {shown
              ? (shown.note ?? 'Not enough history in this window to draw a line')
              : 'Loading'}
          </p>
        ) : (
          <svg
            ref={chartRef}
            viewBox={`0 0 ${FRAME.w} ${FRAME.h}`}
            style={{ width: '100%', height: 'auto' }}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => setHover(timeAt(e, FRAME, scale.t0, scale.t1))}
          >
            <Gridlines frame={FRAME} ticks={scale.ticks} y={scale.y} digits={scale.digits} />
            <XLabels
              frame={FRAME}
              items={dateLabels(shown.points, scale.x)}
            />
            <polyline
              points={shown.points.map((p) => `${scale.x(toTime(p.d))},${scale.y(p.v)}`).join(' ')}
              fill="none"
              stroke={COLOR.accent}
              strokeWidth="2.1"
            />
            {hover != null && <HoverRule frame={FRAME} x={scale.x(hover)} />}
          </svg>
        )}

        <div style={S.chartFoot}>
          <span>
            {shown?.points.length
              ? `${shown.points.length} ${shown.interval === 'daily' ? 'closes' : `${shown.interval} bars, ${shown.timezone.split('/')[1].replace('_', ' ')} time`}`
              : ''}
          </span>
          <button
            style={T.control}
            onClick={() =>
              chartRef.current &&
              svgToPng(chartRef.current, `${selected}-${period}.png`, COLOR.bg, FONT.body)
            }
          >
            PNG
          </button>
        </div>
      </section>
    </main>
  );
}

function BoardTable({
  title,
  note,
  board,
  period,
  selected,
  onSelect,
}: {
  title: string;
  note: string;
  board: Board | null;
  period: string;
  selected: string;
  onSelect: (s: string) => void;
}) {
  const groups = [...new Set((board?.rows ?? []).map((r) => r.group))];

  return (
    <section style={card}>
      <h2 style={T.h2}>{title}</h2>
      <p style={T.desc}>{note}</p>
      <div style={T.scrollX}>
        <table style={{ ...T.table, minWidth: 430 }}>
        <thead>
          <tr>
            <th style={T.th}>Instrument</th>
            <th style={{ ...T.th, textAlign: 'right' }}>Last</th>
            {/* its own column: sharing the Last cell pushed the price off the
                right edge whenever a row was running behind */}
            <th style={{ ...T.th, textAlign: 'right' }}>Quoted</th>
            <th style={{ ...T.th, textAlign: 'right' }}>{period} %</th>
            <th style={{ ...T.th, textAlign: 'right' }}>Day range</th>
          </tr>
        </thead>
        {!board && (
          <tbody>
            <tr>
              <td style={{ ...T.td, color: COLOR.dim }} colSpan={5}>
                Loading
              </td>
            </tr>
          </tbody>
        )}
        {groups.map((g) => (
          <tbody key={g}>
            <tr>
              <td style={S.groupHead} colSpan={5}>
                {g}
              </td>
            </tr>
            {(board?.rows ?? [])
              .filter((r) => r.group === g)
              .map((r) => {
                const on = r.symbol === selected;
                const chg = r.changePct[period];
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => onSelect(r.symbol)}
                    style={{
                      cursor: 'pointer',
                      background: on ? 'rgba(26,168,151,.10)' : 'transparent',
                    }}
                  >
                    <td style={{ ...T.td, color: on ? COLOR.ink : COLOR.dim }}>
                      {r.label}
                      {r.currency === 'USX' && (
                        // cents, not dollars, and the number alone does not say so
                        <span style={S.tag}>cents</span>
                      )}
                    </td>
                    <td style={{ ...T.td, textAlign: 'right', color: COLOR.ink }}>
                      {fmtPrice(r.price, r.decimals)}
                    </td>
                    {/* a price that is not moving because the feed is delayed,
                        or because the pit is shut, looks exactly like a live
                        one otherwise */}
                    <td
                      style={{ ...T.td, ...S.age, textAlign: 'right' }}
                      title={r.quotedAt ? `Last print ${r.quotedAt.slice(11, 19)} UTC, from FMP` : undefined}
                    >
                      {age(r)}
                    </td>
                    <td style={{ ...T.td, textAlign: 'right', color: pctColor(chg) }}>
                      {fmtPct(chg)}
                    </td>
                    <td style={{ ...T.td, textAlign: 'right' }}>
                      <div style={S.trendCell}>
                        <Sparkline
                          points={dayBand(r)}
                          color={chg == null ? COLOR.dim : chg < 0 ? COLOR.bad : COLOR.good}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

// The day's low, last and high. Three real prints, not a modelled intraday path:
// it says where the last sits inside the session, which is what the Trend column
// in the mockup is for.
function dayBand(r: Row): number[] {
  const out = [r.dayLow, r.price, r.dayHigh].filter((v): v is number => v != null);
  return out.length === 3 ? out : [];
}

const fmtPrice = (v: number | null, decimals: number) =>
  v == null ? 'n/a' : v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtPct = (v: number | null | undefined) =>
  v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

const pctColor = (v: number | null | undefined) =>
  v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good;

const priceUnit = (r: Row) => (r.unit ? `${r.currency} ${r.unit}` : r.currency);

const rangeNote = (r: Row) =>
  r.yearLow == null || r.yearHigh == null
    ? ''
    : `52w ${fmtPrice(r.yearLow, r.decimals)} to ${fmtPrice(r.yearHigh, r.decimals)}`;

function nearestPoint(points: Obs[], t: number): Obs | null {
  let best: Obs | null = null;
  let gap = Infinity;
  for (const p of points) {
    const d = Math.abs(toTime(p.d) - t);
    if (d < gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}

// An intraday bar carries a time as well as a date, and "09-01T19:50:00" under
// a tick is unreadable. A window inside one day is labelled by the clock, a
// longer one by the day it fell on.
const tickLabel = (period: string, sameDay: boolean) =>
  period.includes('T') ? (sameDay ? period.slice(11, 16) : period.slice(5, 16).replace('T', ' ')) : period.slice(5);

// Short windows never cross a year boundary, so year ticks would print nothing.
// Fall back to evenly spaced dates off the actual bars.
function dateLabels(points: Obs[], x: (t: number) => number) {
  const years = yearTicks(toTime(points[0].d), toTime(points[points.length - 1].d));
  if (years.length >= 3) {
    return years.map((t) => ({ at: x(t), label: String(new Date(t).getUTCFullYear()) }));
  }
  const sameDay = points[0].d.slice(0, 10) === points[points.length - 1].d.slice(0, 10);
  const step = Math.max(1, Math.floor(points.length / 6));
  const out: { at: number; label: string }[] = [];
  for (let i = 0; i < points.length; i += step) {
    out.push({ at: x(toTime(points[i].d)), label: tickLabel(points[i].d, sameDay) });
  }
  return out;
}

// How far behind the clock this instrument's last print is. FMP delays some
// and not others, and the number is the point: gold and silver run about ten
// minutes back on this plan while the majors are seconds back, and wheat and
// corn are hours back whenever their pit is shut.
const minutesBehind = (r: Row) =>
  r.quotedAt == null ? null : Math.floor((Date.now() - Date.parse(r.quotedAt)) / 60_000);

function age(r: Row): string {
  const mins = minutesBehind(r);
  if (mins == null) return 'n/a';
  if (mins < 1) return 'now';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
}

function quoteAge(r: Row): string {
  const mins = minutesBehind(r);
  if (mins == null) return '';
  if (mins < 1) return ', quoted just now';
  return `, quoted ${mins} min ago`;
}

const barNote = (h: History) =>
  h.interval === 'daily' ? `${h.range} of daily closes` : `${h.range} at ${h.interval}`;

const S: Record<string, CSSProperties> = {
  grid: T.splitWide,
  groupHead: {
    fontSize: 10.5,
    letterSpacing: '.2px',
    color: COLOR.accent,
    padding: '13px 0 5px',
    borderBottom: `1px solid ${COLOR.hair}`,
  },
  tag: {
    fontSize: 9,
    color: COLOR.ca,
    marginLeft: 7,
    letterSpacing: '.2px',
  },
  age: {
    fontSize: 10.5,
    color: COLOR.dim,
    letterSpacing: '.2px',
    fontVariantNumeric: 'tabular-nums',
  },
  trendCell: { display: 'flex', justifyContent: 'flex-end' },
  chartFoot: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: `1px solid ${COLOR.hair}`,
    paddingTop: 10,
    marginTop: 6,
    fontSize: 11.5,
    color: COLOR.dim,
  },
};
