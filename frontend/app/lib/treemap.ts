// Squarified treemap. Tiles are laid out in rows across the shorter side of the
// remaining space, which keeps them close to square: long thin slivers are
// unreadable and make areas impossible to compare by eye.
//
// Bruls, Huizing and van Wijk, "Squarified Treemaps" (2000).

export type Rect = { x: number; y: number; w: number; h: number };

export type Tile<T> = Rect & { item: T };

// How far a row of tiles is from square, taken as the worst aspect ratio in it.
// Lower is better, and 1 is a perfect square.
function worstRatio(row: number[], length: number, scale: number) {
  if (!row.length || length <= 0) return Infinity;
  const total = row.reduce((a, b) => a + b, 0) * scale;
  if (total <= 0) return Infinity;
  const max = Math.max(...row) * scale;
  const min = Math.min(...row) * scale;
  const side = length * length;
  return Math.max((side * max) / (total * total), (total * total) / (side * min));
}

export function squarify<T>(items: T[], valueOf: (t: T) => number, area: Rect): Tile<T>[] {
  const entries = items
    .map((item) => ({ item, value: Math.max(0, valueOf(item)) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!entries.length || area.w <= 0 || area.h <= 0) return [];

  const total = entries.reduce((a, e) => a + e.value, 0);
  // one scale for the whole layout, so a tile's area means the same thing in
  // every row
  const scale = (area.w * area.h) / total;

  const out: Tile<T>[] = [];
  let free = { ...area };
  let i = 0;

  while (i < entries.length) {
    const vertical = free.w >= free.h;
    const length = vertical ? free.h : free.w;

    const row: number[] = [];
    const rowItems: T[] = [];

    // grow the row while it keeps getting squarer, and stop the moment it does not
    while (i < entries.length) {
      const next = entries[i].value;
      if (row.length && worstRatio([...row, next], length, scale) > worstRatio(row, length, scale)) {
        break;
      }
      row.push(next);
      rowItems.push(entries[i].item);
      i += 1;
    }

    const rowTotal = row.reduce((a, b) => a + b, 0) * scale;
    const thickness = length > 0 ? rowTotal / length : 0;

    let offset = 0;
    row.forEach((value, n) => {
      const share = (value * scale) / (thickness || 1);
      out.push(
        vertical
          ? { x: free.x, y: free.y + offset, w: thickness, h: share, item: rowItems[n] }
          : { x: free.x + offset, y: free.y, w: share, h: thickness, item: rowItems[n] },
      );
      offset += share;
    });

    free = vertical
      ? { x: free.x + thickness, y: free.y, w: free.w - thickness, h: free.h }
      : { x: free.x, y: free.y + thickness, w: free.w, h: free.h - thickness };

    if (free.w <= 0.5 || free.h <= 0.5) break;
  }

  return out;
}
