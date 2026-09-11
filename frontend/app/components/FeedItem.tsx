import type { CSSProperties } from 'react';
import { COLOR, PLOT } from '../theme';

export type Item = {
  id: string;
  source: string;
  feedId: string;
  country: 'CA' | 'US';
  category: string;
  title: string;
  link: string;
  published: string;
  summary: string;
  publisher: string | null;
};

export const SOURCE_COLOR: Record<string, string> = {
  CNBC: COLOR.us,
  FMP: PLOT[3],
  StatCan: COLOR.ca,
  'Bank of Canada': COLOR.accent,
};

// One headline, on the news module and in the brief. The summary is dropped
// where the brief runs two lists in one column.
export default function FeedItem({ item, summary = true }: { item: Item; summary?: boolean }) {
  return (
    <a href={item.link} target="_blank" rel="noreferrer noopener" style={S.item}>
      <div style={S.itemHead}>
        <span
          style={{
            ...S.badge,
            color: SOURCE_COLOR[item.source] ?? COLOR.dim,
            borderColor: SOURCE_COLOR[item.source] ?? COLOR.line,
          }}
        >
          {item.source}
        </span>
        <span style={S.category}>{item.category}</span>
        {item.publisher && <span style={S.category}>{item.publisher}</span>}
        <span style={S.time}>{item.published.slice(11, 16)} UTC</span>
      </div>
      <div style={S.title}>{item.title}</div>
      {summary && item.summary && <div style={S.summary}>{item.summary}</div>}
    </a>
  );
}

const S: Record<string, CSSProperties> = {
  item: {
    display: 'block',
    padding: '11px 0',
    borderBottom: `1px solid ${COLOR.hair}`,
    textDecoration: 'none',
    color: 'inherit',
  },
  itemHead: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5, flexWrap: 'wrap' },
  badge: {
    fontSize: 9.5,
    letterSpacing: '.2px',
    padding: '2px 7px',
    borderRadius: 3,
    borderWidth: 1,
    borderStyle: 'solid',
    whiteSpace: 'nowrap',
  },
  category: { fontSize: 10.5, color: COLOR.dim },
  time: { fontSize: 10.5, color: COLOR.dim, marginLeft: 'auto' },
  title: { fontSize: 13.5, color: COLOR.ink, lineHeight: 1.45 },
  summary: { fontSize: 12, color: COLOR.dim, lineHeight: 1.5, marginTop: 4 },
};
