import type { AppSettings, Board, KreoElement } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { bboxOf } from './geometry';
import { boardId, uid } from './id';

const INDEX_KEY = 'kreo.boards.index.v1';
const BOARD_KEY = (id: string) => `kreo.board.${id}.v1`;
const SETTINGS_KEY = 'kreo.settings.v1';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function listBoardIds(): string[] {
  return readJSON<string[]>(INDEX_KEY, []);
}

export function loadBoard(id: string): Board | null {
  const b = readJSON<Board | null>(BOARD_KEY(id), null);
  return b ? normalizeBoard(b) : null;
}

/**
 * Normalize a board loaded from storage (or a share payload):
 * - guarantees the parentId field exists on every element
 * - converts legacy auto-attach groups (one member containing ≥85% of
 *   another's area) into parent/child attachments so each object selects
 *   individually again; genuine side-by-side groups are untouched.
 */
export function normalizeBoard(board: Board): Board {
  const elements = board.elements.map((el: KreoElement) => {
    if ((el as KreoElement).parentId === undefined) {
      return { ...el, parentId: null };
    }
    return el;
  });
  let migrated = board.attachMigrated ?? 0;
  dedupeIds(elements);
  if (migrated < 2) {
    migrateLegacyGroups(elements);
    migrated = 2;
  }
  return { ...board, elements, attachMigrated: migrated };
}

/**
 * Repair pass: every element must have a unique id. Legacy shape-tool
 * shapes could share the placeholder id ('draft'), which made them
 * select/move/delete as one. Duplicates get fresh ids and their parent
 * links are cleared (ambiguous); dangling parent links are cleared too.
 */
function dedupeIds(elements: KreoElement[]) {
  const seen = new Set<string>();
  for (const el of elements) {
    if (!el.id || seen.has(el.id)) {
      el.id = uid();
      el.parentId = null;
    }
    seen.add(el.id);
  }
  const valid = new Set(elements.map((e) => e.id));
  for (const el of elements) {
    if (el.parentId && !valid.has(el.parentId)) el.parentId = null;
  }
}

function overlapArea(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ix * iy;
}

/**
 * One-time conversion of legacy co-select groups into attachments: within a
 * group, any smaller member substantially overlapping the largest member
 * becomes its attached child (single-select, still moves together).
 * Non-overlapping groups are genuine manual groups and stay grouped.
 * Stamped with attachMigrated so groups you create yourself are never
 * rewritten on later loads.
 */
function migrateLegacyGroups(elements: KreoElement[]) {
  const groups = new Map<string, KreoElement[]>();
  for (const el of elements) {
    if (el.groupId) {
      if (!groups.has(el.groupId)) groups.set(el.groupId, []);
      groups.get(el.groupId)!.push(el);
    }
  }
  for (const [, members] of groups) {
    if (members.length < 2) {
      members[0].groupId = null;
      continue;
    }
    const area = (e: KreoElement) => {
      const b = bboxOf(e);
      return b.w * b.h;
    };
    const sorted = [...members].sort((a, b) => area(b) - area(a));
    const container = sorted[0];
    const cb = bboxOf(container);
    const attached = new Set<string>();
    for (const m of sorted.slice(1)) {
      const mb = bboxOf(m);
      const ratio = overlapArea(mb, cb) / Math.max(1, mb.w * mb.h);
      if (ratio >= 0.15) attached.add(m.id);
    }
    if (!attached.size) continue;
    for (const el of elements) {
      if (attached.has(el.id)) {
        el.groupId = null;
        el.parentId = container.id;
      }
    }
    const remaining = members.filter((e) => !attached.has(e.id));
    if (remaining.length < 2) {
      for (const el of elements) {
        if (el.groupId === container.groupId && !attached.has(el.id)) el.groupId = null;
      }
    }
  }
}

export function saveBoard(board: Board): boolean {
  const ok = writeJSON(BOARD_KEY(board.id), board);
  if (!ok) return false;
  const ids = listBoardIds();
  if (!ids.includes(board.id)) {
    writeJSON(INDEX_KEY, [board.id, ...ids]);
  }
  return true;
}

export function deleteBoard(id: string) {
  try {
    localStorage.removeItem(BOARD_KEY(id));
  } catch { /* noop */ }
  writeJSON(
    INDEX_KEY,
    listBoardIds().filter((b) => b !== id)
  );
}

export function listBoards(): Board[] {
  return listBoardIds()
    .map((id) => loadBoard(id))
    .filter((b): b is Board => !!b)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createBoard(name = 'Untitled board'): Board {
  const now = Date.now();
  const board: Board = {
    id: boardId(),
    name,
    createdAt: now,
    updatedAt: now,
    elements: [],
    view: { x: 0, y: 0, zoom: 1 },
    share: { mode: 'private', permission: 'edit' },
    background: '#FAF9F6',
    grid: false,
    snap: false,
  };
  saveBoard(board);
  return board;
}

export function duplicateBoard(src: Board): Board {
  const now = Date.now();
  const copy: Board = {
    ...JSON.parse(JSON.stringify(src)),
    id: boardId(),
    name: `${src.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  // regenerate element ids so copies are independent (remap parent links too)
  const idMap = new Map<string, string>();
  copy.elements = copy.elements.map((el: any) => {
    const nid = `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
    idMap.set(el.id, nid);
    return { ...el, id: nid };
  });
  for (const el of copy.elements as KreoElement[]) {
    if (el.parentId && idMap.has(el.parentId)) el.parentId = idMap.get(el.parentId)!;
    else if (el.parentId) el.parentId = null;
  }
  saveBoard(copy);
  return copy;
}

export function loadSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...readJSON<Partial<AppSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(s: AppSettings) {
  writeJSON(SETTINGS_KEY, s);
}

/** Encode a board into a portable share URL (works cross-device, no backend). */
export function encodePortableLink(board: Board): string {
  const payload = {
    n: board.name,
    e: board.elements,
    b: board.background,
    s: board.share.permission,
  };
  const json = JSON.stringify(payload);
  // base64url
  const b64 = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const url = new URL(window.location.href);
  url.hash = `#/s/${board.id}?p=${board.share.permission}&d=${b64}`;
  return url.toString();
}

export function decodePortableHash(hash: string): { name: string; elements: any[]; background: string; permission: string } | null {
  try {
    const m = hash.match(/[?&]d=([^&]+)/);
    if (!m) return null;
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    const p = JSON.parse(json);
    return { name: p.n ?? 'Shared board', elements: p.e ?? [], background: p.b ?? '#FAF9F6', permission: p.s ?? 'view' };
  } catch {
    return null;
  }
}

export function boardUrl(id: string): string {
  const url = new URL(window.location.href);
  url.hash = `#/board/${id}`;
  return url.toString();
}
