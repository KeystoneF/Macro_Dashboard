'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { FONT, COLOR, wordmarkAccent } from '../theme';
import Mark from '../components/Mark';
import { useSession } from '../components/SessionGate';
import { useMediaQuery } from '../lib/useMediaQuery';
import { announceNav } from '../lib/navRefresh';
import { GROUPS, MODULES, type ModuleState } from './modules';

const WIDTH = { open: 232, collapsed: 66 };

// dot beside each nav item, so build state is visible without opening the module
const STATE_COLOR: Record<ModuleState, string> = {
  live: COLOR.good,
  stubbed: COLOR.ca,
  blocked: COLOR.bad,
  mockup: COLOR.line,
};

export default function Sidebar() {
  const pathname = usePathname();
  const { user, end } = useSession();
  const [collapsed, setCollapsed] = useState(false);
  // below this the desk is on half a screen or a tablet, and a 232px rail is
  // too much of the width to give up
  const narrow = useMediaQuery('(max-width: 900px)');
  const [hovered, setHovered] = useState<string | null>(null);
  const shut = collapsed || narrow;

  return (
    <div style={{ ...S.sidebar, width: shut ? WIDTH.collapsed : WIDTH.open }}>
      <button
        style={{ ...S.toggle, display: narrow ? 'none' : 'flex' }}
        onClick={() => setCollapsed((c) => !c)}
        title={shut ? 'Expand panel' : 'Collapse panel'}
        aria-label={shut ? 'Expand panel' : 'Collapse panel'}
      >
        <svg
          viewBox="0 0 10 10"
          style={{
            width: 10,
            height: 10,
            transform: shut ? 'rotate(180deg)' : 'none',
            transition: 'transform .22s ease',
          }}
        >
          <path
            d="M6.5 1 L2.5 5 L6.5 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div style={{ ...S.head, justifyContent: shut ? 'center' : 'flex-start' }}>
        <Mark size={26} />
        {!shut && (
          <div style={S.brand}>
            KeyStone <span style={{ ...wordmarkAccent, ...S.brandSecond }}>MacroDesk</span>
          </div>
        )}
      </div>

      <nav style={S.nav}>
        {GROUPS.map((group) => (
          <div key={group}>
            {!shut && <div style={S.groupLabel}>{group}</div>}
            {MODULES.filter((m) => m.group === group).map((m) => {
              const active = pathname === `/${m.slug}`;
              const lit = active || hovered === m.slug;
              return (
                <Link
                  key={m.slug}
                  href={`/${m.slug}`}
                  title={shut ? m.title : undefined}
                  // clicking the module already on screen is still a request
                  // for fresh figures, and that navigation remounts nothing
                  onClick={() => announceNav(m.slug)}
                  onMouseEnter={() => setHovered(m.slug)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    ...S.tab,
                    justifyContent: shut ? 'center' : 'flex-start',
                    gap: shut ? 0 : 12,
                    padding: shut ? '11px 0' : '10px 20px',
                    background: lit ? COLOR.panel2 : 'transparent',
                    color: lit ? COLOR.ink : COLOR.dim,
                    borderLeftColor: active ? COLOR.accent : 'transparent',
                  }}
                >
                  <span
                    style={{
                      ...S.num,
                      width: shut ? 'auto' : 16,
                      color: active ? COLOR.accent : COLOR.dim,
                    }}
                  >
                    {m.num}
                  </span>
                  {!shut && (
                    <>
                      <span style={S.label}>{m.label}</span>
                      <span
                        style={{ ...S.stateDot, background: STATE_COLOR[m.state] }}
                        title={m.state}
                      />
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {!shut && (
        <div style={S.foot}>
          <span style={S.footWho} title={user.email}>
            {user.name || user.email}
          </span>
          <Link href="/status" style={S.footLink}>
            Environment status
          </Link>
          <button style={S.footButton} onClick={end}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  sidebar: {
    flexShrink: 0,
    background: COLOR.panel,
    borderRight: `1px solid ${COLOR.line}`,
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    transition: 'width .22s ease',
  },
  toggle: {
    position: 'absolute',
    top: 26,
    right: -11,
    zIndex: 5,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: COLOR.panel2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: COLOR.line,
    color: COLOR.dim,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
  },
  head: {
    padding: '20px 18px 16px',
    borderBottom: `1px solid ${COLOR.line}`,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  brand: {
    fontFamily: FONT.display,
    fontSize: 18,
    fontWeight: 700,
    fontStyle: 'italic',
    lineHeight: 1.15,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  brandSecond: { display: 'block', fontSize: 14 },
  nav: { flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingBottom: 12 },
  groupLabel: {
    fontSize: 9,
    letterSpacing: '.2px',
    color: COLOR.dim,
    padding: '16px 20px 6px',
    whiteSpace: 'nowrap',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    // longhand throughout: the active variant sets borderLeftColor on its own
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    fontSize: 13,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
  },
  num: { fontSize: 10.5, flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
  label: { overflow: 'hidden', flex: 1 },
  stateDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  foot: {
    padding: '13px 20px',
    borderTop: `1px solid ${COLOR.line}`,
    fontSize: 9.5,
    color: COLOR.dim,
    lineHeight: 1.9,
    display: 'flex',
    flexDirection: 'column',
  },
  footWho: {
    color: COLOR.dim,
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  footLink: { color: COLOR.accent, letterSpacing: '.2px', textDecoration: 'none' },
  footButton: {
    fontFamily: FONT.body,
    fontSize: 9.5,
    letterSpacing: '.2px',
    color: COLOR.accent,
    background: 'transparent',
    borderWidth: 0,
    borderStyle: 'solid',
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
  },
};
