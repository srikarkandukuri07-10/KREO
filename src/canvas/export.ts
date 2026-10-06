import type { KreoElement } from '../types';
import { contentBounds } from '../lib/geometry';

/** Export helpers: PNG / SVG / PDF / JSON / clipboard. */

export function elementsToSVG(
  elements: KreoElement[],
  opts: { background: string; padding?: number },
): string {
  const pad = opts.padding ?? 40;
  const b = contentBounds(elements);
  const vx = (b?.x ?? -400) - pad;
  const vy = (b?.y ?? -300) - pad;
  const vw = Math.max(200, (b?.w ?? 800) + pad * 2);
  const vh = Math.max(200, (b?.h ?? 600) + pad * 2);

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const dash = (el: { strokeStyle: string }) =>
    el.strokeStyle === 'dashed' ? ' stroke-dasharray="10 7"' : el.strokeStyle === 'dotted' ? ' stroke-dasharray="2 6"' : '';
  const fill = (f: string) => (f === 'transparent' ? 'none' : esc(f));

  let body = '';
  for (const el of elements) {
    const op = (el.opacity ?? 100) / 100;
    const tr = el.rotation ? ` transform="rotate(${el.rotation} ${(el.x + el.w / 2).toFixed(1)} ${(el.y + el.h / 2).toFixed(1)})"` : '';
    switch (el.type) {
      case 'rect':
        body += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${Math.round(el.roundness * 12)}" fill="${fill(el.fill)}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" opacity="${op}"${dash(el)}${tr}/>`;
        break;
      case 'diamond': {
        const pts = `${el.x + el.w / 2},${el.y} ${el.x + el.w},${el.y + el.h / 2} ${el.x + el.w / 2},${el.y + el.h} ${el.x},${el.y + el.h / 2}`;
        body += `<polygon points="${pts}" fill="${fill(el.fill)}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" opacity="${op}"${dash(el)}${tr}/>`;
        break;
      }
      case 'ellipse':
        body += `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${Math.abs(el.w / 2)}" ry="${Math.abs(el.h / 2)}" fill="${fill(el.fill)}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" opacity="${op}"${dash(el)}${tr}/>`;
        break;
      case 'line':
        body += `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.w}" y2="${el.y + el.h}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" opacity="${op}"${dash(el)}${tr}/>`;
        break;
      case 'arrow': {
        const x2 = el.x + el.w, y2 = el.y + el.h;
        const ang = Math.atan2(el.h, el.w);
        const size = 10 + el.strokeWidth * 2.2;
        let heads = '';
        const head = (tx: number, ty: number, a: number) => {
          const a1 = a + Math.PI * 0.82, a2 = a - Math.PI * 0.82;
          return `<line x1="${tx}" y1="${ty}" x2="${tx + Math.cos(a1) * size}" y2="${ty + Math.sin(a1) * size}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}"/><line x1="${tx}" y1="${ty}" x2="${tx + Math.cos(a2) * size}" y2="${ty + Math.sin(a2) * size}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}"/>`;
        };
        if (el.endArrow !== false) heads += head(x2, y2, ang);
        if (el.startArrow) heads += head(el.x, el.y, ang + Math.PI);
        body += `<line x1="${el.x}" y1="${el.y}" x2="${x2}" y2="${y2}" stroke="${esc(el.stroke)}" stroke-width="${el.strokeWidth}" opacity="${op}"${dash(el)}${tr}/>${heads}`;
        break;
      }
      case 'pen': {
        if (!el.points.length) break;
        const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        body += `<path d="${d}" fill="none" stroke="${esc(el.stroke)}" stroke-width="${Math.max(1, el.strokeWidth * 1.4)}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"${dash(el)}/>`;
        break;
      }
      case 'text': {
        const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
        const ax = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
        const fw = el.bold ? '700' : '400';
        const fs = el.italic ? 'italic' : 'normal';
        const lines = esc(el.text).split('\n');
        const lh = el.fontSize * el.lineHeight;
        const tspans = lines.map((ln, i) => `<tspan x="${ax}" dy="${i === 0 ? 0 : lh}">${ln || ' '}</tspan>`).join('');
        body += `<text x="${ax}" y="${el.y + el.fontSize * 0.9}" font-family="${esc(el.fontFamily)}" font-size="${el.fontSize}" font-weight="${fw}" font-style="${fs}" text-anchor="${anchor}" fill="${esc(el.stroke)}" opacity="${op}"${tr}>${tspans}</text>`;
        break;
      }
      case 'image':
        body += `<image href="${el.src}" x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" opacity="${op}" preserveAspectRatio="none"/>`;
        break;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${esc(opts.background)}"/>${body}</svg>`;
}

export function downloadFile(name: string, content: string | Blob, mime?: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}

/** Render elements to an offscreen canvas (for PNG/PDF/clipboard). Returns canvas. */
export async function renderToCanvas(
  elements: KreoElement[],
  background: string,
  scale = 2,
): Promise<HTMLCanvasElement> {
  const { renderScene } = await import('./renderer');
  const b = contentBounds(elements);
  const pad = 40;
  const x = (b?.x ?? -400) - pad;
  const y = (b?.y ?? -300) - pad;
  const w = Math.max(200, (b?.w ?? 800) + pad * 2);
  const h = Math.max(200, (b?.h ?? 600) + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(8192, Math.round(w * scale));
  canvas.height = Math.min(8192, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  const zoom = canvas.width / w;
  ctx.scale(1, 1);
  // prime image cache
  const cache = new Map<string, HTMLImageElement>();
  await Promise.all(
    elements.filter((e) => e.type === 'image').map(
      (e) =>
        new Promise<void>((res) => {
          const img = new Image();
          img.onload = () => { cache.set(e.id, img); res(); };
          img.onerror = () => res();
          img.src = (e as any).src;
        }),
    ),
  );
  renderScene(ctx, elements, { grid: false, gridSize: 24, background }, cache, 1, canvas.width, canvas.height, x, y, zoom);
  return canvas;
}

export async function exportPNG(elements: KreoElement[], background: string, name: string) {
  const canvas = await renderToCanvas(elements, background, 2);
  canvas.toBlob((blob) => {
    if (blob) downloadFile(`${name}.png`, blob);
  }, 'image/png');
}

export async function copyImageToClipboard(elements: KreoElement[], background: string): Promise<boolean> {
  try {
    const canvas = await renderToCanvas(elements, background, 2);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function exportPDF(elements: KreoElement[], background: string, name: string) {
  const { jsPDF } = await import('jspdf');
  const canvas = await renderToCanvas(elements, background, 2);
  const img = canvas.toDataURL('image/png');
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [canvas.width, canvas.height],
    hotfixes: ['px_scaling'],
  });
  pdf.addImage(img, 'PNG', 0, 0, canvas.width, canvas.height);
  pdf.save(`${name}.pdf`);
}
