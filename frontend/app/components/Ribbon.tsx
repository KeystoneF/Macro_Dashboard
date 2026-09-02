'use client';

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { COLOR } from '../theme';

// The woven ribbon behind the splash pages. Strands travel near-parallel and
// weave past each other rather than crossing at steep angles, which is what
// reads as depth instead of as noise.
//
// `band` is where the stack sits vertically, as a fraction of the page: 0.905
// puts it along the bottom edge, lower numbers lift it up. Both splash pages
// take the default, on purpose: the wave should read the same on each.

const STRANDS = 18;

// COLOR.accent and COLOR.accentLt as raw channels: canvas needs them split so
// each strand can carry its own alpha.
const STRAND = '26,168,151';
const STRAND_HI = '95,216,198';

type Strand = {
  y: number; amp: number; f1: number; f2: number;
  speed: number; phase: number; alpha: number; width: number; hi: boolean;
};

const buildStrands = (band: number): Strand[] =>
  Array.from({ length: STRANDS }, (_, i) => {
    const t = i / (STRANDS - 1);
    // brightest strands sit above the middle of the stack, the rest fall away
    const depth = 1 - Math.abs(t - 0.34) * 1.55;
    return {
      y: band + t * 0.115,
      amp: 21 + t * 15,
      f1: 0.0052 + i * 0.00007,
      f2: 0.0029 + i * 0.00004,
      speed: 0.000023 + i * 0.0000016,
      phase: i * 0.17,
      alpha: Math.max(0.06, 0.1 + depth * 0.5),
      width: 0.8 + depth * 1.3,
      hi: depth > 0.68,
    };
  });

export default function Ribbon({ band = 0.905 }: { band?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const strands = buildStrands(band);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const trace = (s: Strand, t: number) => {
      const base = h * s.y;
      const ph = t * s.speed + s.phase;
      ctx.beginPath();
      for (let px = 0; px <= w; px += 3) {
        const y =
          base +
          Math.sin(px * s.f1 + ph) * s.amp +
          Math.sin(px * s.f2 - ph * 1.15) * (s.amp * 0.62);
        if (px === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';

      // volume: wash everything below the leading strand so the ribbon has a body
      trace(strands[0], t);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      const body = ctx.createLinearGradient(0, h * band, 0, h);
      body.addColorStop(0, `rgba(${STRAND},.085)`);
      body.addColorStop(1, `rgba(${STRAND},.015)`);
      ctx.fillStyle = body;
      ctx.fill();

      strands.forEach((s) => {
        trace(s, t);
        const col = s.hi ? STRAND_HI : STRAND;
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, `rgba(${col},0)`);
        grad.addColorStop(0.12, `rgba(${col},${s.alpha * 0.85})`);
        grad.addColorStop(0.5, `rgba(${col},${s.alpha})`);
        grad.addColorStop(0.88, `rgba(${col},${s.alpha * 0.85})`);
        grad.addColorStop(1, `rgba(${col},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = s.width;
        // bloom on the leading strands only, blur on all 18 is expensive
        ctx.shadowBlur = s.hi ? 13 : 0;
        ctx.shadowColor = s.hi ? `rgba(${STRAND_HI},.62)` : 'transparent';
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    };

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };

    resize();
    window.addEventListener('resize', resize);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(22000); // one static frame rather than nothing
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [band]);

  return (
    <>
      {/* the bloom travels with the strands, so lifting the band lifts both */}
      <div
        style={{ ...S.glow, top: `calc(${(band * 100).toFixed(1)}% - 60px)` }}
        aria-hidden
      />
      <canvas ref={ref} style={S.canvas} aria-hidden />
    </>
  );
}

const S: Record<string, CSSProperties> = {
  canvas: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    zIndex: 1,
    pointerEvents: 'none',
  },
  glow: {
    position: 'absolute',
    left: '-5%',
    right: '-5%',
    height: 260,
    background: `radial-gradient(ellipse at 50% 60%, rgba(26,168,151,.26), rgba(26,168,151,0) 68%)`,
    filter: 'blur(30px)',
    pointerEvents: 'none',
    zIndex: 0,
    // referenced so the accent stays tied to the palette rather than drifting
    color: COLOR.accent,
  },
};
