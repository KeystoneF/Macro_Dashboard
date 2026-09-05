import { COLOR } from '../theme';

// SVG user units. Every chart draws into a fixed box and the viewBox scales it
// to whatever width the card gives it, so nothing here reads the DOM.
export type Frame = {
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
};

export const plotW = (f: Frame) => f.w - f.pad.left - f.pad.right;
export const plotH = (f: Frame) => f.h - f.pad.top - f.pad.bottom;

export function Gridlines({
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
        <g key={t}>
          <line
            x1={frame.pad.left}
            x2={frame.w - frame.pad.right}
            y1={y(t)}
            y2={y(t)}
            stroke={COLOR.hair}
          />
          <text
            x={frame.pad.left - 8}
            y={y(t) + 4}
            fill={COLOR.dim}
            fontSize="10"
            textAnchor="end"
          >
            {t.toFixed(digits)}
          </text>
        </g>
      ))}
    </>
  );
}

// half the widest label an axis carries, in viewBox units
const EDGE = 34;

export function XLabels({
  frame,
  items,
  offset = 10,
}: {
  frame: Frame;
  items: { at: number; label: string }[];
  offset?: number;
}) {
  return (
    <>
      {items.map((it) => (
        <text
          key={it.label}
          x={it.at}
          y={frame.h - offset}
          fill={COLOR.dim}
          fontSize="10"
          // centred, except at the ends, where a centred label runs off the
          // viewBox and is clipped. Intraday ticks carry a time as well as a
          // date and are wide enough for that to bite.
          textAnchor={it.at < EDGE ? 'start' : it.at > frame.w - EDGE ? 'end' : 'middle'}
        >
          {it.label}
        </text>
      ))}
    </>
  );
}

// Vertical axis title, rotated up the left gutter. A saved PNG carries the svg
// and nothing around it, so a chart that names its axis only in the panel
// heading exports with an unlabelled scale.
export function AxisLabel({ frame, text }: { frame: Frame; text: string }) {
  const x = 12;
  const y = frame.pad.top + plotH(frame) / 2;
  return (
    <text
      x={x}
      y={y}
      fill={COLOR.dim}
      fontSize="10"
      textAnchor="middle"
      transform={`rotate(-90 ${x} ${y})`}
    >
      {text}
    </text>
  );
}

// Names a rule the plot cannot explain on its own, in the bottom margin. Same
// reason: a dashed line described only in the panel copy exports as a dashed
// line nobody can read.
export function LegendRule({
  frame,
  color,
  dash,
  label,
  offset = 10,
}: {
  frame: Frame;
  color: string;
  dash?: string;
  label: string;
  offset?: number;
}) {
  const y = frame.h - offset;
  return (
    <g>
      <line
        x1={frame.pad.left}
        x2={frame.pad.left + 18}
        y1={y - 3.5}
        y2={y - 3.5}
        stroke={color}
        strokeWidth="1.4"
        strokeDasharray={dash}
      />
      <text x={frame.pad.left + 24} y={y} fill={COLOR.dim} fontSize="10">
        {label}
      </text>
    </g>
  );
}

export function HoverRule({ frame, x }: { frame: Frame; x: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={frame.pad.top}
      y2={frame.h - frame.pad.bottom}
      stroke={COLOR.line}
      strokeDasharray="3 3"
    />
  );
}

// Zero matters on a growth chart and is not just another gridline.
export function ZeroRule({ frame, y }: { frame: Frame; y: number }) {
  return (
    <line
      x1={frame.pad.left}
      x2={frame.w - frame.pad.right}
      y1={y}
      y2={y}
      stroke={COLOR.line}
    />
  );
}

// Turns a pointer position over the chart into a value on the time axis, or
// null when the cursor is out in the padding.
export function timeAt(
  e: { clientX: number; currentTarget: { getBoundingClientRect(): DOMRect } },
  frame: Frame,
  t0: number,
  t1: number,
): number | null {
  const rect = e.currentTarget.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * frame.w;
  const frac = (px - frame.pad.left) / plotW(frame);
  if (frac < 0 || frac > 1) return null;
  return t0 + frac * (t1 - t0);
}
