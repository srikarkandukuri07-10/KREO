import type { KreoElement, Pt } from '../types';

export function snapVal(v: number, grid: number, enabled: boolean): number {
  if (!enabled) return v;
  return Math.round(v / grid) * grid;
}

export function bboxOf(el: KreoElement): { x: number; y: number; w: number; h: number } {
  if (el.type === 'triangle' && el.pts?.length >= 3) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of el.pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = (el.strokeWidth || 2) / 2 + 3;
    return { x: minX - pad, y: minY - pad, w: Math.max(1, maxX - minX + pad * 2), h: Math.max(1, maxY - minY + pad * 2) };
  }
  if (el.type === 'pen') {
    const pts = el.points;
    if (!pts.length) return { x: el.x, y: el.y, w: 1, h: 1 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    const pad = (el.strokeWidth || 2) / 2 + 4;
    return { x: minX - pad, y: minY - pad, w: Math.max(1, maxX - minX + pad * 2), h: Math.max(1, maxY - minY + pad * 2) };
  }
  if (el.type === 'line' || el.type === 'arrow') {
    const x1 = el.x, y1 = el.y, x2 = el.x + el.w, y2 = el.y + el.h;
    const pad = (el.strokeWidth || 2) + 8;
    return {
      x: Math.min(x1, x2) - pad,
      y: Math.min(y1, y2) - pad,
      w: Math.abs(x2 - x1) + pad * 2,
      h: Math.abs(y2 - y1) + pad * 2,
    };
  }
  if (el.type === 'text') {
    return { x: el.x, y: el.y, w: Math.max(10, el.w), h: Math.max(10, el.h) };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function pointInPoly(px: number, py: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function unrotate(px: number, py: number, cx: number, cy: number, deg: number): Pt {
  const rad = ((-deg * Math.PI) / 180);
  const dx = px - cx, dy = py - cy;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

export function hitTest(el: KreoElement, wx: number, wy: number): boolean {
  const bb = bboxOf(el);
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
  const p = el.rotation ? unrotate(wx, wy, cx, cy, el.rotation) : { x: wx, y: wy };
  const tol = 8;
  switch (el.type) {
    case 'rect': {
      const b = bboxOf(el);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
    case 'ellipse': {
      const b = bboxOf(el);
      const rx = b.w / 2, ry = b.h / 2;
      const nx = (p.x - (b.x + rx)) / (rx + tol);
      const ny = (p.y - (b.y + ry)) / (ry + tol);
      return nx * nx + ny * ny <= 1;
    }
    case 'diamond': {
      const b = bboxOf(el);
      return pointInPoly(p.x, p.y, [
        { x: b.x + b.w / 2, y: b.y - tol },
        { x: b.x + b.w + tol, y: b.y + b.h / 2 },
        { x: b.x + b.w / 2, y: b.y + b.h + tol },
        { x: b.x - tol, y: b.y + b.h / 2 },
      ]);
    }
    case 'triangle': {
      if (el.pts?.length >= 3) {
        if (pointInPoly(p.x, p.y, el.pts)) return true;
        // near-edge counts as a hit (easier grabbing of thin triangles)
        for (let i = 0; i < el.pts.length; i++) {
          const a = el.pts[i], b2 = el.pts[(i + 1) % el.pts.length];
          if (distToSeg(p.x, p.y, a.x, a.y, b2.x, b2.y) <= tol) return true;
        }
        return false;
      }
      const b = bboxOf(el);
      return pointInPoly(p.x, p.y, [
        { x: b.x + b.w / 2, y: b.y - tol },
        { x: b.x + b.w + tol, y: b.y + b.h + tol },
        { x: b.x - tol, y: b.y + b.h + tol },
      ]);
    }
    case 'line':
    case 'arrow': {
      return distToSeg(p.x, p.y, el.x, el.y, el.x + el.w, el.y + el.h) <= Math.max(8, (el.strokeWidth || 2) + 5);
    }
    case 'pen': {
      const pts = el.points;
      for (let i = 1; i < pts.length; i++) {
        if (distToSeg(p.x, p.y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= Math.max(9, (el.strokeWidth || 3) + 6)) return true;
      }
      return false;
    }
    case 'text':
    case 'image': {
      const b = bboxOf(el);
      return p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4;
    }
  }
}

export function contentBounds(els: KreoElement[]): { x: number; y: number; w: number; h: number } | null {
  if (!els.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    const b = bboxOf(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Chaikin smoothing for freehand strokes (render-time only). */
export function smoothPoints(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}
