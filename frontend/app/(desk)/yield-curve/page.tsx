'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, card } from '../../theme';
import { niceScale, tickDigits } from '../../lib/scale';
import { getJson } from '../../lib/api';
import { svgToPng } from '../../lib/png';
import { isoAgo, startOfYear } from '../../lib/time';
import { Gridlines, HoverRule, XLabels, plotW, plotH, type Frame } from '../../components/chart';

type Point = {
  key: string;
  months: number;
  ca: number | null;
  us: number | null;
  caNote: string | null;
};

type Spreads = Record<string, number | null>;

type Yields = {
  asOf: { caBonds: string | null; caBills: string | null; us: string | null };
  points: Point[];
  spreads: { ca: Spreads; us: Spreads };
  sources: { ca: string; us: string };
};

const PRESETS: [string, string][] = [
  ['1M', isoAgo(30)],
  ['3M', isoAgo(91)],
  ['YTD', startOfYear()],
  ['1Y', isoAgo(365)],
  ['5Y', isoAgo(1826)],
];

const FRAME: Frame = { w: 900, h: 340, pad: { top: 16, right: 20, bottom: 36, left: 42 } };

// Half the gap between two maturities, so the hit strips tile the plot exactly.
const HIT_HALF_WIDTH = 22;

type Stroke = { x1: number; y1: number; x2: number; y2: number; bridged: boolean };

export default function YieldCurvePage() {
  const [data, setData] = useState<Yields | null>(null);
  const [loadedPrior, setLoadedPrior] = useState<{ date: string; curve: Yields } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState({ ca: true, us: true, compare: true });
  const [hover, setHover] = useState<number | null>(null);
  const [compareDate, setCompareDate] = useState(startOfYear());
  const chartRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    getJson<Yields>('/api/yields')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  // comparison curve is a second call to the same endpoint with ?date=,
  // so no extra backend surface is needed for it
  useEffect(() => {
    let live = true;
    getJson<Yields>(`/api/yields?date=${compareDate}`)
      .then((d) => live && setLoadedPrior({ date: compareDate, curve: d }))
      .catch(() => live && setLoadedPrior(null));
    return () => {
      live = false;
    };
  }, [compareDate]);

  // tagging the response with the date it was asked for lets a date change drop
  // the old curve on render, rather than by blanking state from inside the effect
  const prior = loadedPrior?.date === compareDate ? loadedPrior.curve : null;

  const scale = useMemo(() => {
    if (!data) return null;

    const sets: Yields[] = [data, ...(show.compare && prior ? [prior] : [])];
    const values = sets.flatMap((d) =>
      d.points.flatMap((p) =>
        [show.ca ? p.ca : null, show.us ? p.us : null].filter((v): v is number => v != null),
      ),
    );
    if (!values.length) return null;

    const { lo, hi, ticks, step } = niceScale(Math.min(...values), Math.max(...values));
    const n = data.points.length;

    return {
      ticks,
      digits: tickDigits(step ?? 0.25),
      // maturities are plotted evenly rather than by actual months, which is the
      // convention on every trading desk curve and keeps the short end readable
      x: (i: number) => FRAME.pad.left + (plotW(FRAME) * i) / (n - 1),
      y: (v: number) => FRAME.pad.top + plotH(FRAME) * (1 - (v - lo) / (hi - lo)),
    };
  }, [data, prior, show]);

  // Two different reasons a maturity has no value, and they must not look alike.
  // Canada issues nothing at 1M or 20Y, so the curve has no node there and the
  // span is drawn dashed: stepping over a rung is not the same as inventing a
  // yield for it, and no number is ever shown at that maturity. A series that
  // does exist but did not print is a real hole and still breaks the line.
  const strokes = (field: 'ca' | 'us', src: Yields | null = data): Stroke[] => {
    if (!src || !scale) return [];
    const out: Stroke[] = [];
    let prev: { i: number; v: number } | null = null;
    let bridged = false;

    src.points.forEach((p, i) => {
      const v = p[field];
      if (v != null) {
        if (prev) {
          out.push({
            x1: scale.x(prev.i),
            y1: scale.y(prev.v),
            x2: scale.x(i),
            y2: scale.y(v),
            bridged,
          });
        }
        prev = { i, v };
        bridged = false;
        return;
      }
      if (field === 'ca' && p.caNote) {
        bridged = true;
        return;
      }
      prev = null;
      bridged = false;
    });
    return out;
  };

  if (error) {
    return (
      <main className="desk-page" style={T.page}>
        <Header />
        <div style={{ ...card, color: COLOR.bad, maxWidth: 560 }}>
          Could not load yields: {error}
          {error.includes('FRED') && (
            <div style={{ color: COLOR.dim, marginTop: 8, fontSize: 12 }}>
              Add FRED_API_KEY to backend/.env and restart the API.
            </div>
          )}
        </div>
      </main>
    );
  }

  if (!data || !scale) {
    return (
      <main className="desk-page" style={T.page}>
        <Header />
        <div style={{ ...card, color: COLOR.dim, maxWidth: 560 }}>Loading</div>
      </main>
    );
  }

  const asOf = [
    data.asOf.caBonds && `CA bonds ${data.asOf.caBonds}`,
    data.asOf.caBills && `bills ${data.asOf.caBills}`,
    data.asOf.us && `US ${data.asOf.us}`,
  ]
    .filter(Boolean)
    .join(', ');

  const priorLabel = prior ? (prior.asOf.us ?? compareDate) : compareDate;

  return (
    <main className="desk-page" style={T.page}>
      <Header />

      <div style={{ ...T.controls, marginBottom: 16 }}>
        <button
          style={{ ...T.control, ...(show.ca ? S.onCa : {}) }}
          onClick={() => setShow((s) => ({ ...s, ca: !s.ca }))}
        >
          Canada
        </button>
        <button
          style={{ ...T.control, ...(show.us ? S.onUs : {}) }}
          onClick={() => setShow((s) => ({ ...s, us: !s.us }))}
        >
          United States
        </button>
        <span style={T.divider} />
        <button
          style={{ ...T.control, ...(show.compare ? T.controlOn : {}) }}
          onClick={() => setShow((s) => ({ ...s, compare: !s.compare }))}
        >
          Compare
        </button>

        {show.compare && (
          <>
            {PRESETS.map(([label, date]) => (
              <button
                key={label}
                style={{ ...T.control, ...(compareDate === date ? T.controlOn : {}) }}
                onClick={() => setCompareDate(date)}
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={compareDate}
              max={isoAgo(1)}
              onChange={(e) => setCompareDate(e.target.value)}
              style={T.input}
            />
          </>
        )}

        <div style={T.spacer} />
        <button
          style={T.control}
          onClick={() =>
            chartRef.current &&
            svgToPng(chartRef.current, 'yield-curve.png', COLOR.bg, FONT.body)
          }
        >
          PNG
        </button>
        <a style={{ ...T.control, ...T.controlPrimary }} href="/api/yields/csv">
          CSV
        </a>
      </div>

      <div style={S.grid}>
        <div style={S.col}>
          <section style={card}>
            <div style={{ ...T.cardHead, marginBottom: 12 }}>
              <div>
                <h2 style={T.h2}>Current curve</h2>
                <p style={{ ...T.desc, marginBottom: 0 }}>{asOf || 'n/a'}</p>
              </div>
              <div style={S.legend}>
                <Key color={COLOR.ca} label="CA" />
                <Key color={COLOR.us} label="US" />
                {show.compare && (
                  <span style={S.legendItem}>
                    <svg width="16" height="8">
                      <line
                        x1="0"
                        y1="4"
                        x2="16"
                        y2="4"
                        stroke={COLOR.dim}
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                    </svg>
                    {prior ? priorLabel : 'loading'}
                  </span>
                )}
              </div>
            </div>

            <svg
              ref={chartRef}
              viewBox={`0 0 ${FRAME.w} ${FRAME.h}`}
              style={{ width: '100%', height: 'auto' }}
            >
              <Gridlines frame={FRAME} ticks={scale.ticks} y={scale.y} digits={scale.digits} />

              <XLabels
                frame={FRAME}
                offset={14}
                items={data.points.map((p, i) => ({ at: scale.x(i), label: p.key }))}
              />

              {show.compare && prior && show.us && (
                <Line strokes={strokes('us', prior)} color={COLOR.us} prior />
              )}
              {show.compare && prior && show.ca && (
                <Line strokes={strokes('ca', prior)} color={COLOR.ca} prior />
              )}

              {show.us && <Line strokes={strokes('us')} color={COLOR.us} />}
              {show.ca && <Line strokes={strokes('ca')} color={COLOR.ca} />}

              {data.points.map((p, i) => (
                <g key={p.key}>
                  {show.us && p.us != null && (
                    <circle
                      cx={scale.x(i)}
                      cy={scale.y(p.us)}
                      r="3"
                      fill={COLOR.bg}
                      stroke={COLOR.us}
                      strokeWidth="1.8"
                    />
                  )}
                  {show.ca && p.ca != null && (
                    <circle
                      cx={scale.x(i)}
                      cy={scale.y(p.ca)}
                      r="3"
                      fill={COLOR.bg}
                      stroke={COLOR.ca}
                      strokeWidth="1.8"
                    />
                  )}
                  {/* invisible hit strip, much easier to hover than a 3px dot */}
                  <rect
                    x={scale.x(i) - HIT_HALF_WIDTH}
                    y={FRAME.pad.top}
                    width={HIT_HALF_WIDTH * 2}
                    height={plotH(FRAME)}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                  {hover === i && <HoverRule frame={FRAME} x={scale.x(i)} />}
                </g>
              ))}
            </svg>

            <div style={S.readout}>
              {hover != null ? (
                <>
                  <b style={{ color: COLOR.ink }}>{data.points[hover].key}</b>
                  <span style={{ color: COLOR.ca }}>CA {fmt(data.points[hover].ca)}</span>
                  <span style={{ color: COLOR.us }}>US {fmt(data.points[hover].us)}</span>
                  {show.compare && prior && (
                    <span>
                      prior CA {fmt(prior.points[hover]?.ca)}, US {fmt(prior.points[hover]?.us)}
                    </span>
                  )}
                  {data.points[hover].caNote && <span>{data.points[hover].caNote}</span>}
                </>
              ) : (
                <span>Hover for values</span>
              )}
            </div>
          </section>
        </div>

        <div style={S.col}>
          <section style={card}>
            <h2 style={T.h2}>Spreads</h2>
            <p style={T.desc}>Basis points</p>
            <table style={T.table}>
              <thead>
                <tr>
                  <th style={T.th}>Pair</th>
                  <th style={{ ...T.th, textAlign: 'right' }}>CA</th>
                  <th style={{ ...T.th, textAlign: 'right' }}>US</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(data.spreads.us).map((k) => (
                  <tr key={k}>
                    <td style={T.td}>{k}</td>
                    <Bps v={data.spreads.ca[k]} />
                    <Bps v={data.spreads.us[k]} />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {show.compare && (
            <section style={card}>
              <h2 style={T.h2}>Change</h2>
              <p style={T.desc}>Basis points vs {priorLabel}</p>
              <table style={T.table}>
                <thead>
                  <tr>
                    <th style={T.th}>Term</th>
                    <th style={{ ...T.th, textAlign: 'right' }}>CA</th>
                    <th style={{ ...T.th, textAlign: 'right' }}>US</th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p, i) => (
                    <tr key={p.key}>
                      <td style={T.td}>{p.key}</td>
                      <Bps v={change(p.ca, prior?.points[i]?.ca)} />
                      <Bps v={change(p.us, prior?.points[i]?.us)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

const fmt = (v: number | null | undefined) => (v == null ? 'n/a' : v.toFixed(2));

const change = (now: number | null, then: number | null | undefined) =>
  now == null || then == null ? null : Math.round((now - then) * 100);

function Line({ strokes, color, prior }: { strokes: Stroke[]; color: string; prior?: boolean }) {
  return (
    <>
      {strokes.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={color}
          strokeWidth={prior ? 1.4 : 2.1}
          opacity={prior ? 0.5 : s.bridged ? 0.75 : 1}
          strokeDasharray={prior ? '4 3' : s.bridged ? '5 4' : undefined}
        />
      ))}
    </>
  );
}

function Bps({ v }: { v: number | null }) {
  // inverted spreads and direction of travel are the point of these tables
  const color = v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good;
  return (
    <td style={{ ...T.td, textAlign: 'right', color }}>
      {v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v}`}
    </td>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span style={S.legendItem}>
      <span style={{ width: 10, height: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

function Header() {
  return (
    <header style={{ marginBottom: 16 }}>
      <h1 style={T.wordmark}>Yield Curve</h1>
      <p style={T.sub}>Canada and United States, 1M to 30Y</p>
    </header>
  );
}

const S: Record<string, CSSProperties> = {
  onCa: { color: COLOR.ca, borderColor: COLOR.ca, background: 'rgba(232,130,94,.13)' },
  onUs: { color: COLOR.us, borderColor: COLOR.us, background: 'rgba(91,192,176,.13)' },
  grid: { ...T.splitWide, alignItems: 'start' },
  col: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 },
  legend: { display: 'flex', gap: 14, fontSize: 11.5, color: COLOR.dim, flexShrink: 0 },
  legendItem: { display: 'flex', alignItems: 'center', gap: 5 },
  readout: {
    display: 'flex',
    gap: 16,
    fontSize: 12,
    color: COLOR.dim,
    borderTop: `1px solid ${COLOR.hair}`,
    paddingTop: 10,
    marginTop: 4,
    minHeight: 18,
  },
};
