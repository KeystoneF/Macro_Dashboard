import { COLOR } from '../theme';

// The Trend column on both boards. No axes and no labels: it carries shape over
// the window, and the number beside it carries the magnitude.
export default function Sparkline({
  points,
  color,
  width = 76,
  height = 20,
}: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden>
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke={COLOR.hair}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const pad = 2;

  const d = points
    .map((v, i) => {
      const x = (width * i) / (points.length - 1);
      const y = pad + (height - pad * 2) * (1 - (v - lo) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.3" />
    </svg>
  );
}
