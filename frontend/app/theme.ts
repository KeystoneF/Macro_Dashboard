import type { CSSProperties } from 'react';

// Single source for the design system. Palette is the one specified in the
// design doc: primary #1aa897, secondary #2e4151.

export const FONT = {
  display: '"Times New Roman", Times, serif',
  body: 'Cambria, "Hoefler Text", Constantia, Georgia, serif',
};

export const COLOR = {
  bg: '#1B2530',      // secondary, darkened for the page field
  panel: '#2E4151',   // secondary as specified
  panel2: '#384C5E',
  hair: '#3A4E60',
  line: '#475C6F',
  ink: '#E8EDF1',
  dim: '#93A6B5',
  accent: '#1AA897',  // primary as specified
  accentLt: '#5FD8C6',
  onAccent: '#0F1D18', // ink for text sitting on an accent fill
  onHeat: '#0E1A16',   // ink for labels sitting on a heatmap tile
  ca: '#E8825E',      // series colours chosen to separate cleanly on slate
  us: '#5BC0B0',
  good: '#4FB79E',
  bad: '#E0645F',
};

// The move colours as channels, for a fill mixed or washed at runtime.
export const RGB = {
  good: [79, 183, 158],
  bad: [224, 100, 95],
  panel2: [56, 76, 94],
};

// Series line colours, in the order a chart assigns them.
export const PLOT = [COLOR.us, COLOR.ca, COLOR.accent, '#B7A3D8', '#D8C48A'];

// Reserve distinct hues for peer countries.
export const PEER = {
  violet: '#A78BD0',
  amber: '#DBC26E',
  blue: '#7FA9D9',
  rose: '#DB8CC0',
  green: '#8FBF87',
};

export const RADIUS = { card: 9, control: 6 };

// Separate background color and image so variants do not reset both.
export const card: CSSProperties = {
  backgroundColor: COLOR.panel,
  // a light top edge, the same finish the heatmap tiles carry. Shallow enough
  // that it reads as a face on the panel rather than as a gradient fill.
  backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,.048), rgba(255,255,255,0) 46%)',
  border: `1px solid ${COLOR.line}`,
  borderRadius: RADIUS.card,
  padding: '18px 20px',
};

// Second word of the wordmark, at nav size. Flat accent: a glow on an 18px
// glyph turns to mush.
export const wordmarkAccent: CSSProperties = {
  color: COLOR.accent,
};

// Splash wordmark treatment for login and status.
export const wordmarkGlass: CSSProperties = {
  background:
    'linear-gradient(155deg, rgba(214,250,242,.95), rgba(26,168,151,.72) 58%, rgba(120,225,208,.88))',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
  WebkitTextStroke: '.5px rgba(175,240,228,.28)',
  filter:
    'drop-shadow(0 1px 0 rgba(255,255,255,.13)) drop-shadow(0 0 22px rgba(26,168,151,.50))',
};

// paired with .desk-page in globals.css, which tightens the padding on a narrow
// window where 28px a side is a meaningful share of the width
export const page: CSSProperties = {
  minHeight: '100%',
  background: COLOR.bg,
  color: COLOR.ink,
  padding: '26px 28px 40px',
  fontFamily: FONT.body,
  fontVariantNumeric: 'tabular-nums',
};

export const wordmark: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 700,
  fontStyle: 'italic',
  fontSize: 25,
  margin: 0,
};

export const sub: CSSProperties = {
  fontSize: 12,
  color: COLOR.dim,
  margin: '4px 0 0',
};

export const h2: CSSProperties = {
  fontFamily: FONT.display,
  fontWeight: 700,
  fontStyle: 'italic',
  fontSize: 16,
  margin: '0 0 2px',
};

export const desc: CSSProperties = {
  fontSize: 12,
  color: COLOR.dim,
  margin: '0 0 14px',
};

// Longhand borders throughout: the -On variants below override borderColor alone,
// and mixing shorthand with longhand triggers a React warning at runtime.
export const control: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: 12.5,
  padding: '6px 12px',
  borderRadius: RADIUS.control,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: COLOR.line,
  background: 'transparent',
  color: COLOR.dim,
  cursor: 'pointer',
  textDecoration: 'none',
};

// Scroll wide tables within their panels.
export const scrollX: CSSProperties = {
  overflowX: 'auto',
  // room for the scrollbar so it does not sit on the last row
  paddingBottom: 2,
};

// Collapse two-column panels when space runs out.
export const splitWide: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
  gap: 16,
};

export const controlOn: CSSProperties = {
  color: COLOR.ink,
  borderColor: COLOR.accent,
  background: 'rgba(26,168,151,.13)',
};

// Filled accent variant, for the one action on a page that is the point of it.
export const controlPrimary: CSSProperties = {
  background: COLOR.accent,
  borderColor: COLOR.accent,
  color: COLOR.onAccent,
  fontWeight: 600,
};

export const controlOff: CSSProperties = {
  opacity: 0.45,
  pointerEvents: 'none',
};

export const input: CSSProperties = {
  fontFamily: FONT.body,
  fontSize: 12.5,
  padding: '6px 9px',
  borderRadius: RADIUS.control,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: COLOR.line,
  background: COLOR.panel2,
  color: COLOR.ink,
  colorScheme: 'dark', // otherwise the date picker renders its own light chrome
};

export const controls: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  marginBottom: 12,
  flexWrap: 'wrap',
};

export const divider: CSSProperties = {
  width: 1,
  height: 18,
  background: COLOR.line,
  margin: '0 4px',
};

export const spacer: CSSProperties = { flex: 1 };

export const cardHead: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 10,
};

export const readout: CSSProperties = {
  display: 'flex',
  gap: 12,
  fontSize: 12,
  color: COLOR.dim,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12.5,
};

export const th: CSSProperties = {
  textAlign: 'left',
  color: COLOR.dim,
  fontWeight: 400,
  fontSize: 11,
  borderBottom: `1px solid ${COLOR.line}`,
  padding: '0 0 6px',
};

export const td: CSSProperties = {
  padding: '8px 0',
  borderBottom: `1px solid ${COLOR.hair}`,
};
