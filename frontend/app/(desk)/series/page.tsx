'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, PLOT, RADIUS, card } from '../../theme';
import { alignTickCount, niceScale, tickDigits } from '../../lib/scale';
import { getJson } from '../../lib/api';
import { svgToPng } from '../../lib/png';
import { breakCount } from '../../lib/gaps';
import { isoDate, nearest, toTime, yearsAgo, yearTicks, type Obs } from '../../lib/time';
import {
  Gridlines,
  HoverRule,
  XLabels,
  timeAt,
  plotW,
  plotH,
  type Frame,
} from '../../components/chart';
import SeriesLine from '../../components/SeriesLine';
import SeriesSearch from '../../components/SeriesSearch';

type Meta = {
  id: string;
  country: 'CA' | 'US';
  group: string;
  label: string;
  source: string;
  units: string;
  freq: string;
  updated: string | null;
};

type Series = {
  id: string;
  label: string;
  country: string;
  group: string;
  source: string;
  units: string;
  freq: string;
  observations: Obs[];
};

type Side = 'left' | 'right';

const MAX_SERIES = 5;

const SPANS: [string, number][] = [
  ['1Y', 1],
  ['5Y', 5],
  ['10Y', 10],
  ['25Y', 25],
];

const BASE_PAD = { top: 14, right: 16, bottom: 30, left: 56 };
// a second axis needs its own gutter, or its labels sit on top of the plot
const RIGHT_AXIS_PAD = 56;

export default function SeriesExplorerPage() {
  const [cat, setCat] = useState<Meta[]>([]);
  const [picked, setPicked] = useState<string[]>(['STATIC_TOTALCPICHANGE', 'LRUNTTTTCAM156S']);
  const [span, setSpan] = useState(10);
  const [mode, setMode] = useState<'level' | 'index'>('level');
  const [shape, setShape] = useState<'line' | 'bar'>('line');
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<'all' | 'CA' | 'US'>('all');
  const [group, setGroup] = useState('all');
  const [loaded, setLoaded] = useState<Series[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [sideOverride, setSideOverride] = useState<Record<string, Side>>({});
  const chartRef = useRef<SVGSVGElement | null>(null);

  // The last-print column is resolved server side one series at a time, so a
  // cold API answers with it still filling in. Ask again until it is done,
  // rather than showing a pending lookup as though the series had stopped.
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;

    const load = () => {
      getJson<{ series: Meta[]; resolving: boolean }>('/api/series/catalogue')
        .then((b) => {
          if (!live) return;
          setCat(b.series);
          setResolving(b.resolving);
          if (b.resolving) timer = setTimeout(load, 6000);
        })
        .catch((e) => live && setError(e.message));
    };

    load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  const start = yearsAgo(span);

  useEffect(() => {
    if (!picked.length) return;
    let live = true;
    getJson<{ series: Series[] }>(`/api/series?ids=${picked.join(',')}&start=${start}`)
      .then((b) => {
        if (!live) return;
        setError(null);
        setLoaded(b.series);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [picked, start]);

  // filtering the last response rather than blanking it drops a removed series
  // from the chart on the click, instead of on the refetch that follows
  const data = useMemo(() => loaded.filter((s) => picked.includes(s.id)), [loaded, picked]);

  // memoised so it keeps its identity between renders: the sections below are
  // built from it, and a fresh array on every mousemove rebuilt all 133
  // catalogue rows behind the hover rule
  const filtered = useMemo(
    () =>
      cat.filter(
        (s) =>
          (country === 'all' || s.country === country) &&
          (group === 'all' || s.group === group) &&
          (s.label + s.id + s.source + s.group).toLowerCase().includes(query.toLowerCase()),
      ),
    [cat, country, group, query],
  );

  // Group names repeat across the two countries, so a heading carries both. One
  // group can also arrive in more than one run, because CA Prices holds both the
  // Bank's y/y measures and the StatCan index, so rows are collected by heading
  // rather than by adjacency.
  const sections = useMemo(() => {
    const bySection = new Map<string, { country: string; group: string; rows: Meta[] }>();
    for (const s of filtered) {
      const key = `${s.country} ${s.group}`;
      const found = bySection.get(key);
      if (found) found.rows.push(s);
      else bySection.set(key, { country: s.country, group: s.group, rows: [s] });
    }
    return [...bySection].map(([key, v]) => ({ key, ...v }));
  }, [filtered]);

  const groups = useMemo(
    () => [
      ...new Set(cat.filter((s) => country === 'all' || s.country === country).map((s) => s.group)),
    ],
    [cat, country],
  );

  const units = useMemo(() => [...new Set(data.map((s) => s.units))], [data]);

  // Indexing rebases everything to 100, so there is one unit and one axis. In
  // levels, the first unit selected holds the left axis and anything measured
  // differently goes right, which is what a percent against a dollar figure
  // needs to be readable at all.
  const sideOf = useMemo(() => {
    const out: Record<string, Side> = {};
    for (const s of data) {
      out[s.id] =
        mode === 'index'
          ? 'left'
          : (sideOverride[s.id] ?? (s.units === units[0] ? 'left' : 'right'));
    }
    return out;
  }, [data, units, sideOverride, mode]);

  const scale = useMemo(() => {
    const withObs = data.filter((s) => s.observations.length);
    if (!withObs.length) return null;

    // each series keeps its own observation dates. Nothing is resampled or carried
    // forward onto another series' calendar, so a quarterly line stays quarterly.
    const rebase = (s: Series) => {
      if (mode === 'level') return s.observations;
      const base = s.observations[0].v;
      if (!base) return s.observations;
      return s.observations.map((o) => ({ d: o.d, v: (o.v / base) * 100 }));
    };

    const plotted = withObs.map((s) => ({ ...s, points: rebase(s), side: sideOf[s.id] }));
    const valuesOn = (side: Side) =>
      plotted.filter((s) => s.side === side).flatMap((s) => s.points.map((p) => p.v));

    const leftValues = valuesOn('left');
    const rightValues = valuesOn('right');
    // everything can end up on the right if the analyst flips them all over
    const primary = leftValues.length ? leftValues : rightValues;
    if (!primary.length) return null;

    const left = niceScale(Math.min(...primary), Math.max(...primary));
    const right =
      leftValues.length && rightValues.length
        ? niceScale(Math.min(...rightValues), Math.max(...rightValues))
        : null;
    if (right) alignTickCount(left, right);

    const frame: Frame = {
      w: 900,
      h: 320,
      pad: { ...BASE_PAD, right: right ? RIGHT_AXIS_PAD : BASE_PAD.right },
    };

    const times = plotted.flatMap((s) => s.points.map((p) => toTime(p.d)));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);

    const project = (side: Side) => {
      const a = right && side === 'right' ? right : left;
      return (v: number) => frame.pad.top + plotH(frame) * (1 - (v - a.lo) / (a.hi - a.lo));
    };

    // built once and handed out by side. Making one per call returned a new
    // function on every render, which is enough to defeat the memo on the
    // lines below and put every point back on the hover path.
    const axes = { left: project('left'), right: project('right') };

    return {
      frame,
      plotted,
      t0,
      t1,
      left,
      right,
      leftDigits: tickDigits(left.step ?? 1),
      rightDigits: right ? tickDigits(right.step ?? 1) : 0,
      leftUnits: [...new Set(plotted.filter((s) => s.side === 'left').map((s) => s.units))],
      rightUnits: [...new Set(plotted.filter((s) => s.side === 'right').map((s) => s.units))],
      x: (t: number) => frame.pad.left + (plotW(frame) * (t - t0)) / (t1 - t0 || 1),
      y: axes.left,
      yFor: (side: Side) => axes[side],
      years: yearTicks(t0, t1),
    };
  }, [data, mode, sideOf]);

  const toggle = (id: string) =>
    setPicked((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_SERIES ? p : [...p, id],
    );

  // stable, so the search panel is not rebuilt every time the hover rule moves
  const addFound = useCallback(
    (ref: string) =>
      setPicked((p) => (p.includes(ref) || p.length >= MAX_SERIES ? p : [...p, ref])),
    [],
  );

  const flipSide = (id: string) =>
    setSideOverride((s) => ({ ...s, [id]: sideOf[id] === 'left' ? 'right' : 'left' }));

  const savePng = () => {
    if (chartRef.current) {
      svgToPng(chartRef.current, `${picked.join('-') || 'series'}.png`, COLOR.bg, FONT.body);
    }
  };

  const wanted = detail ?? picked[0];
  const detailMeta =
    cat.find((s) => s.id === wanted) ??
    // a searched series is described by the response, not by the catalogue
    (() => {
      const f = data.find((s) => s.id === wanted);
      return f
        ? { id: f.id, country: f.country as 'CA' | 'US', group: f.group, label: f.label,
            source: f.source, units: f.units, freq: f.freq, updated: f.observations.at(-1)?.d ?? null }
        : undefined;
    })();

  const breaks = useMemo(
    () => (scale ? scale.plotted.reduce((n, s) => n + breakCount(s.points), 0) : 0),
    [scale],
  );

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>Series Explorer</h1>
        <p style={T.sub}>Bank of Canada, Statistics Canada and FRED, up to five series at once</p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search series"
          style={{ ...T.input, flex: '1 1 180px', minWidth: 0 }}
        />
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value as 'all' | 'CA' | 'US');
            setGroup('all');
          }}
          style={T.input}
        >
          <option value="all">Both countries</option>
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value)} style={T.input}>
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <span style={T.divider} />

        {SPANS.map(([label, years]) => (
          <button
            key={label}
            style={{ ...T.control, ...(span === years ? T.controlOn : {}) }}
            onClick={() => setSpan(years)}
          >
            {label}
          </button>
        ))}

        <span style={T.divider} />

        <button
          style={{ ...T.control, ...(mode === 'level' ? T.controlOn : {}) }}
          onClick={() => setMode('level')}
        >
          Level
        </button>
        <button
          style={{ ...T.control, ...(mode === 'index' ? T.controlOn : {}) }}
          onClick={() => setMode('index')}
        >
          Index
        </button>

        <span style={T.divider} />

        <button
          style={{ ...T.control, ...(shape === 'line' ? T.controlOn : {}) }}
          onClick={() => setShape('line')}
        >
          Line
        </button>
        <button
          style={{ ...T.control, ...(shape === 'bar' ? T.controlOn : {}) }}
          onClick={() => setShape('bar')}
        >
          Column
        </button>

        <div style={T.spacer} />
        <button style={{ ...T.control, ...(scale ? {} : T.controlOff) }} onClick={savePng}>
          PNG
        </button>
        <a
          style={{ ...T.control, ...T.controlPrimary, ...(picked.length ? {} : T.controlOff) }}
          href={`/api/series/csv?ids=${picked.join(',')}&start=${start}`}
        >
          CSV
        </a>
      </div>

      <div style={S.chips}>
        {picked.length === 0 && (
          <span style={{ fontSize: 12, color: COLOR.dim }}>No series selected</span>
        )}
        {picked.map((id, i) => {
          const meta = cat.find((s) => s.id === id);
          // a searched series has no catalogue row, so its name comes back with
          // the observations instead
          const found = data.find((s) => s.id === id);
          const side = sideOf[id];
          return (
            <span key={id} style={{ ...S.chip, borderColor: PLOT[i % PLOT.length] }}>
              <span style={{ ...S.swatch, background: PLOT[i % PLOT.length] }} />
              {meta ? `${meta.country} ${meta.label}` : (found?.label ?? id)}
              {/* which axis this series is read against, and a way to move it */}
              {side && mode === 'level' && (
                <button
                  style={S.axisPill}
                  onClick={() => flipSide(id)}
                  title={`Reading against the ${side} axis. Click to move it.`}
                >
                  {side === 'left' ? 'L' : 'R'}
                </button>
              )}
              <button style={S.chipX} onClick={() => toggle(id)} aria-label={`Remove ${id}`}>
                &times;
              </button>
            </span>
          );
        })}
      </div>

      <section style={{ ...card, marginBottom: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>
              {mode === 'index' ? 'Indexed to 100 at start of window' : 'Levels'}
            </h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              {axisNote(scale, units, mode)}
              {breaks > 0 && `. Line breaks at ${breaks} period${breaks > 1 ? 's' : ''} that did not print`}
            </p>
          </div>
          {hover != null && scale && (
            <div style={T.readout}>
              <b style={{ color: COLOR.ink }}>{isoDate(hover)}</b>
              {scale.plotted.map((s, i) => {
                const at = nearest(s.points, hover);
                return (
                  <span key={s.id} style={{ color: PLOT[i % PLOT.length] }}>
                    {at ? `${at.v.toFixed(2)} (${at.d})` : 'n/a'}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {!scale ? (
          <p style={{ fontSize: 12, color: COLOR.dim }}>
            {picked.length ? 'Loading' : 'Pick a series from the catalogue below'}
          </p>
        ) : (
          <svg
            ref={chartRef}
            viewBox={`0 0 ${scale.frame.w} ${scale.frame.h}`}
            style={{ width: '100%', height: 'auto' }}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => setHover(timeAt(e, scale.frame, scale.t0, scale.t1))}
          >
            <Gridlines
              frame={scale.frame}
              ticks={scale.left.ticks}
              y={scale.y}
              digits={scale.leftDigits}
            />

            {scale.right && (
              <RightAxis
                frame={scale.frame}
                ticks={scale.right.ticks}
                y={scale.yFor('right')}
                digits={scale.rightDigits}
              />
            )}

            <XLabels
              frame={scale.frame}
              items={scale.years.map((t) => ({
                at: scale.x(t),
                label: String(new Date(t).getUTCFullYear()),
              }))}
            />

            {scale.plotted.map((s, i) =>
              shape === 'line' ? (
                <SeriesLine
                  key={s.id}
                  points={s.points}
                  color={PLOT[i % PLOT.length]}
                  x={scale.x}
                  y={scale.yFor(s.side)}
                />
              ) : (
                <Columns
                  key={s.id}
                  points={s.points}
                  color={PLOT[i % PLOT.length]}
                  frame={scale.frame}
                  x={scale.x}
                  y={scale.yFor(s.side)}
                  axis={s.side === 'right' && scale.right ? scale.right : scale.left}
                  slot={i}
                  slots={scale.plotted.length}
                  widest={Math.max(...scale.plotted.map((p) => p.points.length))}
                />
              ),
            )}

            {hover != null && <HoverRule frame={scale.frame} x={scale.x(hover)} />}
          </svg>
        )}
      </section>

      <div style={S.grid}>
        <section style={card}>
          <h2 style={T.h2}>Catalogue</h2>
          <p style={T.desc}>
            {filtered.length} of {cat.length} series. Click to add or remove, five maximum.
            {resolving ? ' Last-print dates still resolving.' : ''}
          </p>
          {/* room for the scrollbar, it sits over the Last column otherwise */}
          <div style={{ maxHeight: 460, overflowY: 'auto', overflowX: 'auto', paddingRight: 10 }}>
            <table style={{ ...T.table, minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={S.stickyTh}>Series</th>
                  <th style={S.stickyTh}>Source</th>
                  <th style={S.stickyTh}>Frequency</th>
                  <th style={{ ...S.stickyTh, textAlign: 'right' }}>Last</th>
                </tr>
              </thead>
              {sections.map((sec) => (
                <tbody key={sec.key}>
                  <tr>
                    <td style={S.sectionHead} colSpan={4}>
                      {sec.country} {sec.group}
                    </td>
                  </tr>
                  {sec.rows.map((s) => {
                    const on = picked.includes(s.id);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => {
                          toggle(s.id);
                          setDetail(s.id);
                        }}
                        style={{
                          cursor: 'pointer',
                          background: on ? 'rgba(26,168,151,.10)' : 'transparent',
                        }}
                      >
                        <td style={{ ...T.td, color: on ? COLOR.ink : COLOR.dim }}>{s.label}</td>
                        <td style={{ ...T.td, color: COLOR.dim }}>{s.source}</td>
                        <td style={{ ...T.td, color: COLOR.dim }}>{s.freq}</td>
                        <td style={{ ...T.td, textAlign: 'right', color: COLOR.dim }}>
                          {s.updated ?? (resolving ? 'checking' : 'n/a')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
              {!filtered.length && (
                <tbody>
                  <tr>
                    <td style={{ ...T.td, color: COLOR.dim }} colSpan={4}>
                      {cat.length ? 'No series match that filter' : 'Loading catalogue'}
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </section>

        <section style={card}>
          <h2 style={T.h2}>Series detail</h2>
          <p style={T.desc}>{detailMeta ? detailMeta.label : 'No series selected'}</p>
          <table style={T.table}>
            <tbody>
              <Row label="Source identifier" value={detailMeta?.id} />
              <Row label="Provider" value={detailMeta?.source} />
              <Row label="Country" value={detailMeta?.country} />
              <Row label="Group" value={detailMeta?.group} />
              <Row label="Units" value={detailMeta?.units} />
              <Row label="Frequency" value={detailMeta?.freq} />
              <Row label="Last observation" value={detailMeta?.updated} />
              <Row
                label="Observations in window"
                value={data.find((s) => s.id === detailMeta?.id)?.observations.length}
              />
            </tbody>
          </table>
        </section>
      </div>

      <div style={{ marginTop: 16 }}>
        <SeriesSearch onAdd={addFound} picked={picked} full={picked.length >= MAX_SERIES} />
      </div>
    </main>
  );
}

// Says which axis carries what. Two units on one chart are unreadable if the
// reader cannot tell which scale a line belongs to.
function axisNote(
  scale: { leftUnits: string[]; rightUnits: string[]; right: unknown } | null,
  units: string[],
  mode: 'level' | 'index',
) {
  if (mode === 'index') return 'Rebased to 100, one axis';
  if (!scale) return units.join(', ') || 'n/a';
  if (!scale.right) return `Left axis: ${scale.leftUnits.join(', ') || 'n/a'}`;
  return `Left axis: ${scale.leftUnits.join(', ')}. Right axis: ${scale.rightUnits.join(', ')}`;
}

function RightAxis({
  frame,
  ticks,
  y,
  digits,
}: {
  frame: Frame;
  ticks: number[];
  y: (v: number) => number;
  digits: number;
}) {
  return (
    <>
      {ticks.map((t) => (
        <text
          key={t}
          x={frame.w - frame.pad.right + 8}
          y={y(t) + 4}
          fill={COLOR.dim}
          fontSize="10"
          textAnchor="start"
        >
          {t.toFixed(digits)}
        </text>
      ))}
    </>
  );
}

// Columns run from zero where the axis crosses it, so a deficit reads as a
// deficit rather than as a short bar standing on the floor of the chart.
// Memoised for the same reason SeriesLine is: one rect per print is thousands
// of elements, and moving the hover rule must not rebuild them.
const Columns = memo(function Columns({
  points,
  color,
  frame,
  x,
  y,
  axis,
  slot,
  slots,
  widest,
}: {
  points: Obs[];
  color: string;
  frame: Frame;
  x: (t: number) => number;
  y: (v: number) => number;
  axis: { lo: number; hi: number };
  slot: number;
  slots: number;
  widest: number;
}) {
  const band = plotW(frame) / Math.max(1, widest);
  const w = Math.max(0.6, (band / slots) * 0.82);
  const baseline = y(Math.min(Math.max(0, axis.lo), axis.hi));

  return (
    <>
      {points.map((p) => {
        const cx = x(toTime(p.d)) + (slot - (slots - 1) / 2) * w;
        const top = y(p.v);
        return (
          <rect
            key={p.d}
            x={cx - w / 2}
            y={Math.min(top, baseline)}
            width={w}
            height={Math.max(0.5, Math.abs(baseline - top))}
            fill={color}
            opacity={0.85}
          />
        );
      })}
    </>
  );
});

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <tr>
      <td style={{ ...T.td, color: COLOR.dim, width: '48%' }}>{label}</td>
      <td style={T.td}>{value == null || value === '' ? 'n/a' : value}</td>
    </tr>
  );
}

const S: Record<string, CSSProperties> = {
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, minHeight: 26 },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 12,
    padding: '4px 8px',
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderStyle: 'solid',
    color: COLOR.ink,
    background: COLOR.panel,
  },
  swatch: { width: 8, height: 2, display: 'inline-block' },
  axisPill: {
    fontFamily: FONT.body,
    fontSize: 9.5,
    lineHeight: 1,
    padding: '2px 5px',
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: COLOR.line,
    background: 'transparent',
    color: COLOR.dim,
    cursor: 'pointer',
  },
  chipX: {
    borderWidth: 0,
    borderStyle: 'solid',
    background: 'transparent',
    color: COLOR.dim,
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
  },
  grid: T.splitWide,
  // the catalogue scrolls now that it is 133 rows, so the header travels with it
  stickyTh: {
    ...T.th,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: COLOR.panel,
  },
  sectionHead: {
    fontSize: 10.5,
    letterSpacing: '.2px',
    color: COLOR.accent,
    padding: '14px 0 5px',
    borderBottom: `1px solid ${COLOR.hair}`,
  },
};
