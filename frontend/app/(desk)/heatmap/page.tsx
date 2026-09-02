'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties, Ref } from 'react';
import * as T from '../../theme';
import { COLOR, FONT, card } from '../../theme';
import { getJson } from '../../lib/api';
import { svgToPng } from '../../lib/png';
import { squarify, type Tile } from '../../lib/treemap';

type HeatTile = {
  // the identifier a lookup needs, and the one to put on a tile: on the TSX
  // board they differ by the .TO suffix that every name there carries
  symbol: string;
  ticker: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number | null;
  changePct: Record<string, number | null>;
};

type Heatmap = {
  tiles: HeatTile[];
  universe: string;
  currency: string;
  listed: number;
  drawn: number;
  // holdings the index funds list that are not constituents: cash, collateral
  // and an index future. Named rather than counted, so the gap is checkable.
  skipped: string[];
  asOf: string;
};

// Two indexes, and they are not quoted in the same currency, so the label on a
// market cap has to come from the board rather than be assumed.
const UNIVERSES: [string, string][] = [
  ['sp500', 'S&P 500'],
  ['tsx', 'S&P/TSX Composite'],
];

type Placed = Tile<HeatTile> & { sector: string | null; block?: Tile<{ name: string }> };
type Block = { name: string; x: number; y: number; w: number; h: number };

const PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
const REFRESH_MS = 5 * 60_000;

// On screen. Five hundred names in this box leaves the median tile about
// seventeen units on its short side, so a third of them cannot hold a ticker.
const W = 1000;
const H = 560;

// For the saved image. Same layout, twice the user units, so every tile is
// twice the size against the same label threshold: 492 of 503 names get a
// ticker instead of 317, and the smallest is still around nine pixels in the
// exported file. Raising the PNG scale alone cannot do this, because the
// threshold is measured in user units and scaling moves every tile equally.
const EXPORT_W = 2000;
const EXPORT_H = 1120;

// Colour saturates at this move and no further, so one runaway name cannot
// flatten every other tile to grey.
const CLAMP: Record<string, number> = { '1D': 4, '1W': 7, '1M': 12, '3M': 18, YTD: 30, '1Y': 40 };

const GAP = 1.5;
const HEADER = 15;

function layoutFor(tiles: HeatTile[], grouped: boolean, w: number, h: number): Placed[] {
  if (!tiles.length) return [];

  if (!grouped) {
    return squarify(tiles, (t) => t.marketCap, { x: 0, y: 0, w, h }).map((t) => ({
      ...t,
      sector: null,
    }));
  }

  // sectors are laid out first, then names inside each sector's rectangle, so
  // a sector reads as one block and its weight is its share of the index
  const bySector = new Map<string, HeatTile[]>();
  for (const t of tiles) {
    const list = bySector.get(t.sector);
    if (list) list.push(t);
    else bySector.set(t.sector, [t]);
  }

  const sectors = [...bySector].map(([name, group]) => ({
    name,
    tiles: group,
    marketCap: group.reduce((a, t) => a + t.marketCap, 0),
  }));

  return squarify(sectors, (s) => s.marketCap, { x: 0, y: 0, w, h }).flatMap((block) => {
    const inner = {
      x: block.x + GAP,
      y: block.y + HEADER,
      w: Math.max(0, block.w - GAP * 2),
      h: Math.max(0, block.h - HEADER - GAP),
    };
    return squarify(block.item.tiles, (t) => t.marketCap, inner).map((t) => ({
      ...t,
      sector: block.item.name,
      block,
    }));
  });
}

function blocksOf(layout: Placed[], grouped: boolean): Block[] {
  if (!grouped) return [];
  const seen = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const t of layout) if (t.sector && t.block && !seen.has(t.sector)) seen.set(t.sector, t.block);
  return [...seen].map(([name, rect]) => ({ name, ...rect }));
}

export default function HeatmapPage() {
  const [period, setPeriod] = useState('1D');
  const [universe, setUniverse] = useState('sp500');
  const [grouped, setGrouped] = useState(true);
  const [loaded, setLoaded] = useState<Heatmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<HeatTile | null>(null);
  const [pinned, setPinned] = useState<HeatTile | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      getJson<Heatmap>(`/api/markets/heatmap?universe=${universe}`)
        .then((d) => live && (setLoaded(d), setError(null)))
        .catch((e) => live && setError(e.message));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [universe]);

  // Filtering the last response rather than blanking it: switching boards
  // must never draw one index's tiles under the other's heading, and the
  // answer on hand belongs to whichever index was asked for last.
  const data = loaded && loaded.universe === label(universe) ? loaded : null;

  // A tile can only be drawn if it has both an area and a return. Anything
  // missing either is left out of the map and counted underneath it, rather
  // than drawn in a neutral colour that reads as "flat".
  const drawable = useMemo(
    () => (data?.tiles ?? []).filter((t) => t.changePct[period] != null),
    [data, period],
  );

  const layout = useMemo(() => layoutFor(drawable, grouped, W, H), [drawable, grouped]);
  const sectorBlocks = useMemo(() => blocksOf(layout, grouped), [layout, grouped]);

  // only built while a save is in flight, so the page is not carrying a second
  // five hundred tile chart the rest of the time
  const exportLayout = useMemo(
    () => (exporting ? layoutFor(drawable, grouped, EXPORT_W, EXPORT_H) : []),
    [exporting, drawable, grouped],
  );
  const exportBlocks = useMemo(() => blocksOf(exportLayout, grouped), [exportLayout, grouped]);

  // the pinned tile's rectangle, so the card can sit against the box it
  // describes rather than in a corner of the chart
  const pinnedTile = useMemo(
    () => (pinned ? layout.find((t) => t.item.symbol === pinned.symbol) ?? null : null),
    [pinned, layout],
  );

  const clamp = CLAMP[period] ?? 10;
  const excluded = (data?.tiles.length ?? 0) - drawable.length;

  // flushSync renders the export chart before this handler continues, so the
  // ref is populated by the time it is read. Doing this in an effect instead
  // would mean setting state from inside one.
  const savePng = () => {
    flushSync(() => setExporting(true));
    if (exportRef.current) {
      svgToPng(exportRef.current, `heatmap-${universe}-${period}.png`, COLOR.bg, FONT.body);
    }
    setExporting(false);
  };

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={T.wordmark}>Market-Cap Heatmap</h1>
        <p style={T.sub}>S&amp;P 500 and S&amp;P/TSX Composite, sized by market capitalisation</p>
      </header>

      {error && <div style={{ ...card, color: COLOR.bad, marginBottom: 16 }}>{error}</div>}

      <div style={T.controls}>
        {UNIVERSES.map(([key, name]) => (
          <button
            key={key}
            style={{ ...T.control, ...(universe === key ? T.controlOn : {}) }}
            onClick={() => {
              setUniverse(key);
              // the pin and the readout name a tile on the board being left
              setHover(null);
              setPinned(null);
            }}
          >
            {name}
          </button>
        ))}

        <span style={T.divider} />

        {PERIODS.map((p) => (
          <button
            key={p}
            style={{ ...T.control, ...(period === p ? T.controlOn : {}) }}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}

        <span style={T.divider} />

        <button
          style={{ ...T.control, ...(grouped ? T.controlOn : {}) }}
          onClick={() => setGrouped(true)}
        >
          Group by sector
        </button>
        <button
          style={{ ...T.control, ...(!grouped ? T.controlOn : {}) }}
          onClick={() => setGrouped(false)}
        >
          Flat
        </button>

        <div style={T.spacer} />
        <button style={{ ...T.control, ...(layout.length ? {} : T.controlOff) }} onClick={savePng}>
          PNG
        </button>
        <a
          style={{ ...T.control, ...T.controlPrimary }}
          href={`/api/markets/heatmap/csv?universe=${universe}&period=${period}`}
        >
          CSV
        </a>
      </div>

      <section style={card}>
        <div style={T.cardHead}>
          <div>
            <h2 style={T.h2}>
              {data?.universe ?? label(universe)}: {period} return
            </h2>
            <p style={{ ...T.desc, marginBottom: 0 }}>
              {data
                ? `${drawable.length} of ${data.listed} companies shown${excluded > 0 ? `, ${excluded} without a ${period} return left out` : ''}. Click a tile for its detail`
                : 'Loading'}
            </p>
          </div>
          <div style={T.readout}>
            {hover ? (
              <>
                <b style={{ color: COLOR.ink }}>{hover.ticker}</b>
                <span style={{ color: COLOR.dim }}>{hover.name}</span>
                <span style={{ color: heatColor(hover.changePct[period], clamp) }}>
                  {fmtPct(hover.changePct[period])}
                </span>
                <span style={{ color: COLOR.dim }}>
                  {fmtCap(hover.marketCap, data?.currency)}
                </span>
              </>
            ) : (
              <Legend clamp={clamp} />
            )}
          </div>
        </div>

        {!data ? (
          <p style={{ fontSize: 12, color: COLOR.dim }}>Loading</p>
        ) : (
          <HeatChart
            w={W}
            h={H}
            layout={layout}
            blocks={sectorBlocks}
            period={period}
            clamp={clamp}
            currency={data.currency}
            hover={hover}
            pinned={pinned}
            pinnedTile={pinnedTile}
            onHover={setHover}
            onPin={setPinned}
          />
        )}

        <div style={S.foot}>
          <span>
            {data
              ? `Quoted ${data.asOf.slice(11, 19)} UTC, market caps in ${data.currency}. ${sourceNote(universe, data)}`
              : ''}
          </span>
          <Legend clamp={clamp} />
        </div>
      </section>

      {/* The saved image, built at twice the user units so the small names get a
          ticker too. Off screen rather than display:none, because a hidden SVG
          has no geometry to serialise. */}
      {exporting && (
        <div style={S.offscreen} aria-hidden>
          <HeatChart
            svgRef={exportRef}
            w={EXPORT_W}
            h={EXPORT_H}
            layout={exportLayout}
            blocks={exportBlocks}
            period={period}
            clamp={clamp}
            currency={data?.currency}
            hover={null}
            pinned={null}
            pinnedTile={null}
          />
        </div>
      )}
    </main>
  );
}

function HeatChart({
  svgRef,
  w,
  h,
  layout,
  blocks,
  period,
  clamp,
  currency,
  hover,
  pinned,
  pinnedTile,
  onHover,
  onPin,
}: {
  svgRef?: Ref<SVGSVGElement>;
  w: number;
  h: number;
  layout: Placed[];
  blocks: Block[];
  period: string;
  clamp: number;
  currency?: string;
  hover: HeatTile | null;
  pinned: HeatTile | null;
  pinnedTile: Placed | null;
  onHover?: (t: HeatTile | null) => void;
  onPin?: (fn: (p: HeatTile | null) => HeatTile | null) => void;
}) {
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onPin?.(() => null)}
    >
      <defs>
        <linearGradient id="tileSheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,.16)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {blocks.map((b) => (
        <g key={b.name}>
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={6}
            fill="none"
            stroke={COLOR.line}
            strokeWidth="1"
          />
          <text
            x={b.x + 5}
            y={b.y + 11}
            fill={COLOR.dim}
            fontSize="9.5"
            style={{ pointerEvents: 'none' }}
          >
            {/* trimmed to the block rather than run past it: the rightmost
                block ends at the chart edge, so "Communication Services"
                overflowed the viewBox and read as a rendering fault */}
            {b.w > 90 ? clip(b.name, Math.floor((b.w - 10) / 5.2)) : ''}
          </text>
        </g>
      ))}

      {layout.map((t) => {
        const pct = t.item.changePct[period];
        const tw = Math.max(0, t.w - GAP);
        const th = Math.max(0, t.h - GAP);
        const on = pinned?.symbol === t.item.symbol || hover?.symbol === t.item.symbol;

        // A ticker goes on a tile whenever it can be read at the size this
        // chart is drawn. The export chart is twice as large in user units, so
        // the same rule labels far more of them there.
        const showSymbol = tw > 13 && th > 6.5;
        const showPct = tw > 34 && th > 20;
        // shrink to fit the width rather than overflow it
        const symbolSize = Math.min(13, Math.max(4.6, (tw - 3) / (t.item.ticker.length * 0.62)));
        const radius = Math.min(4, Math.max(1, Math.min(tw, th) / 5));

        return (
          <g
            key={t.item.symbol}
            onMouseEnter={() => onHover?.(t.item)}
            onClick={(e) => {
              e.stopPropagation();
              onPin?.((p) => (p?.symbol === t.item.symbol ? null : t.item));
            }}
            style={{ cursor: onPin ? 'pointer' : 'default' }}
          >
            <rect
              x={t.x}
              y={t.y}
              width={tw}
              height={th}
              rx={radius}
              fill={heatColor(pct, clamp)}
              stroke={on ? COLOR.ink : 'rgba(0,0,0,.22)'}
              strokeWidth={on ? 1.5 : 0.6}
            />

            {/* a light top edge, enough to give the tile a face without
                lifting its colour far enough to misread the return */}
            {tw > 16 && th > 10 && (
              <rect
                x={t.x}
                y={t.y}
                width={tw}
                height={th * 0.45}
                rx={radius}
                fill="url(#tileSheen)"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {showSymbol && (
              <text
                x={t.x + tw / 2}
                y={t.y + th / 2 + (showPct ? -1 : symbolSize * 0.35)}
                fill={COLOR.onHeat}
                fontSize={symbolSize}
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {t.item.ticker}
              </text>
            )}
            {showPct && (
              <text
                x={t.x + tw / 2}
                y={t.y + th / 2 + 11}
                fill="rgba(14,26,22,.72)"
                fontSize={Math.min(10, Math.max(6.5, tw / 6))}
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {fmtPct(pct)}
              </text>
            )}
          </g>
        );
      })}

      {pinnedTile && (
        <TileCard
          tile={pinnedTile.item}
          rect={pinnedTile}
          period={period}
          clamp={clamp}
          currency={currency}
          bounds={{ w, h }}
        />
      )}
    </svg>
  );
}

// The detail card, drawn inside the SVG so a saved PNG carries it too. It sits
// against the tile it describes and is clamped to the chart, so a name in the
// bottom right corner does not push its own card off the edge.
const CARD = { w: 216, h: 84, pad: 10, gap: 7 };

function TileCard({
  tile,
  rect,
  period,
  clamp,
  currency,
  bounds,
}: {
  tile: HeatTile;
  rect: { x: number; y: number; w: number; h: number };
  period: string;
  clamp: number;
  currency?: string;
  bounds: { w: number; h: number };
}) {
  const pct = tile.changePct[period];

  const x = Math.max(4, Math.min(bounds.w - CARD.w - 4, rect.x + rect.w / 2 - CARD.w / 2));
  const below = rect.y + rect.h + CARD.gap;
  // flip above the tile when there is no room under it
  const y = below + CARD.h <= bounds.h - 4 ? below : Math.max(4, rect.y - CARD.h - CARD.gap);

  const line = (n: number) => y + CARD.pad + 13 + n * 13;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={x}
        y={y}
        width={CARD.w}
        height={CARD.h}
        rx={7}
        fill={COLOR.panel}
        stroke={COLOR.line}
        strokeWidth="1"
        opacity={0.97}
      />
      {/* the tile's own colour, so the card is tied to the box it came from */}
      <rect x={x} y={y} width={4} height={CARD.h} rx={2} fill={heatColor(pct, clamp)} />

      <text x={x + CARD.pad + 4} y={line(0)} fill={COLOR.ink} fontSize="13">
        {tile.ticker}
      </text>
      <text
        x={x + CARD.w - CARD.pad}
        y={line(0)}
        fill={pct == null ? COLOR.dim : pct < 0 ? COLOR.bad : COLOR.good}
        fontSize="12"
        textAnchor="end"
      >
        {fmtPct(pct)} {period}
      </text>

      <text x={x + CARD.pad + 4} y={line(1)} fill={COLOR.dim} fontSize="9.5">
        {clip(tile.name, 40)}
      </text>
      <text x={x + CARD.pad + 4} y={line(2)} fill={COLOR.dim} fontSize="9.5">
        {clip(tile.sector, 28)}
      </text>
      <text x={x + CARD.w - CARD.pad} y={line(2)} fill={COLOR.dim} fontSize="9.5" textAnchor="end">
        {fmtCap(tile.marketCap, currency)}
        {tile.price == null ? '' : `  ${tile.price.toFixed(2)}`}
      </text>
    </g>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Legend({ clamp }: { clamp: number }) {
  const stops = [-clamp, -clamp / 2, 0, clamp / 2, clamp];
  return (
    <span style={S.legend}>
      <span style={{ color: COLOR.dim }}>Return</span>
      {stops.map((s) => (
        <span key={s} style={{ ...S.legendChip, background: heatColor(s, clamp) }}>
          {s > 0 ? `+${s}` : s}
        </span>
      ))}
    </span>
  );
}

// Red through slate to green. The neutral middle is the page's own panel colour
// so a flat name recedes instead of reading as a third state.
function heatColor(pct: number | null | undefined, clamp: number) {
  if (pct == null) return COLOR.panel2;
  const t = Math.max(-1, Math.min(1, pct / clamp));
  const mix = (a: number[], b: number[], k: number) =>
    a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const neutral = [56, 76, 94];
  const good = [79, 183, 158];
  const bad = [224, 100, 95];
  const [r, g, b] = t >= 0 ? mix(neutral, good, t) : mix(neutral, bad, -t);
  return `rgb(${r},${g},${b})`;
}

const fmtPct = (v: number | null | undefined) =>
  v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

// C$ against $, because the two boards are not the same money and 393.5B means
// something different on each of them
const sign = (currency?: string) => (currency === 'CAD' ? 'C$' : '$');

const fmtCap = (v: number, currency?: string) =>
  v >= 1e12
    ? `${sign(currency)}${(v / 1e12).toFixed(2)}T`
    : `${sign(currency)}${(v / 1e9).toFixed(1)}B`;

const label = (key: string) => UNIVERSES.find(([k]) => k === key)?.[1] ?? key;

// Where the names came from. The S&P 500 has a constituent list; the TSX does
// not, so its membership is the union of two funds that replicate the index,
// and the holdings they carry that are not constituents are named here rather
// than left as a silent difference in the count.
function sourceNote(universe: string, data: Heatmap) {
  if (universe !== 'tsx') return 'FMP.';
  const skipped = data.skipped.length ? ` LEFT OUT: ${data.skipped.join(', ')}.` : '';
  return `Membership from the XIC and ZCN index funds, sectors as FMP groups them.${skipped}`;
}

const S: Record<string, CSSProperties> = {
  offscreen: {
    position: 'absolute',
    left: -99999,
    top: 0,
    width: EXPORT_W,
    height: EXPORT_H,
    pointerEvents: 'none',
  },
  foot: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    borderTop: `1px solid ${COLOR.hair}`,
    paddingTop: 10,
    marginTop: 8,
    fontSize: 11,
    color: COLOR.dim,
  },
  legend: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, flexWrap: 'wrap' },
  legendChip: {
    padding: '2px 7px',
    borderRadius: 3,
    color: COLOR.onHeat,
    fontSize: 10,
  },
};
