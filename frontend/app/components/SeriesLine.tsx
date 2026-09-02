import { memo } from 'react';
import { segments } from '../lib/gaps';
import { toTime, type Obs } from '../lib/time';

// One series on a time chart, drawn as one polyline per run of consecutive
// prints rather than as a single line over every point. The line stops at a
// hole and starts again after it, because joining across one would draw a path
// through a period that never printed.
//
// A print with holes on both sides gets a dot: a polyline of one point renders
// nothing, and an observation that exists must not disappear because its
// neighbours are missing.
//
// Memoised, because the chart above it re-renders on every mousemove to move
// the hover rule and none of these props change when the cursor does. Without
// it, five daily series over 25 years rebuilt 30,000 coordinates into polyline
// attributes several times a second and the tab stopped responding.
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
