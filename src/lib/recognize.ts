// ─── KREO ink recognizer ────────────────────────────────────────────────────
// Turns loose freehand strokes into clean shapes (ellipse, rectangle, diamond,
// triangle, line, arrow). Pure geometry, no ML: resample → closure test →
// corner simplification → geometric fit tests with conservative thresholds.
// Anything ambiguous stays a (smoothed) pen stroke — never force a wrong shape.

import type { Pt } from '../types';

export type RecoKind = 'ellipse' | 'rect' | 'triangle' | 'diamond' | 'line' | 'arrow' | 'pen';

export interface RecoResult {
  kind: RecoKind;
  /** simplified corner polyline (open or closed) */
  corners: Pt[];
  /** bounding box of the stroke */
  box: { x: number; y: number; w: number; h: number };
  /** for line/arrow: fitted endpoints */
  ends?: [Pt, Pt];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!out.length || dist(out[out.length - 1], p) > 0.75) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Uniform arc-length resampling ($1-style). */
export function resample(pts: Pt[], n: number): Pt[] {
  const total = pathLength(pts);
  if (total === 0 || pts.length < 2) {
    return Array.from({ length: n }, () => ({ ...pts[0] }));
  }
  const I = total / (n - 1);
  const out: Pt[] = [{ ...pts[0] }];
  let D = 0;
  let prev = { ...pts[0] };
  for (let i = 1; i < pts.length && out.length < n; i++) {
    const cur = pts[i];
    let d = dist(prev, cur);
    while (D + d >= I && out.length < n && d > 1e-9) {
      const t = (I - D) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      D = 0;
    }
    D += d;
    prev = { ...cur };
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return dist(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Ramer–Douglas–Peucker simplification. */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let dmax = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Turn angle at b (degrees): 0 = straight, 180 = full reversal. */
function turnAt(a: Pt, b: Pt, c: Pt): number {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

function strokeBox(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function polyArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** Share of stroke direction concentrated near axis/diagonal orientations (mod 90°).
 * Straight-edged shapes (rect/diamond/triangle-ish) score high (~0.5-1.0);
 * circles score ~0.25 (uniform). */
function rectilinearShare(rs: Pt[]): number {
  const bins = [0, 0, 0, 0];
  let total = 0;
  for (let i = 1; i < rs.length; i++) {
    const dx = rs[i].x - rs[i - 1].x, dy = rs[i].y - rs[i - 1].y;
    if (Math.hypot(dx, dy) < 1e-6) continue;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    deg = ((deg % 90) + 90) % 90;
    bins[Math.min(3, Math.floor(deg / 22.5))]++;
    total++;
  }
  if (!total) return 0;
  return Math.max(...bins) / total;
}

/** Max perpendicular distance from the chord, normalized by chord length. */
function lineScore(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  const a = pts[0], b = pts[pts.length - 1];
  const chord = Math.max(1e-9, dist(a, b));
  let m = 0;
  for (const p of pts) m = Math.max(m, perpDist(p, a, b));
  return m / chord;
}

const penResult = (raw: Pt[]): RecoResult => ({
  kind: 'pen',
  corners: raw,
  box: strokeBox(raw),
});

export function recognizeStroke(rawInput: Pt[]): RecoResult {
  const raw = dedupe(rawInput);
  if (raw.length < 6) return penResult(rawInput);
  const box = strokeBox(raw);
  const D = Math.hypot(box.w, box.h);
  if (D < 30) return penResult(rawInput); // dots & hooks stay ink

  const rs = resample(raw, 64);
  const gap = dist(rs[0], rs[rs.length - 1]);
  const closed = gap < Math.min(44, Math.max(14, 0.16 * D));

  // ── open strokes: line or arrow ──
  if (!closed) {
    if (lineScore(rs) < 0.07) {
      return { kind: 'line', corners: [rs[0], rs[rs.length - 1]], box, ends: [{ ...raw[0] }, { ...raw[raw.length - 1] }] };
    }
    // arrow: straight shaft (~first 70%) + sharp barb turn near the end
    const shaft = rs.slice(0, 45);
    if (lineScore(shaft) < 0.06) {
      let bestK = -1, bestTurn = 0;
      for (let k = 45; k < 63; k++) {
        const t = turnAt(rs[k - 1], rs[k], rs[k + 1]);
        if (t > bestTurn) { bestTurn = t; bestK = k; }
      }
      const tip = rs[bestK];
      const shaftLen = dist(rs[0], rs[44]);
      if (
        bestTurn > 95 &&
        dist(rs[0], tip) > 0.45 * Math.max(1, shaftLen) &&
        perpDist(rs[63], rs[0], rs[44]) < 0.2 * D &&
        dist(tip, rs[63]) < 0.5 * Math.max(1, shaftLen)
      ) {
        return { kind: 'arrow', corners: [rs[0], tip], box, ends: [{ ...raw[0] }, { ...tip }] };
      }
    }
    return penResult(rawInput);
  }

  // ── closed strokes ──
  let poly = rdp(rs, 0.022 * D);
  // drop duplicated closing point
  if (poly.length > 1 && dist(poly[0], poly[poly.length - 1]) < 0.03 * D) poly = poly.slice(0, -1);
  const n = poly.length;
  const interior = (i: number) => 180 - turnAt(poly[(i + n - 1) % n], poly[i], poly[(i + 1) % n]);

  if (n === 3) {
    const angs = [interior(0), interior(1), interior(2)];
    if (Math.min(...angs) > 22 && Math.max(...angs) < 140) {
      return { kind: 'triangle', corners: poly, box };
    }
    return penResult(rawInput);
  }

  const straight = rectilinearShare(rs);

  // straight-edged closed shapes: rect / diamond (squares included)
  if (straight > 0.42) {
    if (n === 4) {
      const angs = [interior(0), interior(1), interior(2), interior(3)];
      const rightish = angs.every((a) => a > 52 && a < 132);
      if (rightish) {
        // axis-aligned edges → rectangle, diagonal edges → diamond
        const edgeAng = (i: number) => {
          const a = poly[i], b = poly[(i + 1) % 4];
          let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          deg = ((deg % 90) + 90) % 90;
          return Math.min(deg, 90 - deg); // 0 = axis aligned
        };
        const dev = [edgeAng(0), edgeAng(1), edgeAng(2), edgeAng(3)];
        const avg = (dev[0] + dev[1] + dev[2] + dev[3]) / 4;
        if (avg < 30) return { kind: 'rect', corners: poly, box };
        return { kind: 'diamond', corners: poly, box };
      }
    }
    // wobbly polygon with straight edges: bbox coverage decides
    const aspect = box.w / Math.max(1, box.h);
    if (n >= 4 && polyArea(poly) / Math.max(1, box.w * box.h) > 0.62 && aspect < 4.5 && aspect > 0.22) {
      return { kind: 'rect', corners: poly, box };
    }
    return penResult(rawInput);
  }

  // curvy closed strokes: circle / ellipse via low radial variance
  const cx = rs.reduce((s, p) => s + p.x, 0) / rs.length;
  const cy = rs.reduce((s, p) => s + p.y, 0) / rs.length;
  const radii = rs.map((p) => Math.hypot(p.x - cx, p.y - cy));
  const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
  const variance = radii.reduce((s, r) => s + (r - mean) * (r - mean), 0) / radii.length;
  const cv = mean > 1e-9 ? Math.sqrt(variance) / mean : 1;
  const aspect = box.w / Math.max(1, box.h);
  if (n >= 5 && cv < 0.17 && aspect > 0.6 && aspect < 1.7) {
    return { kind: 'ellipse', corners: poly, box };
  }

  return penResult(rawInput);
}

// ─── ink beautification ─────────────────────────────────────────────────────
// Cleans up a freehand stroke WITHOUT changing what it is: trims overshoot
// hooks at the ends, drops jitter spikes, smooths once, thins redundant
// points. Start/end positions are preserved exactly.

function dedupePts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!out.length || dist(out[out.length - 1], p) > 0.75) out.push({ x: p.x, y: p.y });
  }
  return out;
}

function strokeLen(pts: Pt[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

function turnDeg(a: Pt, b: Pt, c: Pt): number {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x);
  const a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

/** Cut a short folded-back overshoot hook off one end (mouse overshoot). */
function trimHookEnd(rs: Pt[], fromStart: boolean): Pt[] {
  const n = rs.length;
  if (n < 10) return rs;
  const total = strokeLen(rs);
  const budget = Math.min(60, Math.max(15, total * 0.2));
  // walk j outward from the tip; at(j) maps to the rs index
  const at = (j: number) => (fromStart ? j : n - 1 - j);
  // windowed turn: direction averaged over ±3 samples so plain jitter
  // never counts as a fold
  const wTurn = (j: number): number => {
    const a = rs[at(j - 3)], b = rs[at(j)], c = rs[at(j + 3)];
    return turnDeg(a, b, c);
  };
  let acc = 0;
  let cut = -1;
  for (let j = 3; j + 3 < n; j++) {
    acc += dist(rs[at(j - 1)], rs[at(j)]);
    if (acc > budget) break;
    if (wTurn(j) > 115) {
      cut = j;
      break;
    }
  }
  if (cut < 0) return rs;
  const kept = fromStart ? rs.slice(at(cut)) : rs.slice(0, at(cut) + 1);
  return kept.length >= 2 ? kept : rs;
}

/** Flatten bumps that fold back on an otherwise straight run (jitter jags):
 * a genuine corner changes the stroke's global direction and is kept;
 * a bump the line drives straight through gets pulled onto its chord.
 * Windowed so plain smooth curves never trigger it. */
function flattenBumps(rs: Pt[]): Pt[] {
  const out = rs.map((p) => ({ ...p }));
  // detection windows (small catches narrow jags, large catches wide ones);
  // flatten span + anchors always wide so bumps pull toward the true run
  const W = 8;
  const AW = 10;
  // run direction is measured well OUTSIDE the suspect feature so a narrow
  // spike reads as "straight through" while a real corner reads as a turn
  const DW = 26;
  const foldedAt = (i: number, w: number): boolean => {
    if (i - w < 0 || i + w >= out.length) return false;
    const a = out[i - w], b = out[i], c = out[i + w];
    const seg = dist(a, b) + dist(b, c);
    return seg > 1e-9 && dist(a, c) < 0.75 * seg && perpDist(b, a, c) > 2.5;
  };
  const dirChange = (a: Pt, b: Pt, c: Pt, d: Pt): number => {
    const d1 = Math.atan2(b.y - a.y, b.x - a.x);
    const d2 = Math.atan2(d.y - c.y, d.x - c.x);
    let dd = Math.abs(d2 - d1);
    if (dd > Math.PI) dd = 2 * Math.PI - dd;
    return (dd * 180) / Math.PI;
  };
  for (let i = DW; i + DW < out.length; i++) {
    if (!foldedAt(i, 3) && !foldedAt(i, W)) continue;
    // direction the run had coming in vs going out (outside the feature):
    // only near-straight runs get flattened, so curve-hugging bumps and
    // genuine corners (big direction changes) are never touched
    if (dirChange(out[i - DW], out[i - W], out[i + W], out[i + DW]) > 20) continue;
    if (i - W - AW < 0 || i + W + AW >= out.length) continue;
    const A = out[i - W - AW], B = out[i + W + AW];
    for (let k = i - W + 1; k < i + W; k++) {
      const t = (k - (i - W - AW)) / (2 * (W + AW));
      const tx = A.x + (B.x - A.x) * t, ty = A.y + (B.y - A.y) * t;
      out[k] = { x: out[k].x + (tx - out[k].x) * 0.75, y: out[k].y + (ty - out[k].y) * 0.75 };
    }
    i += W;
  }
  return out;
}

function chaikinOpen(rs: Pt[]): Pt[] {
  if (rs.length < 3) return rs.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...rs[0] }];
  for (let i = 0; i < rs.length - 1; i++) {
    const a = rs[i], b = rs[i + 1];
    out.push(
      { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
      { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }
    );
  }
  out.push({ ...rs[rs.length - 1] });
  return out;
}

export function beautifyStroke(input: Pt[]): Pt[] {
  let rs = dedupePts(input);
  if (rs.length < 3) return input.map((p) => ({ ...p }));
  // uniform spacing for stable cleanup
  const total = Math.max(1e-9, strokeLen(rs));
  rs = resample(rs, Math.min(400, Math.max(8, Math.round(total / 2.5) + 1)));
  rs = trimHookEnd(rs, false);
  rs = trimHookEnd(rs, true);
  rs = flattenBumps(rs);
  rs = flattenBumps(rs);
  rs = chaikinOpen(rs);
  rs = rdp(rs, 1.0);
  return rs.length >= 2 ? rs : input.map((p) => ({ ...p }));
}
