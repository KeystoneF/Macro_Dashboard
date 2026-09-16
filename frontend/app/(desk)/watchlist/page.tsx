'use client';

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import * as T from '../../theme';
import { COLOR } from '../../theme';
import { getJson } from '../../lib/api';
import { useNavRefresh } from '../../lib/navRefresh';

type List = { id: string; name: string; description: string; tags: string[]; count: number | null };
type Company = { id: string; symbol: string; name: string; price: number | null; day: number | null; week: number | null; month: number | null; ytd: number | null; year: number | null; quotedAt: string | null; period: string | null; revenue: number | null; eps: number | null };
type News = { id: string; symbol: string; company: string; title: string; published: string; category: string; publisher: string; url: string | null };
type Earning = { symbol: string; name: string; date: string; epsEstimated: number | null; epsActual: number | null };
type Event = { date: string; country: string; event: string; impact: string; unit: string; actual: number | null; estimate: number | null; previous: number | null };
type Data<R> = { rows: R[]; total?: number; coverage?: number; page?: number; pages?: number; warnings?: string[]; fetchedAt: string };
type Filters = { categories: string[]; exchanges: string[]; publishers: string[]; companies: { id: string; name: string; symbol: string }[] };

// Key responses by URL so old data cannot appear under a new watchlist name.
function useData<D>(url: string | null, revision: number) {
  const key = `${url}:${revision}`;
  const [result, setResult] = useState<{ key: string; url: string; data?: D; error?: string } | null>(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    getJson<D>(url, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setResult({ key, url, data }); },
      (err) => { if (!controller.signal.aborted) setResult({ key, url, error: err.message }); },
    );
    return () => controller.abort();
  }, [url, key]);
  return { data: result?.url === url ? result?.data : undefined, error: result?.key === key ? result.error : undefined, loading: !!url && result?.key !== key };
}
function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setDebounced(value), 300); return () => clearTimeout(timer); }, [value]);
  return debounced;
}
const query = (values: Record<string, string | number>) => new URLSearchParams(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)])).toString();
const number = (v: number | null) => v == null ? 'n/a' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 });
const dateAt = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const time = (v: string | null) => v ? v.replace('T', ' ').slice(0, 16) : 'n/a';
const button: CSSProperties = { ...T.control, minHeight: 40, whiteSpace: 'nowrap' };
const btn = (off: boolean): CSSProperties => off ? { ...button, ...T.controlOff } : button;
const field: CSSProperties = { ...T.input, minHeight: 40, maxWidth: '100%' };
const panel: CSSProperties = { ...T.card, minWidth: 0, marginBottom: 18 };
const head: CSSProperties = { ...T.cardHead, flexWrap: 'wrap' };
const th: CSSProperties = { ...T.th, whiteSpace: 'nowrap', padding: '0 12px 6px 0' };
const td: CSSProperties = { ...T.td, whiteSpace: 'nowrap', paddingRight: 12, verticalAlign: 'top' };
const rowHead: CSSProperties = { ...td, textAlign: 'left', fontWeight: 400 };
const companyName: CSSProperties = { display: 'block', whiteSpace: 'normal', minWidth: 150, maxWidth: 230, marginTop: 3, lineHeight: 1.4 };
const link: CSSProperties = { color: COLOR.ink, textDecoration: 'underline', textDecorationColor: COLOR.line, textUnderlineOffset: 3 };
const filterGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 };

function Label({ text, children }: { text: string; children: ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, minWidth: 0 }}>{text}{children}</label>;
}
function Status({ loading, error, retry, empty }: { loading: boolean; error?: string; retry: () => void; empty?: boolean }) {
  if (error) return <div role="alert" style={{ padding: '14px 0' }}><p style={{ marginBottom: 8 }}>{error}</p><button style={button} onClick={retry}>Try again</button></div>;
  if (loading) return <p role="status" style={{ padding: '18px 0', color: COLOR.dim }}>Loading</p>;
  if (empty) return <p style={{ padding: '18px 0', color: COLOR.dim }}>No results for this selection.</p>;
  return null;
}
function Pager({ data, page, setPage, name }: { data?: { total?: number; pages?: number }; page: number; setPage: (p: number) => void; name: string }) {
  const pages = data?.pages || 0;
  return <div style={{ ...T.controls, marginTop: 14, marginBottom: 0 }}><span style={{ fontSize: 12, color: COLOR.dim }}>{data ? `${data.total ?? 0} results · Page ${pages ? page : 0} of ${pages}` : ' '}</span><div style={T.spacer} />
    <button aria-label={`Previous ${name} page`} style={btn(!data || page <= 1)} disabled={!data || page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
    <button aria-label={`Next ${name} page`} style={btn(!data || page >= pages)} disabled={!data || page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>;
}
function Export({ url, name, enabled, page = false }: { url: string; name: string; enabled: boolean; page?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}format=csv`, { credentials: 'same-origin', signal: AbortSignal.timeout(120_000) });
      if (response.status === 401) { window.location.replace('/login'); return; }
      if (!response.ok) throw new Error((await response.json()).error || 'Download failed. Try again.');
      const objectUrl = URL.createObjectURL(await response.blob());
      const a = document.createElement('a'); a.href = objectUrl; a.download = `watchlist-${name}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Download failed. Try again.'); }
    finally { setBusy(false); }
  }
  return <div><button style={btn(!enabled || busy)} disabled={!enabled || busy} onClick={download} aria-label={`Download ${name} CSV`}>{busy ? 'Downloading' : page ? 'CSV · this page' : 'Download CSV'}</button>{error && <p role="alert" style={{ fontSize: 12 }}>{error}</p>}</div>;
}
function Change({ value }: { value: number | null }) {
  return <span style={{ color: value == null ? COLOR.dim : value < 0 ? COLOR.bad : value > 0 ? COLOR.accentLt : COLOR.ink }}>{value == null ? 'n/a' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`}</span>;
}
function Table({ label, heads, children }: { label: string; heads: string[]; children: ReactNode }) {
  return <div style={T.scrollX} role="region" aria-label={label} tabIndex={0}><table style={{ ...T.table, fontSize: 13 }}><thead><tr>{heads.map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export default function WatchlistPage() {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useNavRefresh('watchlist', refresh);
  const lists = useData<Data<List>>('/api/watchlists', revision);
  const [selection, setSelection] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [tag, setTag] = useState('');
  const visible = (lists.data?.rows || []).filter((r) => (!tag || r.tags.includes(tag)) && `${r.name} ${r.tags.join(' ')}`.toLowerCase().includes(listQuery.toLowerCase()));
  const selected = visible.find((r) => r.id === selection) || visible[0];
  const tags = [...new Set((lists.data?.rows || []).flatMap((r) => r.tags))].sort();
  return <main className="desk-page" style={T.page}>
    <header style={{ ...T.cardHead, marginBottom: 20 }}><div><h1 style={T.wordmark}>Watchlist &amp; Calendar</h1><p style={T.sub}>Company releases, price changes and the dates ahead</p></div><button style={button} onClick={refresh}>Refresh</button></header>
    <section aria-label="Watchlist selection" style={panel}>
      <div style={{ ...T.controls, alignItems: 'end', gap: 12 }}>
        <Label text="Find a watchlist"><input style={field} type="search" placeholder="Name or tag" value={listQuery} onChange={(e) => setListQuery(e.target.value)} /></Label>
        <Label text="Tag"><select style={field} value={tag} onChange={(e) => setTag(e.target.value)}><option value="">All tags</option>{tags.map((t) => <option key={t}>{t}</option>)}</select></Label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 260px', minWidth: 0, fontSize: 12 }}>Watchlist<select style={{ ...field, width: '100%' }} value={selected?.id || ''} onChange={(e) => setSelection(e.target.value)} disabled={!visible.length}><option value="" disabled>Select a watchlist</option>{visible.map((r) => <option key={r.id} value={r.id}>{r.name}{r.count === null ? '' : ` (${r.count})`}</option>)}</select></label>
      </div>
      <Status {...lists} retry={refresh} empty={!!lists.data && !visible.length} />
      {selected && <p style={{ ...T.desc, marginBottom: 0 }}>{selected.description || selected.name}{selected.tags.length ? ` · ${selected.tags.join(' / ')}` : ''} · {selected.count === null ? 'company count not published' : `${selected.count} companies in KeyStocks`}</p>}
    </section>
    {selected && <Watchlist key={selected.id} list={selected} revision={revision} refresh={refresh} />}
    <Calendar revision={revision} refresh={refresh} />
    <footer style={{ ...T.desc, borderTop: `1px solid ${COLOR.line}`, paddingTop: 14 }}>Lists and releases from KeyStocks, prices and calendars from FMP. Cached up to five minutes. Earnings dates can move.</footer>
  </main>;
}

function Watchlist({ list, revision, refresh }: { list: List; revision: number; refresh: () => void }) {
  const [report, setReport] = useState('ttm');
  const [companyQuery, setCompanyQuery] = useState('');
  const search = useDebounced(companyQuery);
  const [page, setPage] = useState(1);
  const [days, setDays] = useState('30');
  const companyUrl = `/api/watchlists/${list.id}/companies?${query({ report, q: search, page })}`;
  const earningsUrl = `/api/watchlists/${list.id}/earnings?days=${days}`;
  const companies = useData<Data<Company>>(companyUrl, revision);
  const earnings = useData<Data<Earning>>(earningsUrl, revision);
  const reportName = report === 'ttm' ? 'TTM' : report === 'quarter' ? 'quarterly' : 'annual';
  return <>
    <section style={panel} aria-labelledby="companies-title">
      <div style={head}><div><h2 id="companies-title" style={T.h2}>Companies &amp; performance</h2><p style={T.desc}>Prices in listing currency · Returns in percent · Financials in reported currency</p></div><Export url={companyUrl} name="companies" enabled={!!companies.data?.rows.length} page /></div>
      <div style={{ ...T.controls, alignItems: 'end', gap: 12 }}><Label text="Search companies"><input style={field} type="search" placeholder="Company or ticker" value={companyQuery} onChange={(e) => { setCompanyQuery(e.target.value); setPage(1); }} /></Label><Label text="Financial period"><select style={field} value={report} onChange={(e) => { setReport(e.target.value); setPage(1); }}><option value="ttm">Trailing twelve months</option><option value="annual">Annual</option><option value="quarter">Quarterly</option></select></Label></div>
      <Status {...companies} retry={refresh} empty={!!companies.data && !companies.data.rows.length} />
      {companies.data?.warnings?.map((w) => <p key={w} role="status" style={T.desc}>{w}</p>)}
      {companies.data && list.count !== null && companies.data.coverage !== list.count && <p style={T.desc}>{companies.data.coverage} of {list.count} listed companies have {reportName} figures.</p>}
      {!!companies.data?.rows.length && <Table label="Company prices and returns" heads={['Company / ticker', 'Price', '1D', '1W', '1M', 'YTD', '1Y', 'Quote time (UTC)', 'Financial period', 'Revenue', 'EPS']}>
        {companies.data.rows.map((r) => <tr key={r.id}><th scope="row" style={rowHead}><span style={{ display: 'block', color: COLOR.accentLt }}>{r.symbol || 'No ticker'}</span><span style={companyName}>{r.name}</span></th><td style={td}>{number(r.price)}</td>{(['day', 'week', 'month', 'ytd', 'year'] as const).map((k) => <td key={k} style={td}><Change value={r[k]} /></td>)}<td style={td}>{time(r.quotedAt)}</td><td style={td}>{r.period || 'n/a'}</td><td style={td}>{number(r.revenue)}</td><td style={td}>{number(r.eps)}</td></tr>)}
      </Table>}
      <Pager data={companies.data} page={page} setPage={setPage} name="companies" />
    </section>
    <div style={T.splitWide}>
      <NewsPanel id={list.id} revision={revision} refresh={refresh} />
      <section style={panel} aria-labelledby="earnings-title">
        <div style={head}><div><h2 id="earnings-title" style={T.h2}>Upcoming earnings</h2><p style={T.desc}>Across this watchlist · FMP estimates</p></div><Export url={earningsUrl} name="earnings" enabled={!!earnings.data?.rows.length} /></div>
        <Label text="Earnings horizon"><select style={field} value={days} onChange={(e) => setDays(e.target.value)}>{[7, 30, 90].map((d) => <option key={d} value={d}>Next {d} days</option>)}</select></Label>
        <Status {...earnings} retry={refresh} empty={!!earnings.data && !earnings.data.rows.length} />
        {earnings.data && <p style={{ ...T.desc, marginTop: 10 }}>Matched {earnings.data.coverage}{list.count == null ? '' : ` of ${list.count}`} companies. A company with no row has no FMP date in this window.</p>}
        {!!earnings.data?.rows.length && <div style={{ maxHeight: 640, overflowY: 'auto' }}><Table label="Upcoming earnings estimates" heads={['Date', 'Company', 'EPS est.', 'EPS actual']}>
          {earnings.data.rows.map((r) => <tr key={`${r.symbol}:${r.date}`}><td style={td}>{r.date}</td><th scope="row" style={rowHead}><span style={{ color: COLOR.accentLt }}>{r.symbol}</span><span style={companyName}>{r.name}</span></th><td style={td}>{number(r.epsEstimated)}</td><td style={td}>{number(r.epsActual)}</td></tr>)}
        </Table></div>}
      </section>
    </div>
  </>;
}

function NewsPanel({ id, revision, refresh }: { id: string; revision: number; refresh: () => void }) {
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ from: dateAt(-30), to: dateAt(0), region: '', category: '', exchange: '', publisher: '', company: '' });
  const change = (key: keyof typeof filters, value: string) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const choices = useData<Filters>(`/api/watchlists/${id}/filters`, revision);
  const valid = !!filters.from && !!filters.to && filters.from <= filters.to;
  const url = `/api/watchlists/${id}/news?${query({ ...filters, q, page })}`;
  const news = useData<Data<News>>(valid ? url : null, revision);
  return <section style={panel} aria-labelledby="releases-title">
    <div style={head}><div><h2 id="releases-title" style={T.h2}>News releases</h2><p style={T.desc}>Watchlist companies · Newest first</p></div><Export url={url} name="news" enabled={valid && !!news.data?.rows.length} page /></div>
    <Label text="Search releases"><input style={field} type="search" placeholder="Search company news" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></Label>
    <div style={{ ...T.controls, marginTop: 12, gap: 12, alignItems: 'end' }}><Label text="From"><input style={field} type="date" value={filters.from} onChange={(e) => change('from', e.target.value)} /></Label><Label text="To"><input style={field} type="date" value={filters.to} onChange={(e) => change('to', e.target.value)} /></Label><Label text="Region"><select style={field} value={filters.region} onChange={(e) => change('region', e.target.value)}><option value="">Canada &amp; US</option><option value="canadian">Canada</option><option value="us">United States</option></select></Label></div>
    <details style={{ marginBottom: 12 }}><summary style={{ cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>More news filters</summary><Status {...choices} retry={refresh} />
      <div style={filterGrid}>{(['category', 'exchange', 'publisher'] as const).map((key) => {
        const values = key === 'category' ? choices.data?.categories : key === 'exchange' ? choices.data?.exchanges : choices.data?.publishers;
        return <Label key={key} text={key[0].toUpperCase() + key.slice(1)}><select style={field} value={filters[key]} onChange={(e) => change(key, e.target.value)} disabled={!choices.data}><option value="">All</option>{values?.map((v) => <option key={v}>{v}</option>)}</select></Label>;
      })}<Label text="Company"><select style={field} value={filters.company} onChange={(e) => change('company', e.target.value)} disabled={!choices.data}><option value="">All companies</option>{choices.data?.companies.map((c) => <option value={c.id} key={c.id}>{c.symbol} · {c.name}</option>)}</select></Label></div>
    </details>
    {!valid && <p role="alert">Start date must be on or before the end date.</p>}
    <Status {...news} retry={refresh} empty={!!news.data && !news.data.rows.length} />
    <div style={{ maxHeight: 680, overflowY: 'auto' }}>{news.data?.rows.map((r) => <article key={r.id} style={{ padding: '14px 0', borderTop: `1px solid ${COLOR.hair}` }}><p style={{ ...T.desc, marginBottom: 5 }}><span style={{ color: COLOR.accentLt }}>{r.symbol}</span> · {r.company}</p><h3 style={{ fontSize: 15, lineHeight: 1.45, fontWeight: 600, marginBottom: 5 }}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={link}>{r.title}</a> : r.title}</h3><p style={{ ...T.desc, marginBottom: 0 }}>{r.publisher} · {r.category} · {r.published ? `${time(r.published)} UTC` : 'n/a'}</p></article>)}</div>
    <Pager data={news.data} page={page} setPage={setPage} name="news" />
  </section>;
}

function Calendar({ revision, refresh }: { revision: number; refresh: () => void }) {
  const [from, setFrom] = useState(() => dateAt(0));
  const [to, setTo] = useState(() => dateAt(6));
  const [country, setCountry] = useState('all');
  const valid = !!from && !!to && from <= to && Date.parse(to) - Date.parse(from) <= 31 * 864e5;
  const url = `/api/watchlists/calendar?${query({ from, to, country })}`;
  const calendar = useData<Data<Event>>(valid ? url : null, revision);
  return <section style={panel} aria-labelledby="calendar-title">
    <div style={head}><div><h2 id="calendar-title" style={T.h2}>Economic release calendar</h2><p style={T.desc}>Canada &amp; United States · Times in UTC · FMP</p></div><Export url={url} name="calendar" enabled={valid && !!calendar.data?.rows.length} /></div>
    <div style={{ ...T.controls, alignItems: 'end', gap: 12 }}><Label text="Calendar from"><input style={field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Label><Label text="Calendar to"><input style={field} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Label><Label text="Country"><select style={field} value={country} onChange={(e) => setCountry(e.target.value)}><option value="all">Canada &amp; US</option><option value="CA">Canada</option><option value="US">United States</option></select></Label></div>
    {!valid && <p role="alert">Choose a date range of up to 31 days, start on or before the end.</p>}
    <Status {...calendar} retry={refresh} empty={!!calendar.data && !calendar.data.rows.length} />
    {!!calendar.data?.rows.length && <div style={{ maxHeight: 520, overflowY: 'auto' }}><Table label="Economic releases" heads={['Date / time (UTC)', 'Country', 'Release', 'Impact', 'Actual', 'Estimate', 'Previous', 'Unit']}>
      {calendar.data.rows.map((r, i) => <tr key={`${r.date}:${r.event}:${i}`}><td style={td}>{r.date.slice(0, 16)}</td><td style={td}>{r.country}</td><th scope="row" style={{ ...rowHead, whiteSpace: 'normal', minWidth: 220 }}>{r.event}</th><td style={td}>{r.impact}</td><td style={td}>{number(r.actual)}</td><td style={td}>{number(r.estimate)}</td><td style={td}>{number(r.previous)}</td><td style={td}>{r.unit}</td></tr>)}
    </Table></div>}
  </section>;
}
