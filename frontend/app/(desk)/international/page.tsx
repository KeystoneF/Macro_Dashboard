'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, PEER, PLOT, RADIUS, card } from '../../theme';
import { niceScale, tickDigits } from '../../lib/scale';
import { getJson } from '../../lib/api';
import { svgToPng } from '../../lib/png';
import { breakCount } from '../../lib/gaps';
import { toTime, nearest, yearTicks, type Obs } from '../../lib/time';
import {
  Gridlines,
  HoverRule,
  XLabels,
  ZeroRule,
  timeAt,
  plotW,
  plotH,
  type Frame,
} from '../../components/chart';
import SeriesLine from '../../components/SeriesLine';
import OecdSearch, { measureId, type Measure } from '../../components/OecdSearch';

type Area = { code: string; name: string; observations: Obs[] };

type MeasureData = {
  metric: string;
  flow?: string;
  key?: string;
  label: string;
  units: string | null;
  freq: string | null;
  selection?: { dim: string; value: string }[];
  mixedUnits?: string[] | null;
  areas: Area[];
  source: string;
  start: string;
};

type Cell = { value: number; period: string } | null;
type Row = {
  code: string;
  name: string;
  grouping: boolean;
  gdp: Cell;
  cpi: Cell;
  unemployment: Cell;
};

type MetricKey = 'gdp' | 'cpi' | 'unemployment';

type Snapshot = {
  metrics: { key: MetricKey; label: string; units: string }[];
  rows: Row[];
  source: string;
};

const METRICS: [MetricKey, string][] = [
  ['gdp', 'Real GDP'],
  ['cpi', 'CPI'],
  ['unemployment', 'Unemployment'],
];

// Canada, the United States and the OECD total hold the desk colours wherever
// they appear. Every other country takes the next free colour from the peer
// set, and the five G7 peers keep the hues they have always had.
const ANCHOR: Record<string, string> = {
  CAN: COLOR.ca,
  USA: COLOR.us,
  OECD: COLOR.accent,
};

const PREFERRED: Record<string, string> = {
  GBR: PEER.violet,
  DEU: PEER.amber,
  FRA: PEER.blue,
  ITA: PEER.rose,
  JPN: PEER.green,
};

const POOL = [PEER.violet, PEER.amber, PEER.blue, PEER.rose, PEER.green, PLOT[3], PLOT[4]];

const G7_PEERS = ['GBR', 'DEU', 'FRA', 'ITA', 'JPN'];
const DEFAULT_ON = ['CAN', 'USA', 'OECD'];

const FRAME: Frame = { w: 900, h: 300, pad: { top: 14, right: 16, bottom: 30, left: 46 } };

// A period more than a year behind is a series that has stopped, not a fresh
// print. Japan's CPI in this dataset stops in 2021 while every peer is current.
const STALE_MS = 400 * 864e5;

// Which measure a response answered for. The api names a searched one `found`.
const idOf = (d: MeasureData) =>
  d.metric === 'found' ? measureId(d.flow ?? '', d.key ?? '') : d.metric;

export default function InternationalPage() {
  const [metric, setMetric] = useState<MetricKey>('gdp');
  const [found, setFound] = useState<Measure | null>(null);
  const [loaded, setLoaded] = useState<MeasureData | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [on, setOn] = useState<string[]>(DEFAULT_ON);
  const [sortBy, setSortBy] = useState<MetricKey>('gdp');
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  // fixed at mount: staleness must not shift under a re-render
  const [now] = useState(() => Date.now());

  // what the chart is asking for, and what its export links repeat
  const query = found
    ? `flow=${encodeURIComponent(found.flow)}&key=${encodeURIComponent(found.key)}`
    : `metric=${metric}`;
  const wanted = found ? measureId(found.flow, found.key) : metric;

  useEffect(() => {
    let live = true;
    getJson<MeasureData>(`/api/international?${query}`)
      .then((d) => {
        if (!live) return;
        setError(null);
        setLoaded(d);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [query]);

  // The chart clears itself on a switch by ignoring the previous response,
  // rather than by blanking state from inside the effect. `metric` names which
  // one answered: a curated measure carries its own name and a searched one
  // carries `found`. Both carry flow and key, so reading those to decide would
  // never match a curated measure and the chart would load forever.
  const data = loaded && idOf(loaded) === wanted ? loaded : null;

  useEffect(() => {
    getJson<Snapshot>('/api/international/snapshot')
      .then(setSnap)
      .catch(() => setSnap(null));
  }, []);

  // Assigned in the order countries were lit, so a line keeps its colour while
  // it is on the chart. The anchors are never in the pool.
  const colour = useMemo(() => {
    const out: Record<string, string> = {};
    const taken = new Set<string>();

    for (const code of on) if (ANCHOR[code]) out[code] = ANCHOR[code];
    for (const code of on) {
      const want = PREFERRED[code];
      if (out[code] || !want || taken.has(want)) continue;
      out[code] = want;
      taken.add(want);
    }
    for (const code of on) {
      if (out[code]) continue;
      const free = POOL.find((c) => !taken.has(c));
      if (!free) continue;
      out[code] = free;
      taken.add(free);
    }
    return out;
  }, [on]);

  const full = on.filter((code) => !ANCHOR[code]).length >= POOL.length;

  const scale = useMemo(() => {
    if (!data) return null;
    const shown = data.areas.filter((a) => on.includes(a.code) && a.observations.length);
    if (!shown.length) return null;

    const values = shown.flatMap((a) => a.observations.map((o) => o.v));
    const times = shown.flatMap((a) => a.observations.map((o) => toTime(o.d)));

    const { lo, hi, ticks, step } = niceScale(Math.min(...values), Math.max(...values));
    const t0 = Math.min(...times);
    const t1 = Math.max(...times);

    return {
      shown,
      t0,
      t1,
      lo,
      hi,
      ticks,
      digits: tickDigits(step ?? 1),
      x: (t: number) => FRAME.pad.left + (plotW(FRAME) * (t - t0)) / (t1 - t0 || 1),
      y: (v: number) => FRAME.pad.top + plotH(FRAME) * (1 - (v - lo) / (hi - lo)),
      years: yearTicks(t0, t1),
    };
  }, [data, on]);

  const toggle = (code: string) =>
    setOn((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

  const add = (code: string) => setOn((s) => (s.includes(code) || !code ? s : [...s, code]));

  const show = useCallback((m: Measure) => {
    setFound(m);
    setHover(null);
  }, []);

  const breaks = useMemo(
    () => (scale ? scale.shown.reduce((n, a) => n + breakCount(a.observations), 0) : 0),
    [scale],
  );

  // Every country the dataset holds, minus the ones already on the chart. The
  // groupings OECD publishes alongside them, EA20 and G7 and the rest, are
  // series in their own right and stay in the list.
  const addable = useMemo(
    () =>
      (data?.areas ?? [])
        .filter((a) => !on.includes(a.code) && a.observations.length)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, on],
  );

  const ranked = useMemo(() => rankRows(snap, sortBy), [snap, sortBy]);

  const fileName = found ? found.flow.split(',')[1] : metric;

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>International</h1>
        <p style={T.sub}>
          Canada and the United States against every country the OECD publishes
        </p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        {METRICS.map(([key, label]) => (
          <button
            key={key}
            style={{ ...T.control, ...(!found && metric === key ? T.controlOn : {}) }}
            onClick={() => {
              setMetric(key);
              setSortBy(key);
              setFound(null);
            }}
          >
            {label}
          </button>
        ))}

        {found && (
          <span style={{ ...S.chip, borderColor: COLOR.accent }}>
            {found.name}
            <button style={S.chipX} onClick={() => setFound(null)} aria-label="Back to the three">
              &times;
            </button>
          </span>
        )}

        <div style={T.spacer} />
        <button
          style={T.control}
          onClick={() =>
            chartRef.current &&
            svgToPng(chartRef.current, `international-${fileName}.png`, COLOR.bg, FONT.body)
          }
        >
          PNG
        </button>
        <a style={{ ...T.control, ...T.controlPrimary }} href={`/api/international/csv?${query}`}>
          CSV
        </a>
      </div>

      <div style={T.controls}>
        {on.map((code) => {
          const area = data?.areas.find((a) => a.code === code);
          const lit = colour[code];
          return (
            <span
              key={code}
              style={{ ...S.chip, borderColor: lit ?? COLOR.line, opacity: area ? 1 : 0.5 }}
            >
              <span style={{ ...S.swatch, background: lit ?? COLOR.line }} />
              {area ? area.name : code}
              {/* a country the measure does not cover keeps its chip and says
                  so, rather than disappearing when the measure changes */}
              {data && !area && <span style={S.noData}>no data</span>}
              <button style={S.chipX} onClick={() => toggle(code)} aria-label={`Remove ${code}`}>
                &times;
              </button>
            </span>
          );
        })}

        <select
          value=""
          onChange={(e) => add(e.target.value)}
          style={{ ...T.input, ...(full ? T.controlOff : {}) }}
          title={full ? 'Seven peers at a time, so every line keeps its own colour' : undefined}
        >
          <option value="">Add a country</option>
          {addable.map((a) => (
            <option key={a.code} value={a.code}>
              {a.name}
            </option>
          ))}
        </select>

        <button
          style={{ ...T.control, ...(full ? T.controlOff : {}) }}
          onClick={() => setOn((s) => [...s, ...G7_PEERS.filter((c) => !s.includes(c))])}
        >
          Add G7
        </button>
      </div>

      <section style={{ ...card, marginBottom: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>{data ? data.label : 'Loading'}</h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              {data ? measureNote(data) : 'Loading'}
              {breaks > 0 &&
                `. ${breaks} break${breaks > 1 ? 's' : ''} where a period did not print`}
            </p>
            {data?.mixedUnits && (
              // countries reporting in their own units are not one comparison,
              // whatever the chart makes it look like
              <p style={{ ...T.desc, marginBottom: 0, color: COLOR.ca }}>
                Countries report this in different units: {data.mixedUnits.join(', ')}
              </p>
            )}
          </div>
          {hover != null && scale && (
            <div style={T.readout}>
              <b style={{ color: COLOR.ink }}>{new Date(hover).toISOString().slice(0, 7)}</b>
              {scale.shown.map((a) => {
                const at = nearest(a.observations, hover);
                return (
                  <span key={a.code} style={{ color: colour[a.code] }}>
                    {a.code} {at ? at.v.toFixed(1) : 'n/a'}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {!scale ? (
          <p style={S.quiet}>{data ? 'No countries selected' : 'Loading'}</p>
        ) : (
          <svg
            ref={chartRef}
            viewBox={`0 0 ${FRAME.w} ${FRAME.h}`}
            style={{ width: '100%', height: 'auto' }}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => setHover(timeAt(e, FRAME, scale.t0, scale.t1))}
          >
            <Gridlines frame={FRAME} ticks={scale.ticks} y={scale.y} digits={scale.digits} />

            {scale.lo < 0 && scale.hi > 0 && <ZeroRule frame={FRAME} y={scale.y(0)} />}

            <XLabels
              frame={FRAME}
              items={scale.years.map((t) => ({
                at: scale.x(t),
                label: String(new Date(t).getUTCFullYear()),
              }))}
            />

            {scale.shown.map((a) => (
              <SeriesLine
                key={a.code}
                points={a.observations}
                color={colour[a.code]}
                x={scale.x}
                y={scale.y}
                width={ANCHOR[a.code] ? 2 : 1.5}
                dash={a.code === 'OECD' ? '5 3' : undefined}
              />
            ))}

            {hover != null && <HoverRule frame={FRAME} x={scale.x(hover)} />}
          </svg>
        )}
      </section>

      <section style={{ ...card, marginBottom: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>Peer snapshot</h2>
          </div>
          <span style={{ fontSize: 11, color: COLOR.dim }}>
            {snap ? `${snap.rows.filter((r) => !r.grouping).length} countries` : ''}
          </span>
        </div>

        <div style={{ maxHeight: 420, overflowY: 'auto', ...T.scrollX }}>
          <table style={{ ...T.table, minWidth: 460 }}>
            <thead>
              <tr>
                <th style={{ ...S.stickyTh, width: 38 }}>#</th>
                <th style={S.stickyTh}>Country</th>
                {(snap?.metrics ?? []).map((m) => (
                  <th
                    key={m.key}
                    style={{
                      ...S.stickyTh,
                      textAlign: 'right',
                      cursor: 'pointer',
                      color: sortBy === m.key ? COLOR.accent : COLOR.dim,
                    }}
                    onClick={() => setSortBy(m.key)}
                  >
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.code}>
                  {/* a grouping is not a country and takes no rank, which is
                      what the mockup's n/a rank row was saying */}
                  <td style={{ ...T.td, color: COLOR.dim }}>{r.rank ?? 'n/a'}</td>
                  <td style={{ ...T.td, color: on.includes(r.code) ? COLOR.ink : COLOR.dim }}>
                    {colour[r.code] && (
                      <span style={{ ...S.swatch, background: colour[r.code], marginRight: 8 }} />
                    )}
                    {r.name}
                  </td>
                  {(snap?.metrics ?? []).map((m) => (
                    <Value key={m.key} cell={r[m.key]} now={now} />
                  ))}
                </tr>
              ))}
              {!snap && (
                <tr>
                  <td style={{ ...T.td, color: COLOR.dim }} colSpan={5}>
                    Loading
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <OecdSearch onShow={show} current={found ? measureId(found.flow, found.key) : null} />
    </main>
  );
}

// Countries first and ranked on the chosen measure, groupings after them with no
// rank, anything that did not report at the bottom of its own half.
function rankRows(snap: Snapshot | null, sortBy: MetricKey): (Row & { rank: number | null })[] {
  if (!snap) return [];

  const value = (r: Row) => r[sortBy]?.value ?? null;
  const order = (a: Row, b: Row) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  };

  const countries = snap.rows.filter((r) => !r.grouping).sort(order);
  const groupings = snap.rows.filter((r) => r.grouping).sort(order);

  return [
    ...countries.map((r, i) => ({ ...r, rank: value(r) == null ? null : i + 1 })),
    ...groupings.map((r) => ({ ...r, rank: null })),
  ];
}

function measureNote(data: MeasureData) {
  const parts = [data.units, data.freq ? data.freq.toLowerCase() : null].filter(Boolean);
  const picked = (data.selection ?? []).map((s) => s.value).join(', ');
  return [parts.join(', '), picked, data.source].filter(Boolean).join('. ');
}

function Value({ cell, now }: { cell: Cell; now: number }) {
  if (!cell) return <td style={{ ...T.td, textAlign: 'right', color: COLOR.dim }}>n/a</td>;
  const stale = now - toTime(cell.period) > STALE_MS;
  return (
    <td style={{ ...T.td, textAlign: 'right' }}>
      <span style={{ color: stale ? COLOR.dim : COLOR.ink }}>{cell.value.toFixed(1)}</span>
      <span style={{ color: stale ? COLOR.bad : COLOR.dim, fontSize: 11, marginLeft: 7 }}>
        {cell.period}
      </span>
    </td>
  );
}

const S: Record<string, CSSProperties> = {
  quiet: { fontSize: 12, color: COLOR.dim },
  swatch: { width: 9, height: 2, display: 'inline-block', flexShrink: 0 },
  noData: { fontSize: 10, color: COLOR.dim },
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
  stickyTh: { ...T.th, position: 'sticky', top: 0, zIndex: 1, background: COLOR.panel },
};
