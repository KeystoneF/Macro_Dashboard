import { COLOR } from '../theme';

// Price, percent and quote age, shared by the boards that show them. The brief
// and the FX module print the same figures in different shapes, and a second
// copy of these drifts from the first.

export const fmtPrice = (v: number | null | undefined, decimals: number) =>
  v == null
    ? 'n/a'
    : v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const fmtPct = (v: number | null | undefined) =>
  v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export const pctColor = (v: number | null | undefined) =>
  v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good;

// How far behind the clock an instrument's last print is. FMP delays some and
// not others, and the number is the point: gold runs about ten minutes back on
// this plan while the majors are seconds back.
export const minutesBehind = (quotedAt: string | null) =>
  quotedAt == null ? null : Math.floor((Date.now() - Date.parse(quotedAt)) / 60_000);

export function age(quotedAt: string | null): string {
  const mins = minutesBehind(quotedAt);
  if (mins == null) return 'n/a';
  if (mins < 1) return 'now';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
}
