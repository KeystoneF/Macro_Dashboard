'use client';

// Export the rendered SVG so the PNG matches the chart.
const SVG_NS = 'http://www.w3.org/2000/svg';

// Render at 3x to keep dense ticker labels legible.
const SCALE = 3;

export function svgToPng(svg: SVGSVGElement, filename: string, background: string, font: string) {
  const box = svg.viewBox.baseVal;
  const w = box && box.width ? box.width : svg.clientWidth;
  const h = box && box.height ? box.height : svg.clientHeight;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  // the page's font comes from CSS the serialised copy does not carry
  clone.setAttribute('font-family', font);

  // the chart itself is transparent, and a transparent PNG on a light
  // background is unreadable
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(w));
  bg.setAttribute('height', String(h));
  bg.setAttribute('fill', background);
  clone.insertBefore(bg, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(SCALE, SCALE);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
}
