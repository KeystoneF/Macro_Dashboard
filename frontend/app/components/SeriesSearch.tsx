'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../theme';
import { COLOR, RADIUS } from '../theme';
import { getJson } from '../lib/api';

export type Found = {
  source: 'fred' | 'boc' | 'statcan';
  sourceName: string;
  country: string;
  id: string;
  label: string;
  detail: string;
  freq: string | null;
  units: string | null;
  lastPrint: string | null;
  stale: boolean | null;
  addable: boolean;
  productId?: number;
};

type Results = { query: string; results: Found[]; notes: string[]; includeAll: boolean };

type Dimension = { name: string; members: { id: number; name: string }[] };
type Cube = {
  productId: number;
  title: string;
  end: string | null;
  frequency: string | null;
  dimensions: Dimension[];
};

type Resolved = { id: string; label: string; freq: string | null; note?: string };

// A searched series is referenced as source:id so the API knows which provider
// to ask. A bare id cannot say whether GDP is the FRED series or a Valet one.
export const refOf = (f: Found) => `${f.source}:${f.id}`;

const SOURCES: [string, string][] = [
  ['all', 'All sources'],
  ['fred', 'FRED'],
  ['boc', 'Bank of Canada'],
  ['statcan', 'Statistics Canada'],
];

// Typing is not a reason to hit three providers. Long enough that a whole word
// lands before anything is sent.
const DEBOUNCE_MS = 350;

// Memoised: this sits under the chart on a page that re-renders on every
// mousemove over the plot, and none of its props change when the cursor does.
function SeriesSearch({
  onAdd,
  picked,
  full,
}: {
  onAdd: (ref: string) => void;
  picked: string[];
  full: boolean;
}) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  // Off by default: what comes back is series that are still being published.
  // The providers between them carry tens of thousands that stopped years ago
  // or were one panel in one report, and those are not what anyone is looking
  // for unless they say so.
  const [includeAll, setIncludeAll] = useState(false);
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cube, setCube] = useState<Cube | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      getJson<Results>(
        `/api/discover?q=${encodeURIComponent(term)}&source=${source}${includeAll ? '&all=1' : ''}`,
      )
        .then((d) => {
          if (!live) return;
          setData(d);
          setError(null);
        })
        .catch((e) => live && setError(e.message));
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, source, includeAll]);

  const openCube = (productId: number) => {
    setResolved(null);
    setPicks([]);
    setCube(null);
    getJson<Cube>(`/api/discover/cube/${productId}`)
      .then((c) => {
        setCube(c);
        // a sensible starting point: the first member of every dimension, which
        // is Canada and the total on almost every table
        setPicks(c.dimensions.map((d) => d.members[0]?.id ?? 1));
      })
      .catch((e) => setError(e.message));
  };

  const resolve = (next: number[]) => {
    if (!cube) return;
    setResolved(null);
    getJson<Resolved>(
      `/api/discover/cube/${cube.productId}/resolve?picks=${next.join(',')}`,
    )
      .then(setResolved)
      .catch((e) => setResolved({ id: '', label: '', freq: null, note: e.message }));
  };

  const setPick = (i: number, value: number) => {
    const next = picks.map((p, n) => (n === i ? value : p));
    setPicks(next);
    resolve(next);
  };

  // a query the user has cleared shows nothing, rather than the last answer,
  // and it is derived rather than blanked from inside the effect
  const results = useMemo(
    () => (term.length >= 2 && data?.query === term ? data.results : []),
    [data, term],
  );
  const notes = data?.query === term ? (data?.notes ?? []) : [];
  // in flight whenever the answer on hand is not for what is typed now, which
  // is the same fact the state flag held without needing to be kept in sync
  const busy = term.length >= 2 && data?.query !== term && !error;

  return (
    <section style={T.card}>
      <h2 style={T.h2}>Search every source</h2>
      <div style={{ ...T.controls, marginTop: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What are you looking for?"
          style={{ ...T.input, flex: '1 1 200px', minWidth: 0 }}
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} style={T.input}>
          {SOURCES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <label style={S.toggle}>
          <input
            type="checkbox"
            checked={includeAll}
            onChange={(e) => setIncludeAll(e.target.checked)}
            style={S.checkbox}
          />
          Include stopped and one-off series
        </label>

        <div style={T.spacer} />
        <span style={{ fontSize: 11, color: COLOR.dim }}>
          {busy
            ? 'Searching'
            : term.length >= 2 && data?.query === term
              ? `${results.length} found`
              : ''}
        </span>
      </div>

      {error && <p style={{ ...T.desc, color: COLOR.bad }}>{error}</p>}
      {notes.map((n) => (
        <p key={n} style={{ ...T.desc, color: COLOR.ca, marginBottom: 6 }}>
          {n}
        </p>
      ))}

      {term.length >= 2 && !busy && data?.query === term && !results.length && (
        <p style={{ fontSize: 12, color: COLOR.dim }}>
          Nothing matched. Try fewer words, or a term the publisher would use.
        </p>
      )}

      {results.length > 0 && (
        <div style={{ maxHeight: 340, overflowY: 'auto', overflowX: 'auto', paddingRight: 8 }}>
          <table style={{ ...T.table, minWidth: 460 }}>
            <thead>
              <tr>
                <th style={S.stickyTh}>Series</th>
                <th style={S.stickyTh}>Source</th>
                <th style={S.stickyTh}>Frequency</th>
                <th style={{ ...S.stickyTh, textAlign: 'right' }}>Last</th>
                <th style={{ ...S.stickyTh, textAlign: 'right' }}>{' '}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((f) => {
                const ref = refOf(f);
                const on = picked.includes(ref);
                return (
                  <tr key={`${f.source}:${f.id}`}>
                    <td style={{ ...T.td, color: COLOR.ink }}>
                      {f.label}
                      <span style={S.subId}>{f.id}</span>
                    </td>
                    <td style={{ ...T.td, color: COLOR.dim }}>{f.sourceName}</td>
                    <td style={{ ...T.td, color: COLOR.dim }}>{f.freq ?? 'n/a'}</td>
                    <td
                      style={{
                        ...T.td,
                        textAlign: 'right',
                        color: f.stale ? COLOR.bad : COLOR.dim,
                      }}
                    >
                      {f.lastPrint ?? 'n/a'}
                      {/* a discontinued series looks entirely normal otherwise,
                          which is what the curated list existed to avoid */}
                      {f.stale && <span style={S.staleTag}>stopped</span>}
                    </td>
                    <td style={{ ...T.td, textAlign: 'right' }}>
                      {f.addable ? (
                        <button
                          style={{
                            ...T.control,
                            ...S.small,
                            ...(on || full ? T.controlOff : {}),
                          }}
                          onClick={() => onAdd(ref)}
                          title={full ? 'Five series maximum' : undefined}
                        >
                          {on ? 'on chart' : 'add'}
                        </button>
                      ) : (
                        <button
                          style={{ ...T.control, ...S.small }}
                          onClick={() => openCube(f.productId as number)}
                        >
                          choose
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cube && (
        <div style={S.picker}>
          <h3 style={{ ...T.h2, fontSize: 14 }}>{cube.title}</h3>
          <p style={T.desc}>Pick one option from each list to get a single line.</p>

          <div style={S.dims}>
            {cube.dimensions.map((d, i) => (
              <label key={d.name} style={S.dim}>
                <span style={S.dimName}>{d.name}</span>
                <select
                  value={picks[i] ?? d.members[0]?.id}
                  onChange={(e) => setPick(i, Number(e.target.value))}
                  style={{ ...T.input, width: '100%' }}
                >
                  {d.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div style={S.resolveRow}>
            {!resolved && (
              <button style={{ ...T.control }} onClick={() => resolve(picks)}>
                Resolve this combination
              </button>
            )}
            {resolved && resolved.id && (
              <>
                <span style={{ fontSize: 12, color: COLOR.ink }}>
                  {resolved.id}
                  <span style={S.subId}>{resolved.label}</span>
                </span>
                {resolved.note && <span style={{ fontSize: 11, color: COLOR.ca }}>{resolved.note}</span>}
                <div style={T.spacer} />
                <button
                  style={{
                    ...T.control,
                    ...T.controlPrimary,
                    ...(picked.includes(`statcan:${resolved.id}`) || full ? T.controlOff : {}),
                  }}
                  onClick={() => onAdd(`statcan:${resolved.id}`)}
                >
                  Add to chart
                </button>
              </>
            )}
            {resolved && !resolved.id && (
              <span style={{ fontSize: 12, color: COLOR.bad }}>{resolved.note}</span>
            )}
            <button style={{ ...T.control, ...S.small }} onClick={() => setCube(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default memo(SeriesSearch);

const S: Record<string, CSSProperties> = {
  stickyTh: { ...T.th, position: 'sticky', top: 0, zIndex: 1, background: COLOR.panel },
  subId: { display: 'block', fontSize: 10.5, color: COLOR.dim },
  staleTag: { display: 'block', fontSize: 10, color: COLOR.bad },
  small: { fontSize: 11, padding: '3px 9px' },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 11.5,
    color: COLOR.dim,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  checkbox: { accentColor: COLOR.accent, width: 13, height: 13 },
  picker: {
    marginTop: 14,
    paddingTop: 14,
    borderTop: `1px solid ${COLOR.hair}`,
  },
  dims: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  dim: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  dimName: { fontSize: 10.5, color: COLOR.dim },
  resolveRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    borderRadius: RADIUS.control,
  },
};
