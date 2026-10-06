// ─── KREO handwriting recognizer ────────────────────────────────────────────
// Single-stroke ($1-style) template matching for A–Z, a–z, 0–9.
//
// Pipeline: dedupe → resample to 32 pts → stretch-normalize into a 100×100
// box → mean point-distance against every template (both stroke directions,
// writers vary) → aspect-ratio tiebreak (tall '0' vs round 'o', 'C' vs 'c').
//
// Rotation is deliberately NOT normalized: M≠W and 6≠9 must stay distinct.
// Anything below threshold stays ink — the matcher never forces a letter.

import type { Pt } from '../types';
import { resample } from './recognize';

export interface LetterMatch {
  char: string;
  score: number; // 0..1, higher is better
}

const N = 32;
const SIZE = 100;

interface Template {
  char: string;
  pts: Pt[]; // 32 normalized points
  aspect: number; // w/h of the raw waypoint art (case/width signal)
  closed: boolean; // waypoints form a closed loop
}

// [char, flat waypoints in a 0..100 box]
const RAW: [string, number[]][] = [
  // digits (tall & narrow by design → distinct aspect)
  ['0', [50, 4, 68, 8, 74, 28, 73, 52, 68, 76, 54, 92, 42, 92, 30, 76, 26, 52, 30, 28, 42, 8, 50, 4]],
  ['1', [28, 22, 54, 6, 54, 94]],
  ['2', [12, 18, 40, 6, 68, 10, 76, 28, 58, 52, 18, 86, 88, 86]],
  ['3', [18, 12, 52, 4, 76, 16, 64, 38, 44, 44, 62, 50, 76, 72, 54, 90, 22, 86]],
  ['4', [68, 94, 68, 6, 24, 56, 90, 56]],
  ['5', [84, 8, 42, 8, 32, 34, 54, 44, 76, 58, 68, 84, 40, 92, 18, 80]],
  ['6', [74, 10, 50, 24, 30, 50, 24, 74, 40, 90, 64, 88, 78, 70, 64, 52, 40, 52]],
  ['7', [14, 8, 86, 8, 42, 94]],
  ['8', [50, 4, 74, 10, 70, 30, 50, 40, 30, 50, 24, 70, 44, 88, 66, 84, 74, 64, 58, 48, 40, 40, 28, 26, 34, 12, 50, 4]],
  ['9', [26, 90, 50, 76, 70, 50, 76, 26, 60, 10, 36, 12, 22, 30, 36, 48, 60, 48]],
  // uppercase
  ['A', [6, 94, 50, 6, 94, 94]],
  ['B', [30, 6, 54, 6, 68, 18, 60, 38, 30, 44, 62, 50, 72, 74, 60, 90, 30, 94]],
  ['C', [84, 20, 60, 8, 30, 12, 12, 34, 12, 66, 30, 88, 60, 92, 84, 80]],
  ['D', [30, 6, 30, 94, 64, 90, 84, 64, 84, 36, 64, 10, 30, 6]],
  ['E', [84, 6, 20, 6, 20, 50, 58, 50, 20, 50, 20, 94, 84, 94]],
  ['F', [84, 6, 20, 6, 20, 50, 58, 50, 20, 50, 20, 94]],
  ['G', [84, 20, 60, 8, 30, 12, 12, 34, 12, 66, 30, 88, 60, 92, 84, 80, 84, 56, 60, 56]],
  ['H', [20, 6, 20, 94, 20, 50, 80, 50, 80, 6, 80, 94]],
  ['I', [30, 6, 70, 6, 50, 6, 50, 94, 70, 94, 30, 94]],
  ['J', [74, 6, 74, 68, 60, 88, 36, 90, 18, 76]],
  ['K', [30, 6, 30, 94, 30, 54, 84, 6, 30, 54, 88, 94]],
  ['L', [26, 6, 26, 94, 84, 94]],
  ['M', [10, 94, 10, 6, 50, 54, 90, 6, 90, 94]],
  ['N', [16, 94, 16, 6, 84, 94, 84, 6]],
  ['O', [50, 4, 74, 8, 88, 26, 90, 52, 84, 76, 66, 92, 44, 94, 24, 80, 12, 56, 14, 30, 30, 12, 50, 4]],
  ['P', [30, 94, 30, 6, 64, 8, 78, 28, 64, 48, 30, 50]],
  ['Q', [62, 8, 84, 22, 90, 50, 82, 76, 62, 92, 40, 92, 22, 78, 14, 54, 18, 30, 36, 12, 62, 8, 80, 60, 94, 94]],
  ['R', [30, 94, 30, 6, 64, 8, 78, 28, 64, 48, 30, 50, 74, 94]],
  ['S', [80, 14, 60, 5, 36, 8, 22, 24, 34, 41, 60, 50, 78, 62, 70, 82, 50, 92, 28, 88]],
  ['T', [10, 8, 90, 8, 50, 8, 50, 94]],
  ['U', [16, 6, 16, 64, 30, 86, 54, 90, 76, 78, 84, 58, 84, 6]],
  ['V', [6, 6, 50, 94, 94, 6]],
  ['W', [4, 6, 24, 94, 50, 44, 76, 94, 96, 6]],
  ['X', [16, 6, 84, 94, 84, 6, 16, 94]],
  ['Y', [6, 6, 50, 50, 94, 6, 50, 50, 50, 94]],
  ['Z', [10, 8, 90, 8, 10, 92, 90, 92]],
  // lowercase (x-height bodies → distinct aspect from capitals)
  ['a', [64, 14, 64, 94, 58, 60, 34, 56, 22, 72, 32, 90, 58, 90, 70, 74]],
  ['b', [36, 4, 36, 94, 36, 60, 60, 54, 74, 70, 66, 90, 44, 92, 32, 80]],
  ['c', [84, 38, 64, 48, 42, 50, 24, 62, 30, 80, 52, 88, 74, 82]],
  ['d', [52, 54, 70, 68, 64, 86, 44, 90, 30, 76, 32, 62, 46, 56, 58, 56, 58, 10]],
  ['e', [76, 58, 52, 50, 30, 62, 34, 82, 56, 90, 76, 80, 78, 62, 62, 52, 44, 52]],
  ['f', [64, 94, 64, 20, 52, 8, 36, 12, 32, 44, 62, 44]],
  ['g', [54, 50, 70, 62, 66, 82, 46, 88, 32, 76, 34, 60, 50, 54, 60, 54, 60, 90, 48, 100, 32, 94]],
  ['h', [30, 6, 30, 94, 30, 60, 54, 54, 70, 68, 70, 94]],
  ['i', [40, 30, 58, 26, 58, 94]],
  ['j', [60, 26, 60, 74, 50, 90, 32, 88]],
  ['k', [30, 10, 30, 94, 30, 62, 68, 44, 36, 60, 72, 94]],
  ['l', [40, 6, 54, 30, 54, 88, 68, 94]],
  ['m', [20, 94, 20, 44, 40, 40, 54, 54, 54, 94, 54, 52, 74, 46, 86, 60, 86, 94]],
  ['n', [20, 94, 20, 44, 42, 40, 60, 54, 60, 94]],
  ['o', [52, 30, 70, 34, 80, 48, 78, 66, 66, 82, 48, 86, 32, 76, 24, 58, 30, 42, 52, 30]],
  ['p', [36, 10, 36, 94, 36, 60, 60, 54, 72, 68, 64, 86, 42, 88, 32, 76]],
  ['q', [64, 10, 64, 94, 58, 60, 38, 56, 28, 70, 36, 86, 58, 86, 66, 74, 78, 92]],
  ['r', [26, 90, 26, 50, 46, 42, 64, 48, 70, 60]],
  ['s', [74, 56, 60, 46, 40, 48, 32, 60, 42, 70, 60, 74, 72, 82, 62, 92, 42, 90]],
  ['t', [50, 10, 50, 88, 64, 94]],
  ['u', [20, 42, 20, 72, 34, 88, 56, 86, 68, 72, 68, 42]],
  ['v', [10, 42, 44, 92, 84, 42]],
  ['w', [6, 46, 20, 90, 42, 56, 62, 90, 84, 46]],
  ['x', [20, 46, 80, 90, 56, 68, 80, 46, 20, 90]],
  ['y', [16, 42, 44, 84, 78, 42, 52, 66, 52, 96]],
  ['z', [16, 46, 84, 46, 16, 90, 84, 90]],
];

function toPts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

function normalizeForMatch(raw: Pt[]): { pts: Pt[]; aspect: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(1e-9, maxX - minX);
  const h = Math.max(1e-9, maxY - minY);
  const aspect = (maxX - minX) / Math.max(1, maxY - minY);
  // stretch into SIZE×SIZE (aspect handled separately via tiebreak),
  // then center on centroid like $1
  const sx = SIZE / w, sy = SIZE / h;
  const mapped = raw.map((p) => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy }));
  let cx = 0, cy = 0;
  for (const p of mapped) { cx += p.x; cy += p.y; }
  cx /= mapped.length; cy /= mapped.length;
  const centered = mapped.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  return { pts: resample(centered, N), aspect };
}

const TEMPLATES: Template[] = RAW.map(([char, flat]) => {
  const wps = toPts(flat);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of wps) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const aspect = (maxX - minX) / Math.max(1, maxY - minY);
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const gap = wps.length > 1 ? Math.hypot(wps[0].x - wps[wps.length - 1].x, wps[0].y - wps[wps.length - 1].y) : 0;
  return { char, pts: normalizeForMatch(wps).pts, aspect, closed: diag > 1e-9 && gap < 0.18 * diag };
});

function avgDist(a: Pt[], b: Pt[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return s / a.length;
}

/** Best template match for a single stroke. Null when too short. */
export function matchLetter(rawInput: Pt[]): LetterMatch | null {
  const seen = new Set<string>();
  const raw = rawInput.filter((p) => {
    const k = `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (raw.length < 3) return null;
  const { pts, aspect } = normalizeForMatch(raw);
  // closure of the input stroke (loops vs open flicks must match template kind)
  let iminX = Infinity, iminY = Infinity, imaxX = -Infinity, imaxY = -Infinity;
  for (const p of raw) {
    iminX = Math.min(iminX, p.x); iminY = Math.min(iminY, p.y);
    imaxX = Math.max(imaxX, p.x); imaxY = Math.max(imaxY, p.y);
  }
  const idiag = Math.hypot(imaxX - iminX, imaxY - iminY);
  const igap = Math.hypot(raw[0].x - raw[raw.length - 1].x, raw[0].y - raw[raw.length - 1].y);
  const inputClosed = idiag > 1e-9 && igap < 0.18 * idiag;
  const rev = [...pts].reverse();
  let bestChar = '';
  let bestCombined = Infinity;
  for (const t of TEMPLATES) {
    const d = Math.min(avgDist(pts, t.pts), avgDist(rev, t.pts));
    // aspect tiebreak (tall '0' vs round 'o', 'C' vs 'c') + closure agreement
    const combined =
      d +
      22 * Math.min(1, Math.abs(aspect - t.aspect)) +
      (inputClosed === t.closed ? 0 : 12);
    if (combined < bestCombined) {
      bestCombined = combined;
      bestChar = t.char;
    }
  }
  const score = Math.max(0, 1 - bestCombined / 70);
  return { char: bestChar, score };
}

/** For testing: expose template count + raw accessor. */
export function templateInfo(): { count: number; chars: string } {
  return { count: TEMPLATES.length, chars: TEMPLATES.map((t) => t.char).join('') };
}
