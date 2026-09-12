'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import * as T from '../theme';
import { COLOR } from '../theme';
import { getJson } from '../lib/api';

export type Found = {
  ref: string;
  id: string;
  agency: string;
  name: string;
  detail: string;
  topics: string[];
  updated: string | null;
  stale: boolean;
  partial: boolean;
  probeBlocked: boolean;
};

type Results = {
  query: string;
  results: Found[];
  includeAll: boolean;
  budget?: Budget;
};

export type Budget = { used: number; ceiling: number; blockedFor: number };

type Dimension = { id: string; name: string; values: { id: string; name: string }[] };
type Combo = { values: string[]; last: string | null; areas: string[] };

type Flow = {
  ref: string;
  name: string;
  description: string;
  topics: string[];
  updated: string | null;
  area: { id: string; name: string };
  dimIds: string[];
  dimensions: Dimension[];
  combos: Combo[];
  defaults: string[] | null;
};

// What the chart is asked to draw: a dataset and one key into it, with the
// country segment left empty so every country comes back in the one request.
export type Measure = { flow: string; key: string; name: string };

const DEBOUNCE_MS = 350;

export const measureId = (flow: string, key: string) => `${flow}|${key}`;

function OecdSearch({ onShow, current }: { onShow: (m: Measure) => void; current: string | null }) {
  const [query, setQuery] = useState('');
  // Off by default: what comes back is datasets OECD is still publishing. A few
  // hundred stopped years ago and are only wanted by someone reproducing an old
  // chart on purpose.
  const [includeAll, setIncludeAll] = useState(false);
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);

  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      getJson<Results>(
        `/api/international/search?q=${encodeURIComponent(term)}${includeAll ? '&all=1' : ''}`,
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
  }, [term, includeAll]);

  const open = (ref: string) => {
    setFlow(null);
    setOpening(ref);
    setError(null);
    getJson<Flow>(`/api/international/flow?ref=${encodeURIComponent(ref)}`)
      .then((f) => {
        setFlow(f);
        setPicks(f.defaults ?? f.combos[0]?.values ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setOpening(null));
  };

  // Choosing a value moves to the published combination closest to what is
  // already picked, so the picker can never name a series nobody publishes.
  const choose = (index: number, value: string) => {
    if (!flow) return;
    const wanted = picks.map((p, i) => (i === index ? value : p));
    let best = null;
    let bestScore = -1;
    for (const combo of flow.combos) {
      if (combo.values[index] !== value) continue;
      const score = combo.values.filter((v, i) => v === wanted[i]).length;
      if (score > bestScore) {
        bestScore = score;
        best = combo;
      }
    }
    if (best) setPicks(best.values);
  };

  const combo = useMemo(
    () => flow?.combos.find((c) => String(c.values) === String(picks)) ?? null,
    [flow, picks],
  );

  const key = useMemo(() => {
    if (!flow) return '';
    return flow.dimIds
      .map((id) => {
        if (id === flow.area.id) return '';
        const at = flow.dimensions.findIndex((d) => d.id === id);
        return at < 0 ? '' : (picks[at] ?? '');
      })
      .join('.');
  }, [flow, picks]);

  const results = useMemo(
    () => (term.length >= 2 && data?.query === term ? data.results : []),
    [data, term],
  );
  const busy = term.length >= 2 && data?.query !== term && !error;
  const budget = data?.budget;
  const onChart = flow && current === measureId(flow.ref, key);

  return (
    <section style={T.card}>
      <h2 style={T.h2}>Search OECD</h2>

      <div style={T.controls}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What are you looking for?"
          style={{ ...T.input, flex: '1 1 220px', minWidth: 0 }}
        />
        <label style={S.toggle}>
          <input
            type="checkbox"
            checked={includeAll}
            onChange={(e) => setIncludeAll(e.target.checked)}
            style={S.checkbox}
          />
          Include datasets that have stopped
        </label>

        <div style={T.spacer} />
        <span style={{ fontSize: 11, color: COLOR.dim }}>
          {busy ? 'Searching' : results.length ? `${results.length} found` : ''}
        </span>
      </div>

      {error && <p style={{ ...T.desc, color: COLOR.bad }}>{error}</p>}

      {term.length >= 2 && !busy && data?.query === term && !results.length && (
        <p style={S.quiet}>Nothing matched. Try fewer words, or a term the publisher would use.</p>
      )}

      {results.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'auto', paddingRight: 8 }}>
          <table style={{ ...T.table, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={S.stickyTh}>Dataset</th>
                <th style={S.stickyTh}>Topic</th>
                <th style={{ ...S.stickyTh, textAlign: 'right' }}>Updated</th>
                <th style={{ ...S.stickyTh, textAlign: 'right' }}> </th>
              </tr>
            </thead>
            <tbody>
              {results.map((f) => (
                <tr key={f.ref}>
                  <td style={{ ...T.td, color: COLOR.ink }}>
                    {f.name}
                    <span style={S.subId}>
                      {f.id}
                      {/* a dataset matching only some of the words is still
                          worth offering, but not worth mistaking for a hit */}
                      {f.partial && <span style={{ color: COLOR.ca }}> partial match</span>}
                    </span>
                  </td>
                  <td style={{ ...T.td, color: COLOR.dim }}>{f.topics.slice(1).join(', ') || f.topics[0] || 'n/a'}</td>
                  <td
                    style={{ ...T.td, textAlign: 'right', color: f.stale ? COLOR.bad : COLOR.dim }}
                  >
                    {f.updated ? f.updated.slice(0, 10) : 'n/a'}
                    {f.stale && <span style={S.staleTag}>stopped</span>}
                  </td>
                  <td style={{ ...T.td, textAlign: 'right' }}>
                    <button
                      style={{
                        ...T.control,
                        ...S.small,
                        ...(f.probeBlocked ? T.controlOff : {}),
                      }}
                      onClick={() => open(f.ref)}
                      title={
                        f.probeBlocked
                          ? 'OECD will not answer a dimension probe on a dataset this large'
                          : undefined
                      }
                    >
                      {opening === f.ref ? 'opening' : 'choose'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {flow && (
        <div style={S.picker}>
          <h3 style={{ ...T.h2, fontSize: 14 }}>{flow.name}</h3>
          <p style={T.desc}>
            Pick one option from each list. Only combinations OECD publishes are reachable.
          </p>

          <div style={S.dims}>
            {flow.dimensions.map((d, i) => (
              <label key={d.id} style={S.dim}>
                <span style={S.dimName}>{d.name}</span>
                {d.values.length === 1 ? (
                  <span style={S.fixed}>{d.values[0].name}</span>
                ) : (
                  <select
                    value={picks[i] ?? d.values[0].id}
                    onChange={(e) => choose(i, e.target.value)}
                    style={{ ...T.input, width: '100%' }}
                  >
                    {d.values.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>

          <div style={S.showRow}>
            <span style={{ fontSize: 11.5, color: COLOR.dim }}>
              {combo
                ? `Last print ${combo.last ?? 'n/a'}, ${combo.areas.length} of the probed countries report it`
                : 'That combination is not published'}
            </span>
            <div style={T.spacer} />
            <button
              style={{ ...T.control, ...S.small }}
              onClick={() => {
                setFlow(null);
                setPicks([]);
              }}
            >
              Close
            </button>
            <button
              style={{
                ...T.control,
                ...T.controlPrimary,
                ...(!combo || onChart ? T.controlOff : {}),
              }}
              onClick={() => onShow({ flow: flow.ref, key, name: flow.name })}
            >
              {onChart ? 'on chart' : 'Show on chart'}
            </button>
          </div>
        </div>
      )}

      {/* OECD allows sixty requests an hour from one address, so the desk says
          how many it has spent rather than letting a search fail unexplained */}
      {budget && budget.used > 0 && (
        <p style={{ ...S.quiet, marginTop: 12 }}>
          {budget.used} of {budget.ceiling} OECD requests used this hour
          {budget.blockedFor > 0 ? `, blocked for ${budget.blockedFor} more minutes` : ''}
        </p>
      )}
    </section>
  );
}

export default memo(OecdSearch);

const S: Record<string, CSSProperties> = {
  stickyTh: { ...T.th, position: 'sticky', top: 0, zIndex: 1, background: COLOR.panel },
  subId: { display: 'block', fontSize: 10.5, color: COLOR.dim },
  staleTag: { display: 'block', fontSize: 10, color: COLOR.bad },
  small: { fontSize: 11, padding: '3px 9px' },
  quiet: { fontSize: 12, color: COLOR.dim },
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
  picker: { marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLOR.hair}` },
  dims: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
    gap: 10,
    marginBottom: 12,
  },
  dim: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
  dimName: { fontSize: 10.5, color: COLOR.dim },
  fixed: { fontSize: 12.5, color: COLOR.ink, padding: '6px 0' },
  showRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
};
