import { memo } from 'react';
import { segments } from '../lib/gaps';
import { toTime, type Obs } from '../lib/time';

// Break lines at missing periods and show isolated observations as dots.
// Memoize coordinates so hover updates stay cheap.
function SeriesLine({
  points,
  color,
  x,
  y,
  width = 1.8,
  dash,
  opacity = 1,
}: {
  points: Obs[];
  color: string;
  x: (t: number) => number;
  y: (v: number) => number;
  width?: number;
  dash?: string;
  opacity?: number;
}) {
  return (
    <>
      {segments(points).map((run, i) =>
        run.length === 1 ? (
          <circle
            key={i}
            cx={x(toTime(run[0].d))}
            cy={y(run[0].v)}
            r={width}
            fill={color}
            opacity={opacity}
          />
        ) : (
          <polyline
            key={i}
            points={run.map((p) => `${x(toTime(p.d))},${y(p.v)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeDasharray={dash}
            opacity={opacity}
          />
        ),
      )}
    </>
  );
}

export default memo(SeriesLine);
