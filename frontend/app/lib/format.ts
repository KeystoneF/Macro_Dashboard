import { COLOR } from '../theme';

// Shared market-board formatting.

export const fmtPrice = (v: number | null | undefined, decimals: number) =>
  v == null
    ? 'n/a'
    : v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const fmtPct = (v: number | null | undefined) =>
  v == null ? 'n/a' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

export const pctColor = (v: number | null | undefined) =>
  v == null ? COLOR.dim : v < 0 ? COLOR.bad : COLOR.good;

// Age of the provider's quote, not the latest request.
export const minutesBehind = (quotedAt: string | null) =>
  quotedAt == null ? null : Math.floor((Date.now() - Date.parse(quotedAt)) / 60_000);

export function age(quotedAt: string | null): string {
  const mins = minutesBehind(quotedAt);
  if (mins == null) return 'n/a';
  if (mins < 1) return 'now';
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
}
