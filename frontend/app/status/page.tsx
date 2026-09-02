'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../theme';
import { COLOR, FONT, RADIUS } from '../theme';
import Mark from '../components/Mark';
import Ribbon from '../components/Ribbon';
import { getJson } from '../lib/api';

type Health = {
  ok: boolean;
  db: boolean;
  dbError: string | null;
  fmpKey: boolean;
  time: string;
};

// --- page -------------------------------------------------------------------

export default function StatusPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [apiUp, setApiUp] = useState<boolean | null>(null);

  useEffect(() => {
    getJson<Health>('/api/health')
      .then((d) => {
        setHealth(d);
        setApiUp(true);
      })
      .catch(() => setApiUp(false));
  }, []);

  const rows: [string, boolean | null, string][] = [
    ['Express API', apiUp, apiUp === false ? 'not reachable on :4000' : ''],
    ['PostgreSQL', health?.db ?? null, health?.dbError ?? ''],
    ['FMP key loaded', health?.fmpKey ?? null, ''],
  ];

  const statusColor = (ok: boolean | null) =>
    ok === null ? COLOR.dim : ok ? COLOR.good : COLOR.bad;

  return (
    <main style={S.page}>
      <div style={S.glow} aria-hidden />
      <Ribbon />

      <div style={S.content}>
        <Link href="/brief" style={S.back}>
          <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden>
            <path
              d="M6.5 1 L2.5 5 L6.5 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Back to the desk
        </Link>

        <header style={S.header}>
          <Mark size={30} />
          <div>
            <h1 style={S.wordmark}>
              <span>KeyStone</span> <span style={T.wordmarkGlass}>MacroDesk</span>
            </h1>
            <p style={S.sub}>Local environment status</p>
          </div>
        </header>

        <section style={S.card}>
          {rows.map(([label, ok, note], i) => (
            <div
              key={label}
              style={{
                ...S.row,
                // no hairline under the last row, it reads as a dangling edge
                borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${COLOR.hair}`,
              }}
            >
              <span style={S.label}>{label}</span>
              <span style={{ ...S.value, color: statusColor(ok) }}>
                <span style={{ ...S.dot, background: statusColor(ok) }} />
                {ok === null ? 'checking' : ok ? 'ok' : 'down'}
                {note ? ` (${note})` : ''}
              </span>
            </div>
          ))}
        </section>

        <footer style={S.foot}>{health ? `Last checked ${health.time}` : ''}</footer>
      </div>
    </main>
  );
}

const S: Record<string, CSSProperties> = {
  page: {
    position: 'relative',
    minHeight: '100vh',
    background: COLOR.bg,
    color: COLOR.ink,
    padding: '40px 48px 64px',
    fontFamily: FONT.body,
    fontVariantNumeric: 'tabular-nums',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 520,
    height: 230,
    top: 0,
    left: 10,
    borderRadius: '50%',
    background: 'rgba(26,168,151,.20)',
    filter: 'blur(70px)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  content: { position: 'relative', zIndex: 2 },
  back: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 11.5,
    letterSpacing: '.2px',
    color: COLOR.accent,
    textDecoration: 'none',
    marginBottom: 30,
  },
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 },
  wordmark: {
    fontFamily: FONT.display,
    fontWeight: 700,
    fontStyle: 'italic',
    fontSize: 42,
    letterSpacing: '.3px',
    lineHeight: 1.05,
    margin: 0,
  },
  sub: { fontSize: 13, color: COLOR.dim, margin: '7px 0 0' },
  card: {
    ...T.card,
    maxWidth: 560,
    padding: '4px 22px',
    borderRadius: RADIUS.card,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    padding: '14px 0',
  },
  label: { fontSize: 14, color: COLOR.dim },
  value: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, textAlign: 'right' },
  dot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  foot: { marginTop: 20, fontSize: 12.5, color: COLOR.dim, opacity: 0.8 },
};
