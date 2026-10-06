import rough from 'roughjs';
import type { KreoElement, Pt } from '../types';
import { smoothPoints } from '../lib/geometry';

// Cache one rough generator (cheap) — per-frame canvas wrapper is created once
// per render call to avoid re-allocating.
const generator = rough.generator();

function applyStrokeStyle(ctx: CanvasRenderingContext2D, style: string) {
  if (style === 'dashed') ctx.setLineDash([10, 7]);
  else if (style === 'dotted') ctx.setLineDash([2, 6]);
  else ctx.setLineDash([]);
}

function cssFont(el: Extract<KreoElement, { type: 'text' }>): string {
  const style = el.italic ? 'italic ' : '';
  const weight = el.bold ? '700 ' : '400 ';
  return `${style}${weight}${el.fontSize}px ${el.fontFamily}`;
}

function drawArrowHead(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, angle: number, size: number, color: string) {
  const a1 = angle + Math.PI * 0.82;
  const a2 = angle - Math.PI * 0.82;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(a1) * size, tipY + Math.sin(a1) * size);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX + Math.cos(a2) * size, tipY + Math.sin(a2) * size);
  ctx.stroke();
}

function strokePenPath(ctx: CanvasRenderingContext2D, pts: Pt[], stroke: string, width: number, style: string, opacity: number) {
  if (pts.length === 1) {
    ctx.fillStyle = stroke;
    ctx.globalAlpha = opacity / 100;
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  const s = smoothPoints(pts);
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  applyStrokeStyle(ctx, style);
  ctx.beginPath();
  ctx.moveTo(s[0].x, s[0].y);
  for (let i = 1; i < s.length - 1; i++) {
    const mx = (s[i].x + s[i + 1].x) / 2;
    const my = (s[i].y + s[i + 1].y) / 2;
    ctx.quadraticCurveTo(s[i].x, s[i].y, mx, my);
  }
  const last = s[s.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

export interface RenderOpts {
  grid: boolean;
  gridSize: number;
  background: string;
}

/** Render all elements. Caller sets transform (pan/zoom) before invoking. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  elements: KreoElement[],
  opts: RenderOpts,
  imageCache: Map<string, HTMLImageElement>,
  dpr: number,
  viewW: number,
  viewH: number,
  camX: number,
  camY: number,
  zoom: number,
) {
  ctx.save();
  // background
  ctx.fillStyle = opts.background;
  ctx.fillRect(0, 0, viewW, viewH);

  // grid dots (screen-space aligned to world grid)
  if (opts.grid) {
    const gs = opts.gridSize * zoom;
    const ox = ((-camX * zoom) % gs + gs) % gs;
    const oy = ((-camY * zoom) % gs + gs) % gs;
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    const step = Math.max(gs, 8);
    for (let x = ox; x < viewW; x += step) {
      for (let y = oy; y < viewH; y += step) {
        ctx.fillRect(x, y, 1.4, 1.4);
      }
    }
  }

  ctx.translate(-camX * zoom, -camY * zoom);
  ctx.scale(zoom, zoom);

  const rc = rough.canvas(ctx.canvas as unknown as HTMLCanvasElement);

  for (const el of elements) {
    ctx.save();
    ctx.globalAlpha = (el.opacity ?? 100) / 100;
    // rotation about bbox center
    const cx = el.type === 'line' || el.type === 'arrow'
      ? el.x + el.w / 2
      : el.type === 'pen' && el.points.length
        ? (Math.min(...el.points.map((p) => p.x)) + Math.max(...el.points.map((p) => p.x))) / 2
        : el.x + el.w / 2;
    const cy = el.type === 'line' || el.type === 'arrow'
      ? el.y + el.h / 2
      : el.type === 'pen' && el.points.length
        ? (Math.min(...el.points.map((p) => p.y)) + Math.max(...el.points.map((p) => p.y))) / 2
        : el.y + el.h / 2;
    if (el.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate((el.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    const roughMode = el.roughness > 0;
    const seed = hashStr(el.id);

    try {
      drawElement(ctx, rc, el, roughMode, seed, imageCache);
    } catch {
      // never let one bad element break the frame
    }
    ctx.restore();
  }
  ctx.restore();
  void dpr;
  void generator;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  rc: ReturnType<typeof rough.canvas>,
  el: KreoElement,
  roughMode: boolean,
  seed: number,
  imageCache: Map<string, HTMLImageElement>,
) {
  const strokeColor = el.stroke;
  const fillColor = el.fill === 'transparent' ? undefined : el.fill;
  const sw = el.strokeWidth;

  switch (el.type) {
    case 'rect': {
      if (roughMode) {
        rc.rectangle(el.x, el.y, el.w, el.h, {
          stroke: strokeColor,
          fill: fillColor,
          fillStyle: fillColor ? 'solid' : undefined,
          strokeWidth: sw,
          roughness: el.roughness * 1.2,
          seed,
        });
      } else {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        applyStrokeStyle(ctx, el.strokeStyle);
        if (fillColor) {
          ctx.fillStyle = fillColor;
          const r = Math.min(el.roundness * Math.min(el.w, el.h) * 0.2, 24);
          roundRectPath(ctx, el.x, el.y, el.w, el.h, r);
          ctx.fill();
        }
        const r = Math.min(el.roundness * Math.min(el.w, el.h) * 0.2, 24);
        ctx.beginPath();
        roundRectPath(ctx, el.x, el.y, el.w, el.h, r);
        ctx.stroke();
      }
      break;
    }
    case 'diamond': {
      const pts: [number, number][] = [
        [el.x + el.w / 2, el.y],
        [el.x + el.w, el.y + el.h / 2],
        [el.x + el.w / 2, el.y + el.h],
        [el.x, el.y + el.h / 2],
      ];
      if (roughMode) {
        rc.polygon(pts, {
          stroke: strokeColor, fill: fillColor,
          fillStyle: fillColor ? 'solid' : undefined,
          strokeWidth: sw, roughness: el.roughness * 1.2, seed,
        });
      } else {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        applyStrokeStyle(ctx, el.strokeStyle);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
        ctx.stroke();
      }
      break;
    }
    case 'ellipse': {
      if (roughMode) {
        rc.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w, el.h, {
          stroke: strokeColor, fill: fillColor,
          fillStyle: fillColor ? 'solid' : undefined,
          strokeWidth: sw, roughness: el.roughness * 1.2, seed,
        });
      } else {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        applyStrokeStyle(ctx, el.strokeStyle);
        ctx.beginPath();
        ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w) / 2, Math.abs(el.h) / 2, 0, 0, Math.PI * 2);
        if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
        ctx.stroke();
      }
      break;
    }
    case 'line': {
      if (roughMode) {
        rc.line(el.x, el.y, el.x + el.w, el.y + el.h, {
          stroke: strokeColor, strokeWidth: sw, roughness: el.roughness * 1.2, seed,
        });
      } else {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        applyStrokeStyle(ctx, el.strokeStyle);
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x + el.w, el.y + el.h);
        ctx.stroke();
      }
      break;
    }
    case 'arrow': {
      const x2 = el.x + el.w, y2 = el.y + el.h;
      if (roughMode) {
        rc.line(el.x, el.y, x2, y2, {
          stroke: strokeColor, strokeWidth: sw, roughness: el.roughness * 1.2, seed,
        });
      } else {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = sw;
        applyStrokeStyle(ctx, el.strokeStyle);
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      const ang = Math.atan2(el.h, el.w);
      const size = 10 + sw * 2.2;
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = sw;
      if (el.endArrow !== false) drawArrowHead(ctx, x2, y2, ang, size, strokeColor);
      if (el.startArrow) drawArrowHead(ctx, el.x, el.y, ang + Math.PI, size, strokeColor);
      ctx.restore();
      break;
    }
    case 'pen': {
      strokePenPath(ctx, el.points, strokeColor, Math.max(1, el.strokeWidth * 1.4), el.strokeStyle, 100);
      break;
    }
    case 'text': {
      ctx.fillStyle = el.stroke;
      ctx.font = cssFont(el);
      ctx.textBaseline = 'top';
      const lines = el.text.split('\n');
      const lh = el.fontSize * el.lineHeight;
      lines.forEach((line, i) => {
        let dx = el.x;
        if (el.align === 'center') {
          const tw = ctx.measureText(line).width;
          dx = el.x + (el.w - tw) / 2;
        } else if (el.align === 'right') {
          const tw = ctx.measureText(line).width;
          dx = el.x + el.w - tw;
        }
        ctx.fillText(line, dx, el.y + i * lh);
      });
      break;
    }
    case 'image': {
      const img = imageCache.get(el.id);
      if (img && img.complete && img.naturalWidth) {
        // draw cover-fit into rect
        ctx.drawImage(img, el.x, el.y, el.w, el.h);
      } else {
        ctx.fillStyle = '#e5e0d8';
        ctx.fillRect(el.x, el.y, el.w, el.h);
        ctx.fillStyle = '#8a857c';
        ctx.font = `12px Inter, sans-serif`;
        ctx.fillText('Loading image…', el.x + 10, el.y + 20);
      }
      break;
    }
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  const x0 = Math.min(x, x + w), y0 = Math.min(y, y + h);
  const ww = Math.abs(w), hh = Math.abs(h);
  ctx.moveTo(x0 + rr, y0);
  ctx.arcTo(x0 + ww, y0, x0 + ww, y0 + hh, rr);
  ctx.arcTo(x0 + ww, y0 + hh, x0, y0 + hh, rr);
  ctx.arcTo(x0, y0 + hh, x0, y0, rr);
  ctx.arcTo(x0, y0, x0 + ww, y0, rr);
  ctx.closePath();
}
