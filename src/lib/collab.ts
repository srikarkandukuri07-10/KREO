// Realtime collaboration transport.
//
// Design: `KreoSync` is a small pub/sub layer. The default implementation uses
// BroadcastChannel + localStorage events, which gives true multi-tab realtime
// on the same machine with zero backend. The interface is backend-agnostic:
// swapping in a WebSocket/Supabase/Firebase provider only requires
// implementing `SyncProvider`, the editor code stays unchanged (no rewrite).
//
// Presence (remote cursors + names) and element patches flow through here and
// are merged with last-writer-wins per element id + updatedAt, so concurrent
// edits from two users don't clobber each other wholesale.

import type { KreoElement } from '../types';

export interface PresenceMsg {
  kind: 'presence';
  clientId: string;
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  tool: string;
  ts: number;
}

export interface ElementsMsg {
  kind: 'elements';
  clientId: string;
  elements: KreoElement[];
  ts: number;
}

export type SyncMsg = PresenceMsg | ElementsMsg;

export interface SyncProvider {
  broadcast(msg: SyncMsg): void;
  onMessage(cb: (msg: SyncMsg) => void): () => void;
  destroy(): void;
}

export class BroadcastSync implements SyncProvider {
  private ch: BroadcastChannel | null = null;
  private boardId: string;
  private listener: ((e: StorageEvent) => void) | null = null;
  private cbs = new Set<(msg: SyncMsg) => void>();

  constructor(boardId: string) {
    this.boardId = boardId;
    try {
      this.ch = new BroadcastChannel(`kreo-board-${boardId}`);
      this.ch.onmessage = (e) => {
        const msg = e.data as SyncMsg;
        this.cbs.forEach((cb) => cb(msg));
      };
    } catch {
      this.ch = null;
    }
    // storage-event fallback
    this.listener = (e: StorageEvent) => {
      if (e.key === `kreo.sync.${this.boardId}` && e.newValue) {
        try {
          const msg = JSON.parse(e.newValue) as SyncMsg;
          this.cbs.forEach((cb) => cb(msg));
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('storage', this.listener);
  }

  broadcast(msg: SyncMsg) {
    try {
      this.ch?.postMessage(msg);
    } catch { /* ignore */ }
    // presence only via BC (ephemeral); elements also via storage so late
    // joiners / other tabs without BC still converge
    if (msg.kind === 'elements') {
      try {
        localStorage.setItem(`kreo.sync.${this.boardId}`, JSON.stringify(msg));
      } catch { /* ignore */ }
    }
  }

  onMessage(cb: (msg: SyncMsg) => void): () => void {
    this.cbs.add(cb);
    return () => { this.cbs.delete(cb); };
  }

  destroy() {
    try { this.ch?.close(); } catch { /* ignore */ }
    if (this.listener) window.removeEventListener('storage', this.listener);
    this.cbs.clear();
  }
}

/** Merge remote elements into local with per-element last-writer-wins. */
export function mergeElements(local: KreoElement[], remote: KreoElement[]): KreoElement[] {
  if (!remote.length) return local;
  const byId = new Map(local.map((e) => [e.id, e]));
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || (r.updatedAt ?? 0) >= (l.updatedAt ?? 0)) byId.set(r.id, r);
  }
  // preserve local layer order, append newcomers at end
  const order = new Map(local.map((e, i) => [e.id, i]));
  return [...byId.values()].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
}

const NAMES = ['Amber', 'Birch', 'Cedar', 'Dune', 'Ember', 'Fern', 'Grove', 'Hazel', 'Iris', 'Juniper'];
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

export function randomIdentity(): { name: string; color: string; clientId: string } {
  const i = Math.floor(Math.random() * NAMES.length);
  const c = COLORS[Math.floor(Math.random() * COLORS.length)];
  return {
    name: `${NAMES[i]} ${Math.floor(Math.random() * 90 + 10)}`,
    color: c,
    clientId: `c_${Math.random().toString(36).slice(2, 10)}`,
  };
}
