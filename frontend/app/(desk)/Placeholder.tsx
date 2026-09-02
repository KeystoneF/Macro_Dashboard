import type { CSSProperties } from 'react';
import * as T from '../theme';
import { COLOR, RADIUS, card } from '../theme';
import type { Module, ModuleState } from './modules';

const BADGE: Partial<Record<ModuleState, { text: string; color: string }>> = {
  live: { text: 'Live', color: COLOR.good },
  stubbed: { text: 'Backend stubbed', color: COLOR.ca },
  blocked: { text: 'Blocked', color: COLOR.bad },
};

// Stands in for a module that has not been built. It shows no figures at all:
// the mockups carry placeholder numbers, and putting those on a route inside
// the app is exactly what the no-estimate policy exists to stop.
export default function Placeholder({ module }: { module: Module }) {
  const badge = BADGE[module.state];

  return (
    <main className="desk-page" style={T.page}>
      <header style={{ marginBottom: 16 }}>
        <div style={S.titleRow}>
          <h1 style={T.wordmark}>{module.title}</h1>
          {badge && (
            <span style={{ ...S.badge, color: badge.color, borderColor: badge.color }}>
              {badge.text}
            </span>
          )}
        </div>
        <p style={T.sub}>Module {module.num} of 9</p>
      </header>

      <section style={{ ...card, maxWidth: 620 }}>
        <h2 style={T.h2}>Nothing to show yet</h2>
      </section>

    </main>
  );
}

const S: Record<string, CSSProperties> = {
  titleRow: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' },
  badge: {
    fontSize: 10,
    letterSpacing: '.2px',
    padding: '3px 10px',
    borderRadius: RADIUS.control,
    borderWidth: 1,
    borderStyle: 'solid',
    whiteSpace: 'nowrap',
  },
};
