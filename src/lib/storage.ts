import type { AppSettings, Board, KreoElement } from '../types';
import { DEFAULT_SETTINGS } from '../types';
import { bboxOf } from './geometry';
import { boardId } from './id';

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
  const groups = new Map<string, KreoElement[]>();
  for (const el of elements) {
    if (el.groupId) {
      if (!groups.has(el.groupId)) groups.set(el.groupId, []);
      groups.get(el.groupId)!.push(el);
    }
  }
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    const area = (e: KreoElement) => {
      const b = bboxOf(e);
      return b.w * b.h;
    };
    const sorted = [...members].sort((a, b) => area(b) - area(a));
    const container = sorted[0];
    const cb = bboxOf(container);
    const nested = sorted.slice(1).filter((m) => {
      const mb = bboxOf(m);
      const ix = Math.max(0, Math.min(mb.x + mb.w, cb.x + cb.w) - Math.max(mb.x, cb.x));
      const iy = Math.max(0, Math.min(mb.y + mb.h, cb.y + cb.h) - Math.max(mb.y, cb.y));
      return (ix * iy) / Math.max(1, mb.w * mb.h) >= 0.85;
    });
    if (!nested.length) continue;
    const nestedIds = new Set(nested.map((e) => e.id));
    for (const el of elements) {
      if (nestedIds.has(el.id)) {
        el.groupId = null;
        el.parentId = container.id;
      }
    }
    const remaining = members.filter((e) => !nestedIds.has(e.id));
    if (remaining.length < 2) {
      for (const el of elements) {
        if (el.groupId === container.groupId && !nestedIds.has(el.id)) el.groupId = null;
      }
    }
  }
  return { ...board, elements };
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
