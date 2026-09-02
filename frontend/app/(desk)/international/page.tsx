'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, PEER, card } from '../../theme';
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

type Area = { code: string; name: string; observations: Obs[] };

type MetricData = {
  metric: string;
  label: string;
  units: string;
  freq: string;
  areas: Area[];
  source: string;
};

type Cell = { value: number; period: string } | null;
type Row = { code: string; name: string; gdp: Cell; cpi: Cell; unemployment: Cell };

type Snapshot = {
  metrics: { key: string; label: string; units: string }[];
  rows: Row[];
  source: string;
};

const METRICS: [string, string][] = [
  ['gdp', 'Real GDP'],
  ['cpi', 'CPI'],
  ['unemployment', 'Unemployment'],
];

// Canada and the US carry the desk colours. The peers used to share one grey,
// which made a chart with four of them on it unreadable, so each now has its
// own hue from the peer set in theme.ts.
const AREA_COLOR: Record<string, string> = {
  CAN: COLOR.ca,
  USA: COLOR.us,
  OECD: COLOR.accent,
  GBR: PEER.violet,
  DEU: PEER.amber,
  FRA: PEER.blue,
  ITA: PEER.rose,
  JPN: PEER.green,
};

const DEFAULT_ON = ['CAN', 'USA', 'OECD'];

const FRAME: Frame = { w: 900, h: 300, pad: { top: 14, right: 16, bottom: 30, left: 46 } };

export default function InternationalPage() {
  const [metric, setMetric] = useState('gdp');
  const [loaded, setLoaded] = useState<MetricData | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [on, setOn] = useState<string[]>(DEFAULT_ON);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  // fixed at mount: staleness must not shift under a re-render
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    getJson<MetricData>(`/api/international?metric=${metric}`)
      .then((d) => {
        if (!live) return;
        setError(null);
        setLoaded(d);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [metric]);

  // the chart clears itself on a metric switch by ignoring the previous
  // response, rather than by blanking state from inside the effect
  const data = loaded?.metric === metric ? loaded : null;

  useEffect(() => {
    getJson<Snapshot>('/api/international/snapshot')
      .then(setSnap)
      .catch(() => setSnap(null));
  }, []);

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

  const metricLabel = METRICS.find(([k]) => k === metric)?.[1] ?? metric;

  const breaks = useMemo(
    () => (scale ? scale.shown.reduce((n, a) => n + breakCount(a.observations), 0) : 0),
    [scale],
  );

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>International</h1>
        <p style={T.sub}>Canada and the United States against G7 peers and the OECD total</p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        {METRICS.map(([key, label]) => (
          <button
            key={key}
            style={{ ...T.control, ...(metric === key ? T.controlOn : {}) }}
            onClick={() => setMetric(key)}
          >
            {label}
          </button>
        ))}

        <span style={T.divider} />

        {(data?.areas ?? []).map((a) => {
          const lit = on.includes(a.code);
          return (
            <button
              key={a.code}
              onClick={() => toggle(a.code)}
              style={{
                ...T.control,
                ...S.areaButton,
                ...(lit
                  ? { color: COLOR.ink, borderColor: AREA_COLOR[a.code], background: COLOR.panel2 }
                  : {}),
              }}
            >
              {/* the swatch stays on when the line is off, so the toggle still
                  says which colour it controls */}
              <span
                style={{
                  ...S.swatch,
                  background: AREA_COLOR[a.code],
                  opacity: lit ? 1 : 0.45,
                }}
              />
              {a.name}
            </button>
          );
        })}

        <div style={T.spacer} />
        <button
          style={T.control}
          onClick={() =>
            chartRef.current &&
            svgToPng(chartRef.current, `international-${metric}.png`, COLOR.bg, FONT.body)
          }
        >
          PNG
        </button>
        <a
          style={{ ...T.control, ...T.controlPrimary }}
          href={`/api/international/csv?metric=${metric}`}
        >
          CSV
        </a>
      </div>

      <section style={{ ...card, marginBottom: 16 }}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>{data ? data.label : metricLabel}</h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              {data ? `${data.units}, ${data.freq.toLowerCase()}. ${data.source}` : 'Loading'}
              {breaks > 0 && `. ${breaks} break${breaks > 1 ? 's' : ''} where a period did not print`}
            </p>
          </div>
          {hover != null && scale && (
            <div style={T.readout}>
              <b style={{ color: COLOR.ink }}>{new Date(hover).toISOString().slice(0, 7)}</b>
              {scale.shown.map((a) => {
                const at = nearest(a.observations, hover);
                return (
                  <span key={a.code} style={{ color: AREA_COLOR[a.code] }}>
                    {a.code} {at ? at.v.toFixed(1) : 'n/a'}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {!scale ? (
          <p style={{ fontSize: 12, color: COLOR.dim }}>
            {data ? 'No countries selected' : 'Loading'}
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
                color={AREA_COLOR[a.code]}
                x={scale.x}
                y={scale.y}
                width={DEFAULT_ON.includes(a.code) ? 2 : 1.5}
                dash={a.code === 'OECD' ? '5 3' : undefined}
              />
            ))}

            {hover != null && <HoverRule frame={FRAME} x={scale.x(hover)} />}
          </svg>
        )}
      </section>

      <section style={card}>
        <h2 style={T.h2}>Peer snapshot</h2>
        <p style={T.desc}>
          Each country&apos;s latest figure, with the period beside it since countries
          report on different dates.
        </p>
        <table style={T.table}>
          <thead>
            <tr>
              <th style={T.th}>Country</th>
              {(snap?.metrics ?? []).map((m) => (
                <th key={m.key} style={{ ...T.th, textAlign: 'right' }}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(snap?.rows ?? []).map((r) => (
              <tr key={r.code}>
                <td style={{ ...T.td, color: DEFAULT_ON.includes(r.code) ? COLOR.ink : COLOR.dim }}>
                  <span style={{ ...S.swatch, background: AREA_COLOR[r.code], marginRight: 8 }} />
                  {r.name}
                </td>
                {(snap?.metrics ?? []).map((m) => (
                  <Value key={m.key} cell={r[m.key as 'gdp' | 'cpi' | 'unemployment']} now={now} />
                ))}
              </tr>
            ))}
            {!snap && (
              <tr>
                <td style={{ ...T.td, color: COLOR.dim }} colSpan={4}>
                  Loading
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

// A period more than a year behind is a series that has stopped, not a fresh print.
// Flagging it beats letting a 2021 figure sit in the table looking current.
const STALE_MS = 400 * 864e5;

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
  areaButton: { display: 'inline-flex', alignItems: 'center', gap: 7 },
  swatch: { width: 9, height: 2, display: 'inline-block', flexShrink: 0 },
};
