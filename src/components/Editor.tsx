import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Board, KreoElement, Pt, ToolId } from '../types';
import { PALETTE, SHORTCUTS } from '../types';
import { uid } from '../lib/id';
import { loadSettings, saveBoard as persistBoard, saveSettings } from '../lib/storage';
import { bboxOf, contentBounds, hitTest, smoothPoints, snapVal, unrotate } from '../lib/geometry';
import { renderScene } from '../canvas/renderer';
import { recognizeStroke } from '../lib/recognize';
import { BroadcastSync, mergeElements, randomIdentity, type PresenceMsg } from '../lib/collab';
import { I } from './icons';
import Toolbar from './Toolbar';
import StylePanel from './StylePanel';
import ShareModal from './ShareModal';
import CommandPalette from './CommandPalette';
import SettingsPanel from './SettingsPanel';
import ContextMenu from './ContextMenu';
import { copyImageToClipboard, downloadFile, elementsToSVG, exportPDF, exportPNG } from '../canvas/export';

interface Props {
  initial: Board;
  readOnly: boolean;
  sharedBanner?: string | null;
  onExit: () => void;
  notify: (msg: string) => void;
}

// ─── helpers ────────────────────────────────────────────────────────────────
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const HANDLE_R = 9;

function unionBox(els: KreoElement[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    const b = bboxOf(el);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function expandByGroup(all: KreoElement[], ids: string[]): string[] {
  const groups = new Set(all.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId as string));
  if (!groups.size) return ids;
  return all.filter((e) => ids.includes(e.id) || (e.groupId && groups.has(e.groupId))).map((e) => e.id);
}

function defaultElement(tool: ToolId, s: AppSettings): Partial<KreoElement> {
  return {
    stroke: s.defaultStroke,
    fill: tool === 'text' ? 'transparent' : s.defaultFill,
    strokeWidth: s.defaultStrokeWidth,
    strokeStyle: 'solid',
    opacity: 100,
    roughness: s.defaultRoughness,
    roundness: 0.3,
    locked: false,
    groupId: null,
  } as Partial<KreoElement>;
}

export default function Editor({ initial, readOnly, sharedBanner, onExit, notify }: Props) {
  const [board, setBoard] = useState<Board>(initial);
  const [tool, setToolState] = useState<ToolId>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState({ x: initial.view.x, y: initial.view.y, zoom: initial.view.zoom });
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline' | 'unsaved'>('saved');
  const [showShare, setShowShare] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [editingText, setEditingText] = useState<{ id: string; draft: string } | null>(null);
  const [presences, setPresences] = useState<Map<string, PresenceMsg>>(new Map());
  const [boardName, setBoardName] = useState(initial.name);
  const [renaming, setRenaming] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // mutable refs mirrored for event handlers
  const elsRef = useRef<KreoElement[]>(initial.elements);
  const selRef = useRef<string[]>([]);
  const viewRef = useRef(view);
  const toolRef = useRef<ToolId>('select');
  const settingsRef = useRef(settings);
  const readOnlyRef = useRef(readOnly);
  const draftRef = useRef<KreoElement | null>(null);
  const rubberRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const gestureRef = useRef<null | {
    mode: 'pan' | 'move' | 'resize' | 'rotate' | 'create' | 'pen' | 'rubber' | 'erase' | 'pinch';
    startWX: number; startWY: number;
    origCamX: number; origCamY: number;
    snapshot: KreoElement[];
    handle?: string;
    center?: Pt;
    startAngle?: number;
    origRot?: number;
    eraseIds?: Set<string>;
    pinchDist?: number; pinchZoom?: number;
  }>(null);
  const undoRef = useRef<KreoElement[][]>([]);
  const redoRef = useRef<KreoElement[][]>([]);
  const clipboardRef = useRef<KreoElement[]>([]);
  const spaceRef = useRef(false);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const identityRef = useRef(randomIdentity());
  // Text elements: the editor overlay opens on pointer-UP (after the creating
  // click completes), otherwise the click steals focus and blur-commits instantly.
  const pendingTextRef = useRef<string | null>(null);
  const syncRef = useRef<BroadcastSync | null>(null);
  const saveTimer = useRef<number>(0);
  const broadcastTimer = useRef<number>(0);
  const presenceTimer = useRef<number>(0);
  const remoteCursorRef = useRef<Map<string, PresenceMsg>>(new Map());
  const [, forceCursor] = useState(0);

  readOnlyRef.current = readOnly;
  settingsRef.current = settings;

  const elements = board.elements;
  elsRef.current = elements;
  selRef.current = selected;
  viewRef.current = view;
  toolRef.current = tool;

  const setTool = (t: ToolId) => {
    setToolState(t);
    toolRef.current = t;
    // a pending text editor belongs to the click that created it — cancel if user switches away
    if (t !== 'select') pendingTextRef.current = null;
  };

  // ─── draw ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = viewRef.current;
    const list = draftRef.current ? [...elsRef.current, draftRef.current] : elsRef.current;
    renderScene(ctx, list, {
      grid: settingsRef.current.grid,
      gridSize: settingsRef.current.gridSize,
      background: boardRefBg.current,
    }, imageCacheRef.current, dpr, w, h, v.x, v.y, v.zoom);
    drawSelectionOverlay(ctx, v);
    if (rubberRef.current) {
      const r = rubberRef.current;
      const x0 = (Math.min(r.x0, r.x1) - v.x) * v.zoom;
      const y0 = (Math.min(r.y0, r.y1) - v.y) * v.zoom;
      const ww = Math.abs(r.x1 - r.x0) * v.zoom;
      const hh = Math.abs(r.y1 - r.y0) * v.zoom;
      ctx.save();
      ctx.strokeStyle = '#4f46e5';
      ctx.fillStyle = 'rgba(79,70,229,0.08)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x0, y0, ww, hh);
      ctx.strokeRect(x0, y0, ww, hh);
      ctx.restore();
    }
  }, []);

  const boardRefBg = useRef(initial.background);
  boardRefBg.current = board.background;
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());

  // keep image cache warm
  useEffect(() => {
    const cache = imageCacheRef.current;
    for (const el of elements) {
      if (el.type === 'image' && !cache.has(el.id)) {
        const img = new Image();
        img.onload = () => draw();
        img.src = el.src;
        cache.set(el.id, img);
      }
    }
    for (const key of [...cache.keys()]) {
      if (!elements.some((e) => e.id === key)) cache.delete(key);
    }
  }, [elements, draw]);

  const drawSelectionOverlay = (ctx: CanvasRenderingContext2D, v: { x: number; y: number; zoom: number }) => {
    const ids = selRef.current;
    if (!ids.length) return;
    const els = elsRef.current.filter((e) => ids.includes(e.id));
    if (!els.length) return;
    ctx.save();
    for (const el of els) {
      const b = bboxOf(el);
      const sx = (b.x - v.x) * v.zoom, sy = (b.y - v.y) * v.zoom;
      const sw = b.w * v.zoom, sh = b.h * v.zoom;
      ctx.strokeStyle = '#4f46e5';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      if (el.rotation) {
        const cx = sx + sw / 2, cy = sy + sh / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((el.rotation * Math.PI) / 180);
        ctx.strokeRect(-sw / 2, -sh / 2, sw, sh);
        ctx.restore();
      } else {
        ctx.strokeRect(sx, sy, sw, sh);
      }
      if (el.locked) {
        ctx.fillStyle = '#4f46e5';
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText('🔒', sx + sw - 16, sy - 6);
      }
    }
    // union handles for multi / single
    const u = unionBox(els);
    const rot = els.length === 1 ? els[0].rotation : 0;
    const toScreen = (wx: number, wy: number): Pt => {
      let dx = wx - (u.x + u.w / 2), dy = wy - (u.y + u.h / 2);
      if (rot) {
        const rad = (rot * Math.PI) / 180;
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
        dx = rx; dy = ry;
      }
      return {
        x: (u.x + u.w / 2 + dx - v.x) * v.zoom,
        y: (u.y + u.h / 2 + dy - v.y) * v.zoom,
      };
    };
    const corners: Record<string, Pt> = {
      nw: toScreen(u.x, u.y), n: toScreen(u.x + u.w / 2, u.y),
      ne: toScreen(u.x + u.w, u.y), e: toScreen(u.x + u.w, u.y + u.h / 2),
      se: toScreen(u.x + u.w, u.y + u.h), s: toScreen(u.x + u.w / 2, u.y + u.h),
      sw: toScreen(u.x, u.y + u.h), w: toScreen(u.x, u.y + u.h / 2),
    };
    handlePosRef.current = corners;
    const rotC = toScreen(u.x + u.w / 2, u.y - 28 / v.zoom);
    handlePosRef.current.rotate = rotC;
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 1.5;
    for (const k of Object.keys(corners)) {
      const p = corners[k];
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // rotate handle
    ctx.beginPath();
    ctx.arc(rotC.x, rotC.y, HANDLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4f46e5';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⟳', rotC.x, rotC.y + 3.5);
    ctx.textAlign = 'left';
    // connect rotate stem
    const nP = corners.n;
    ctx.strokeStyle = '#4f46e5';
    ctx.beginPath();
    ctx.moveTo(nP.x, nP.y);
    ctx.lineTo(rotC.x, rotC.y);
    ctx.stroke();
    ctx.restore();
  };
  const handlePosRef = useRef<Record<string, Pt>>({});

  // ─── history ─────────────────────────────────────────────────────────────
  const checkpoint = () => {
    undoRef.current.push(clone(elsRef.current));
    if (undoRef.current.length > 120) undoRef.current.shift();
    redoRef.current = [];
  };
  const undo = useCallback(() => {
    if (readOnlyRef.current) return;
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push(clone(elsRef.current));
    applyElements(prev);
    setSelected((s) => s.filter((id) => prev.some((e) => e.id === id)));
  }, []);
  const redo = useCallback(() => {
    if (readOnlyRef.current) return;
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(clone(elsRef.current));
    applyElements(next);
  }, []);

  const applyElements = (els: KreoElement[]) => {
    setBoard((b) => ({ ...b, elements: els, updatedAt: Date.now() }));
  };

  // ─── persistence (autosave) ──────────────────────────────────────────────
  useEffect(() => {
    if (readOnly) return;
    setSaveState(navigator.onLine ? 'saving' : 'offline');
    window.clearTimeout(saveTimer.current);
    const run = () => {
      if (!settingsRef.current.autosave) {
        setSaveState('unsaved');
        return;
      }
      const ok = persistBoard({ ...board, view: viewRef.current, name: boardName });
      setSaveState(ok ? 'saved' : 'unsaved');
      if (!ok) notify('Storage full — export JSON to back up your work');
    };
    saveTimer.current = window.setTimeout(run, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.elements, board.background, board.share, boardName, view]);

  useEffect(() => {
    const on = () => setSaveState('saving');
    const off = () => setSaveState('offline');
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // ─── realtime sync ───────────────────────────────────────────────────────
  useEffect(() => {
    const sync = new BroadcastSync(initial.id);
    syncRef.current = sync;
    const off = sync.onMessage((msg) => {
      if (msg.kind === 'elements' && msg.clientId !== identityRef.current.clientId) {
        const merged = mergeElements(elsRef.current, msg.elements);
        setBoard((b) => ({ ...b, elements: merged }));
      } else if (msg.kind === 'presence') {
        if (msg.clientId === identityRef.current.clientId) return;
        remoteCursorRef.current.set(msg.clientId, msg);
        if (Date.now() - msg.ts < 15000) {
          setPresences(new Map(remoteCursorRef.current));
          forceCursor((n) => n + 1);
        }
      }
    });
    // prune stale cursors
    const iv = window.setInterval(() => {
      let changed = false;
      for (const [k, v2] of remoteCursorRef.current) {
        if (Date.now() - v2.ts > 8000) {
          remoteCursorRef.current.delete(k);
          changed = true;
        }
      }
      if (changed) {
        setPresences(new Map(remoteCursorRef.current));
        forceCursor((n) => n + 1);
      }
    }, 3000);
    // announce self
    sync.broadcast({
      kind: 'presence', clientId: identityRef.current.clientId,
      name: identityRef.current.name, color: identityRef.current.color,
      cursor: null, tool: 'select', ts: Date.now(),
    });
    return () => {
      off();
      sync.destroy();
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  const broadcastElements = () => {
    window.clearTimeout(broadcastTimer.current);
    broadcastTimer.current = window.setTimeout(() => {
      syncRef.current?.broadcast({
        kind: 'elements',
        clientId: identityRef.current.clientId,
        elements: elsRef.current,
        ts: Date.now(),
      });
    }, 250);
  };

  // ─── coordinate helpers ──────────────────────────────────────────────────
  const toWorld = (sx: number, sy: number): Pt => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return {
      x: (sx - rect.left) / v.zoom + v.x,
      y: (sy - rect.top) / v.zoom + v.y,
    };
  };

  const setViewBoth = (v: { x: number; y: number; zoom: number }) => {
    viewRef.current = v;
    setView(v);
    draw();
  };

  const zoomTo = (sx: number, sy: number, nextZoom: number) => {
    const v = viewRef.current;
    const zoom = Math.min(4, Math.max(0.1, nextZoom));
    const before = toWorld(sx, sy);
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = before.x - (sx - rect.left) / zoom;
    const y = before.y - (sy - rect.top) / zoom;
    setViewBoth({ x, y, zoom });
  };

  const zoomAt = (sx: number, sy: number, factor: number) => {
    zoomTo(sx, sy, viewRef.current.zoom * factor);
  };

  const fitView = (els?: KreoElement[]) => {
    const target = els ?? elsRef.current;
    const b = contentBounds(target);
    const wrap = wrapRef.current!;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!b) {
      setViewBoth({ x: -W / 2, y: -H / 2, zoom: 1 });
      return;
    }
    const zoom = Math.min(2, Math.max(0.1, Math.min((W - 120) / b.w, (H - 120) / b.h)));
    setViewBoth({
      zoom,
      x: b.x + b.w / 2 - W / 2 / zoom,
      y: b.y + b.h / 2 - H / 2 / zoom,
    });
  };

  // center initial view on content (or origin) once
  useEffect(() => {
    const b = contentBounds(initial.elements);
    const wrap = wrapRef.current;
    if (!wrap) return;
    const v = viewRef.current;
    const isDefault = v.x === 0 && v.y === 0 && v.zoom === 1;
    if (b && isDefault) {
      fitView();
    } else if (!b && isDefault) {
      const W = wrap.clientWidth || 800, H = wrap.clientHeight || 600;
      setViewBoth({ x: -W / 2, y: -H / 2, zoom: 1 });
    } else draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
  }, [board.elements, selected, view, settings.grid, board.background, draw]);

  // Safety net: redraw after every render so the canvas can never show stale
  // refs (e.g. an in-progress stroke when a presence update re-renders).
  useEffect(() => {
    draw();
  });

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  // ─── element mutations ───────────────────────────────────────────────────
  const mutateElements = (fn: (els: KreoElement[]) => KreoElement[], recordHistory = true) => {
    if (readOnlyRef.current) return;
    if (recordHistory) checkpoint();
    const next = fn(clone(elsRef.current));
    applyElements(next);
    broadcastElements();
  };

  const deleteSelected = useCallback(() => {
    if (readOnlyRef.current || !selRef.current.length) return;
    checkpoint();
    const ids = new Set(selRef.current);
    applyElements(elsRef.current.filter((e) => !ids.has(e.id)));
    setSelected([]);
    broadcastElements();
  }, []);

  const duplicateSelected = useCallback(() => {
    if (readOnlyRef.current || !selRef.current.length) return;
    checkpoint();
    const src = elsRef.current.filter((e) => selRef.current.includes(e.id));
    const copies = clone(src).map((e) => ({ ...e, id: uid(), x: e.x + 24, y: e.y + 24, updatedAt: Date.now() }));
    if (copies[0]?.type === 'pen') {
      for (const c of copies) {
        if (c.type === 'pen') c.points = c.points.map((p) => ({ x: p.x + 24, y: p.y + 24 }));
      }
    }
    applyElements([...elsRef.current, ...copies]);
    setSelected(copies.map((c) => c.id));
    broadcastElements();
  }, []);

  const copySelected = useCallback(() => {
    const src = elsRef.current.filter((e) => selRef.current.includes(e.id));
    clipboardRef.current = clone(src);
    try {
      localStorage.setItem('kreo.clipboard', JSON.stringify(src));
    } catch { /* ignore */ }
    if (src.length) notify(`Copied ${src.length} element${src.length > 1 ? 's' : ''}`);
  }, [notify]);

  const pasteClipboard = useCallback(() => {
    if (readOnlyRef.current) return;
    let src = clipboardRef.current;
    if (!src.length) {
      try {
        const raw = localStorage.getItem('kreo.clipboard');
        if (raw) src = JSON.parse(raw);
      } catch { /* ignore */ }
    }
    if (!src.length) return;
    checkpoint();
    const copies: KreoElement[] = clone(src).map((e: KreoElement) => {
      const c: KreoElement = { ...e, id: uid(), x: e.x + 32, y: e.y + 32, updatedAt: Date.now() };
      if (c.type === 'pen') {
        c.points = c.points.map((p: Pt) => ({ x: p.x + 32, y: p.y + 32 }));
      }
      return c;
    });
    applyElements([...elsRef.current, ...copies]);
    setSelected(copies.map((c) => c.id));
    broadcastElements();
    notify(`Pasted ${copies.length} element${copies.length > 1 ? 's' : ''}`);
  }, [notify]);

  const groupSelected = useCallback(() => {
    if (readOnlyRef.current || selRef.current.length < 2) return;
    checkpoint();
    const gid = uid('g');
    const ids = new Set(selRef.current);
    applyElements(elsRef.current.map((e) => (ids.has(e.id) ? { ...e, groupId: gid, updatedAt: Date.now() } : e)));
    broadcastElements();
    notify('Grouped');
  }, [notify]);

  const ungroupSelected = useCallback(() => {
    if (readOnlyRef.current || !selRef.current.length) return;
    checkpoint();
    const groups = new Set(
      elsRef.current.filter((e) => selRef.current.includes(e.id) && e.groupId).map((e) => e.groupId as string)
    );
    if (!groups.size) return;
    applyElements(elsRef.current.map((e) => (e.groupId && groups.has(e.groupId) ? { ...e, groupId: null, updatedAt: Date.now() } : e)));
    broadcastElements();
    notify('Ungrouped');
  }, [notify]);

  const lockSelected = useCallback((lock: boolean) => {
    if (readOnlyRef.current || !selRef.current.length) return;
    checkpoint();
    const ids = new Set(selRef.current);
    applyElements(elsRef.current.map((e) => (ids.has(e.id) ? { ...e, locked: lock, updatedAt: Date.now() } : e)));
    broadcastElements();
  }, []);

  const reorder = useCallback((dir: 'front' | 'back' | 'forward' | 'backward') => {
    if (readOnlyRef.current || !selRef.current.length) return;
    checkpoint();
    const els = [...elsRef.current];
    const ids = selRef.current;
    if (dir === 'front') {
      const moving = els.filter((e) => ids.includes(e.id));
      applyElements([...els.filter((e) => !ids.includes(e.id)), ...moving]);
    } else if (dir === 'back') {
      const moving = els.filter((e) => ids.includes(e.id));
      applyElements([...moving, ...els.filter((e) => !ids.includes(e.id))]);
    } else {
      const idx = (id: string) => els.findIndex((e) => e.id === id);
      const sorted = [...ids].sort((a, b) => idx(a) - idx(b));
      const order = dir === 'forward' ? [...sorted].reverse() : sorted;
      for (const id of order) {
        const i = idx(id);
        const j = dir === 'forward' ? Math.min(els.length - 1, i + 1) : Math.max(0, i - 1);
        if (i !== j && !ids.includes(els[j].id)) {
          [els[i], els[j]] = [els[j], els[i]];
        }
      }
      applyElements(els);
    }
    broadcastElements();
  }, []);

  const selectAll = useCallback(() => {
    setSelected(elsRef.current.filter((e) => !e.locked).map((e) => e.id));
    draw();
  }, [draw]);

  // ─── pointer engine ──────────────────────────────────────────────────────
  const handleAt = (sx: number, sy: number): string | null => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = sx - rect.left, py = sy - rect.top;
    for (const [k, p] of Object.entries(handlePosRef.current)) {
      if (Math.hypot(p.x - px, p.y - py) <= HANDLE_R + 3) return k;
    }
    return null;
  };

  const pickTop = (wx: number, wy: number): KreoElement | null => {
    const els = elsRef.current;
    for (let i = els.length - 1; i >= 0; i--) {
      if (hitTest(els[i], wx, wy)) return els[i];
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // pinch start
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      gestureRef.current = {
        mode: 'pinch', startWX: 0, startWY: 0, origCamX: viewRef.current.x, origCamY: viewRef.current.y,
        snapshot: [], pinchDist: Math.hypot(a.x - b.x, a.y - b.y), pinchZoom: viewRef.current.zoom,
      };
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const tool = toolRef.current;
    const isPan = tool === 'hand' || spaceRef.current || e.button === 1;

    if (isPan) {
      gestureRef.current = {
        mode: 'pan', startWX: e.clientX, startWY: e.clientY,
        origCamX: viewRef.current.x, origCamY: viewRef.current.y, snapshot: [],
      };
      return;
    }

    if (readOnlyRef.current) {
      // view-only: allow rubber pan via drag
      gestureRef.current = {
        mode: 'pan', startWX: e.clientX, startWY: e.clientY,
        origCamX: viewRef.current.x, origCamY: viewRef.current.y, snapshot: [],
      };
      return;
    }

    if (tool === 'select') {
      const h = handleAt(e.clientX, e.clientY);
      if (h && selRef.current.length) {
        const els = elsRef.current.filter((x) => selRef.current.includes(x.id));
        if (els.some((x) => x.locked)) return;
        const u = unionBox(els);
        if (h === 'rotate') {
          gestureRef.current = {
            mode: 'rotate', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0,
            snapshot: clone(elsRef.current),
            center: { x: u.x + u.w / 2, y: u.y + u.h / 2 },
            startAngle: Math.atan2(w.y - (u.y + u.h / 2), w.x - (u.x + u.w / 2)),
            origRot: els.length === 1 ? els[0].rotation : 0,
          };
        } else {
          gestureRef.current = {
            mode: 'resize', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0,
            snapshot: clone(elsRef.current), handle: h,
          };
        }
        return;
      }
      const hit = pickTop(w.x, w.y);
      if (hit && !hit.locked) {
        let ids = [hit.id];
        if (hit.groupId) {
          ids = elsRef.current.filter((x) => x.groupId === hit.groupId).map((x) => x.id);
        }
        if (e.shiftKey) {
          const cur = new Set(selRef.current);
          const allIn = ids.every((id) => cur.has(id));
          if (allIn) ids.forEach((id) => cur.delete(id));
          else ids.forEach((id) => cur.add(id));
          setSelected(expandByGroup(elsRef.current, [...cur]));
          draw();
          return;
        }
        if (!selRef.current.includes(hit.id)) {
          setSelected(ids);
        }
        gestureRef.current = {
          mode: 'move', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0,
          snapshot: clone(elsRef.current),
        };
        draw();
        return;
      }
      if (hit?.locked) {
        setSelected([hit.id]);
        draw();
        return;
      }
      // rubber select
      gestureRef.current = {
        mode: 'rubber', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0, snapshot: [],
      };
      rubberRef.current = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      if (!e.shiftKey) setSelected([]);
      return;
    }

    if (tool === 'eraser') {
      gestureRef.current = {
        mode: 'erase', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0,
        snapshot: clone(elsRef.current), eraseIds: new Set(),
      };
      checkpoint();
      eraseAt(w);
      return;
    }

    if (tool === 'pen') {
      const s = settingsRef.current;
      const el: KreoElement = {
        id: uid(), type: 'pen', x: w.x, y: w.y, w: 1, h: 1, rotation: 0,
        points: [{ x: w.x, y: w.y }],
        pressure: [e.pressure || 0.5],
        ...defaultElement('pen', s),
      } as KreoElement;
      draftRef.current = el;
      // clear selection so no handles hover over the drawing
      setSelected([]);
      gestureRef.current = {
        mode: 'pen', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0, snapshot: clone(elsRef.current),
      };
      draw();
      return;
    }

    if (tool === 'text') {
      // create via overlay editor at click point (editor opens on pointer-up)
      const s = settingsRef.current;
      const id = uid();
      const el = {
        id, type: 'text', x: snapVal(w.x, s.gridSize, s.snap), y: snapVal(w.y, s.gridSize, s.snap),
        w: 200, h: 40, rotation: 0, text: '', fontSize: 20,
        fontFamily: s.defaultFont, bold: false, italic: false, align: 'left', lineHeight: 1.3,
        ...defaultElement('text', s),
      } as KreoElement;
      checkpoint();
      const next = [...clone(elsRef.current), el];
      applyElements(next);
      // no selection while the editor is open — handles would stack under the edit box
      setSelected([]);
      broadcastElements();
      setTool('select');
      pendingTextRef.current = id;
      return;
    }

    if (tool === 'image') {
      fileRef.current?.click();
      return;
    }

    // shape tools: rect/diamond/ellipse/line/arrow
    gestureRef.current = {
      mode: 'create', startWX: w.x, startWY: w.y, origCamX: 0, origCamY: 0, snapshot: clone(elsRef.current),
    };
  };

  const eraseAt = (w: Pt) => {
    const g = gestureRef.current;
    if (!g?.eraseIds) return;
    const hit = pickTop(w.x, w.y);
    if (hit && !hit.locked) {
      g.eraseIds.add(hit.id);
      applyElements(elsRef.current.filter((e) => !g.eraseIds!.has(e.id)));
      setSelected((s) => s.filter((id) => !g.eraseIds!.has(id)));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    // presence cursor
    const now = Date.now();
    if (now - presenceTimer.current > 120) {
      presenceTimer.current = now;
      const w = toWorld(e.clientX, e.clientY);
      syncRef.current?.broadcast({
        kind: 'presence', clientId: identityRef.current.clientId,
        name: identityRef.current.name, color: identityRef.current.color,
        cursor: w, tool: toolRef.current, ts: now,
      });
    }

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = gestureRef.current;
    // pinch
    if (g?.mode === 'pinch' && pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist && g.pinchZoom && dist > 0) {
        const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
        zoomTo(midX, midY, g.pinchZoom * (dist / g.pinchDist));
      }
      return;
    }
    if (!g) {
      // hover cursor affordance
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const s = settingsRef.current;

    if (g.mode === 'pan') {
      // screen-delta panning: content must track the cursor exactly 1:1.
      // (Never derive the delta from world coords here — the camera itself
      // moves each frame, which would feed back and make content slip.)
      const v = viewRef.current;
      setViewBoth({
        ...v,
        x: g.origCamX - (e.clientX - g.startWX) / v.zoom,
        y: g.origCamY - (e.clientY - g.startWY) / v.zoom,
      });
      return;
    }
    if (readOnlyRef.current) return;

    if (g.mode === 'rubber') {
      rubberRef.current = { x0: g.startWX, y0: g.startWY, x1: w.x, y1: w.y };
      const r = rubberRef.current;
      const minX = Math.min(r.x0, r.x1), maxX = Math.max(r.x0, r.x1);
      const minY = Math.min(r.y0, r.y1), maxY = Math.max(r.y0, r.y1);
      const inside = elsRef.current.filter((el) => {
        const b = bboxOf(el);
        return b.x >= minX && b.x + b.w <= maxX && b.y >= minY && b.y + b.h <= maxY;
      }).map((el) => el.id);
      setSelected((prev) => {
        void prev;
        return expandByGroup(elsRef.current, e.shiftKey ? [...new Set([...selRef.current, ...inside])] : inside);
      });
      draw();
      return;
    }

    if (g.mode === 'move') {
      const dx = w.x - g.startWX, dy = w.y - g.startWY;
      const ids = new Set(selRef.current);
      const snap = s.snap;
      const next = g.snapshot.map((el) => {
        if (!ids.has(el.id)) return el;
        const nx = snapVal(baseX(el) + dx, s.gridSize, snap);
        const ny = snapVal(baseY(el) + dy, s.gridSize, snap);
        return shiftElement(el, nx - baseX(el), ny - baseY(el));
      });
      applyElementsNoHistory(next);
      return;
    }

    if (g.mode === 'resize' && g.handle) {
      const next = resizeSnapshot(g.snapshot, new Set(selRef.current), g.handle, g.startWX, g.startWY, w.x, w.y, e.shiftKey, s);
      applyElementsNoHistory(next);
      return;
    }

    if (g.mode === 'rotate' && g.center && g.startAngle !== undefined) {
      const ang = Math.atan2(w.y - g.center.y, w.x - g.center.x);
      let deg = ((ang - g.startAngle) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      const ids = new Set(selRef.current);
      const els = elsRef.current.filter((x) => ids.has(x.id));
      let next: KreoElement[];
      if (els.length === 1) {
        next = g.snapshot.map((el) =>
          ids.has(el.id) ? { ...el, rotation: ((g.origRot ?? 0) + deg) % 360, updatedAt: Date.now() } : el
        );
      } else {
        const c = g.center;
        next = g.snapshot.map((el) => {
          if (!ids.has(el.id)) return el;
          const b = bboxOf(el);
          const ex = b.x + b.w / 2, ey = b.y + b.h / 2;
          const rad = (deg * Math.PI) / 180;
          const nx = c.x + (ex - c.x) * Math.cos(rad) - (ey - c.y) * Math.sin(rad);
          const ny = c.y + (ex - c.x) * Math.sin(rad) + (ey - c.y) * Math.cos(rad);
          const moved = shiftElement(el, nx - ex, ny - ey);
          return { ...moved, rotation: (el.rotation + deg) % 360, updatedAt: Date.now() };
        });
      }
      applyElementsNoHistory(next);
      return;
    }

    if (g.mode === 'pen' && draftRef.current?.type === 'pen') {
      draftRef.current.points.push({ x: w.x, y: w.y });
      draftRef.current.pressure?.push(e.pressure || 0.5);
      draw();
      return;
    }

    if (g.mode === 'create') {
      draftRef.current = buildShape(toolRef.current, g.startWX, g.startWY, w.x, w.y, e.shiftKey, s);
      draw();
      return;
    }

    if (g.mode === 'erase') {
      eraseAt(w);
      return;
    }
  };

  const applyElementsNoHistory = (els: KreoElement[]) => {
    setBoard((b) => ({ ...b, elements: els, updatedAt: Date.now() }));
    draw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    // open a pending text editor only once the creating click fully completed
    // (and all pointers are up) so the click can't steal its focus
    if (pendingTextRef.current && pointersRef.current.size === 0) {
      const id = pendingTextRef.current;
      pendingTextRef.current = null;
      if (elsRef.current.some((el) => el.id === id)) {
        setEditingText({ id, draft: '' });
      }
    }
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (g.mode === 'pinch') return;
    if (g.mode === 'rubber') {
      rubberRef.current = null;
      draw();
      return;
    }
    if (g.mode === 'pan') return;
    if (readOnlyRef.current) return;

    if (g.mode === 'pen' && draftRef.current) {
      const d = draftRef.current;
      if (d.type === 'pen' && d.points.length > 1) {
        checkpoint();
        const final = finalizeStroke(d, settingsRef.current);
        let next = [...clone(elsRef.current), final];
        next = attachBelow(next, final.id);
        applyElements(next);
        // stay unselected so drawing flow is never interrupted by handles
        broadcastElements();
      }
      draftRef.current = null;
      draw();
      return;
    }
    if (g.mode === 'create' && draftRef.current) {
      const d = draftRef.current;
      const minSize = d.type === 'line' || d.type === 'arrow' ? 4 : 3;
      if (Math.abs(d.w) >= minSize || Math.abs(d.h) >= minSize) {
        checkpoint();
        const fixed = normalizeShape(d);
        fixed.updatedAt = Date.now();
        const next = [...clone(elsRef.current), clone(fixed)];
        applyElements(next);
        setSelected([fixed.id]);
        broadcastElements();
        // stay in shape tool for rapid creation; double-click/Escape or Select to leave
      }
      draftRef.current = null;
      draw();
      return;
    }
    // move / resize / rotate / erase → push snapshot history
    if (g.mode === 'move' || g.mode === 'resize' || g.mode === 'rotate' || g.mode === 'erase') {
      undoRef.current.push(g.snapshot);
      if (undoRef.current.length > 120) undoRef.current.shift();
      redoRef.current = [];
      setBoard((b) => ({ ...b, updatedAt: Date.now() }));
      broadcastElements();
      draw();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnlyRef.current) return;
    const w = toWorld(e.clientX, e.clientY);
    const hit = pickTop(w.x, w.y);
    if (hit?.type === 'text') {
      // edit without selection chrome; selection is restored on commit/cancel
      setSelected([]);
      setEditingText({ id: hit.id, draft: hit.text });
    }
  };

  // ─── wheel zoom (non-passive) ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.shiftKey) {
        setViewBoth({ ...viewRef.current, x: viewRef.current.x + (e.deltaY / viewRef.current.zoom) * 1 });
      } else {
        zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY * (e.ctrlKey ? 3 : 1)));
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === ' ' && !typing) {
        spaceRef.current = true;
        e.preventDefault();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if (typing) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (mod && k === 'c') { e.preventDefault(); copySelected(); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
      if (mod && k === 'x') { e.preventDefault(); copySelected(); deleteSelected(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'g' && !e.shiftKey) { e.preventDefault(); groupSelected(); return; }
      if (mod && k === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelected(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') {
        setSelected([]); setCtxMenu(null); setShowPalette(false); setShowShare(false);
        setTool('select'); draw(); return;
      }
      if (readOnlyRef.current) return;
      if (mod) return;
      const map: Record<string, ToolId> = {
        v: 'select', h: 'hand', r: 'rect', d: 'diamond', o: 'ellipse',
        l: 'line', a: 'arrow', p: 'pen', t: 'text', e: 'eraser', i: 'image',
      };
      if (map[k]) setTool(map[k]);
      // nudge
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
        if (!selRef.current.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        checkpoint();
        const ids = new Set(selRef.current);
        applyElements(elsRef.current.map((el) => (ids.has(el.id) ? shiftElement(el, dx, dy) : el)));
        broadcastElements();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceRef.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [undo, redo, copySelected, pasteClipboard, deleteSelected, duplicateSelected, selectAll, groupSelected, ungroupSelected, draw]);

  // ─── image upload ────────────────────────────────────────────────────────
  const addImageFiles = (files: FileList | File[]) => {
    if (readOnlyRef.current) return;
    const v = viewRef.current;
    const wrap = wrapRef.current!;
    const cx = v.x + wrap.clientWidth / 2 / v.zoom;
    const cy = v.y + wrap.clientHeight / 2 / v.zoom;
    [...files].forEach((f, i) => {
      if (!/image\/(png|jpe?g|webp|svg\+xml|svg|gif)/.test(f.type) && !/\.(png|jpe?g|webp|svg)$/i.test(f.name)) {
        notify(`Unsupported file: ${f.name}`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result as string;
        const img = new Image();
        img.onload = () => {
          checkpoint();
          const maxW = 520;
          const scale = Math.min(1, maxW / img.naturalWidth);
          const wpx = img.naturalWidth * scale, hpx = img.naturalHeight * scale;
          const el: KreoElement = {
            id: uid(), type: 'image',
            x: cx - wpx / 2 + i * 24, y: cy - hpx / 2 + i * 24, w: wpx, h: hpx, rotation: 0,
            stroke: '#1a1a1a', fill: 'transparent', strokeWidth: 2, strokeStyle: 'solid',
            opacity: 100, roughness: 0, roundness: 0, locked: false, groupId: null,
            createdAt: Date.now(), updatedAt: Date.now(),
            src, naturalW: img.naturalWidth, naturalH: img.naturalHeight,
          } as KreoElement;
          const next = [...clone(elsRef.current), el];
          applyElements(next);
          setSelected([el.id]);
          broadcastElements();
          draw();
        };
        img.onerror = () => notify('Could not load that image');
        img.src = src;
      };
      reader.readAsDataURL(f);
    });
    setTool('select');
  };

  // ─── context menu actions ────────────────────────────────────────────────
  const ctxAction = (fn: () => void) => () => {
    fn();
    setCtxMenu(null);
  };

  // ─── export / import ─────────────────────────────────────────────────────
  const doExportPNG = async (onlySelected: boolean) => {
    const els = onlySelected ? elements.filter((e) => selected.includes(e.id)) : elements;
    if (!els.length) return notify('Nothing to export');
    try {
      await exportPNG(els, board.background, boardName || 'kreo');
      notify('PNG exported');
    } catch { notify('Export failed'); }
  };
  const doExportSVG = (onlySelected: boolean) => {
    const els = onlySelected ? elements.filter((e) => selected.includes(e.id)) : elements;
    if (!els.length) return notify('Nothing to export');
    downloadFile(`${boardName || 'kreo'}.svg`, elementsToSVG(els, { background: board.background }), 'image/svg+xml');
    notify('SVG exported');
  };
  const doExportPDF = async (onlySelected: boolean) => {
    const els = onlySelected ? elements.filter((e) => selected.includes(e.id)) : elements;
    if (!els.length) return notify('Nothing to export');
    try {
      await exportPDF(els, board.background, boardName || 'kreo');
      notify('PDF exported');
    } catch { notify('Export failed'); }
  };
  const doExportJSON = () => {
    downloadFile(`${boardName || 'kreo'}.kreo.json`, JSON.stringify(board, null, 2), 'application/json');
    notify('Project exported — re-import anytime, shapes stay editable');
  };
  const doImportJSON = (f: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result as string);
        const els = (data.elements ?? data) as KreoElement[];
        if (!Array.isArray(els)) throw new Error('bad');
        checkpoint();
        const fresh = clone(els).map((el: KreoElement) => ({ ...el, id: uid(), updatedAt: Date.now() }));
        applyElements([...elsRef.current, ...fresh]);
        setSelected(fresh.map((e: KreoElement) => e.id));
        broadcastElements();
        fitView(fresh);
        notify(`Imported ${fresh.length} editable elements`);
      } catch {
        notify('Invalid project file');
      }
    };
    r.readAsText(f);
  };

  // ─── style panel changes ─────────────────────────────────────────────────
  const patchSelected = (patch: Partial<KreoElement>) => {
    if (!selRef.current.length) return;
    checkpoint();
    const ids = new Set(selRef.current);
    applyElements(elsRef.current.map((el) =>
      ids.has(el.id) ? ({ ...el, ...patch, updatedAt: Date.now() } as KreoElement) : el
    ));
    broadcastElements();
  };

  const selElements = useMemo(
    () => elements.filter((e) => selected.includes(e.id)),
    [elements, selected]
  );

  const saveLabel = readOnly
    ? 'View only'
    : saveState === 'saved' ? 'Saved'
    : saveState === 'saving' ? 'Saving…'
    : saveState === 'offline' ? 'Offline — changes kept locally'
    : 'Unsaved';

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: settings.theme === 'dark' ? '#23211d' : '#f3f1ec' }}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addImageFiles(e.dataTransfer.files);
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: cursorFor(tool, spaceRef), touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          syncRef.current?.broadcast({
            kind: 'presence', clientId: identityRef.current.clientId,
            name: identityRef.current.name, color: identityRef.current.color,
            cursor: null, tool: toolRef.current, ts: Date.now(),
          });
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          const w = toWorld(e.clientX, e.clientY);
          const hit = pickTop(w.x, w.y);
          if (hit && !selected.includes(hit.id)) {
            setSelected(hit.groupId ? elsRef.current.filter((x) => x.groupId === hit.groupId).map((x) => x.id) : [hit.id]);
          }
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        aria-label="KREO infinite canvas"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files?.length) addImageFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {elements.length === 0 && !draftRef.current && (
        <div className="kreo-hint">Start creating… — pick a tool or press P to draw</div>
      )}
      {sharedBanner && (
        <div style={{ position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 15, background: '#1a1a1a', color: '#fff', fontSize: 12.5, padding: '7px 14px', borderRadius: 999, boxShadow: 'var(--shadow-sm)' }}>
          {sharedBanner}
        </div>
      )}

      {/* remote cursors */}
      {[...presences.values()].map((p) =>
        p.cursor ? (
          <RemoteCursor key={p.clientId} p={p} view={view} />
        ) : null
      )}

      {/* top-left menu */}
      <div className="kreo-corner tl">
        <button className="kreo-btn icon" data-tip="Boards & menu" aria-label="Open boards" onClick={onExit}>
          <I.menu />
        </button>
        <div className="kreo-logo" style={{ fontSize: 16 }}>
          <span className="kreo-logo-mark" style={{ width: 28, height: 28, fontSize: 15 }}>K</span>
          <span style={{ fontWeight: 800 }}>KREO</span>
        </div>
        {renaming ? (
          <input
            autoFocus
            value={boardName}
            onChange={(e) => setBoardName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              setBoard((b) => ({ ...b, name: boardName || 'Untitled board' }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '5px 9px', fontSize: 13, width: 170 }}
            aria-label="Board name"
          />
        ) : (
          <button
            className="kreo-btn hide-m"
            data-tip="Rename board"
            onClick={() => !readOnly && setRenaming(true)}
            style={{ fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {boardName || 'Untitled board'}
          </button>
        )}
      </div>

      {/* top-right */}
      <div className="kreo-corner tr">
        <span className="kreo-save" role="status">
          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: saveState === 'saved' ? '#22c55e' : saveState === 'offline' ? '#ef4444' : '#eab308', marginRight: 6 }} />
          {saveLabel}
        </span>
        <div style={{ display: 'flex' }}>
          {[...presences.values()].slice(0, 4).map((p) => (
            <span key={p.clientId} className="kreo-avatar" style={{ background: p.color }} title={p.name}>
              {p.name[0]}
            </span>
          ))}
        </div>
        <button className="kreo-btn hide-m" data-tip="Undo (Ctrl+Z)" onClick={undo} disabled={readOnly} aria-label="Undo">
          <I.undo />
        </button>
        <button className="kreo-btn hide-m" data-tip="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={readOnly} aria-label="Redo">
          <I.redo />
        </button>
        <button className="kreo-btn primary" onClick={() => setShowShare(true)} aria-label="Share board">
          <I.share /> Share
        </button>
      </div>

      <Toolbar tool={tool} setTool={setTool} disabled={readOnly} onImage={() => fileRef.current?.click()} onMore={() => setShowPalette(true)} />

      {/* zoom */}
      <div className="kreo-zoom" role="toolbar" aria-label="Zoom controls">
        <button onClick={() => { const r = canvasRef.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25); }} data-tip="Zoom out" aria-label="Zoom out"><I.minus size={15} /></button>
        <span
          data-tip="Reset to 100%"
          onClick={() => { const r = canvasRef.current!.getBoundingClientRect(); setViewBoth({ ...viewRef.current, zoom: 1 }); void r; draw(); }}
          role="button" tabIndex={0} aria-label={`Zoom ${Math.round(view.zoom * 100)} percent, activate to reset`}
        >
          {Math.round(view.zoom * 100)}%
        </span>
        <button onClick={() => { const r = canvasRef.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); }} data-tip="Zoom in" aria-label="Zoom in"><I.plus size={15} /></button>
        <button onClick={() => fitView()} data-tip="Fit to screen" aria-label="Fit to screen"><I.fit size={15} /></button>
      </div>

      {/* bottom right */}
      <div className="kreo-br">
        <button className="kreo-btn icon" data-tip="Command palette (Ctrl+K)" onClick={() => setShowPalette(true)} aria-label="Commands"><I.search /></button>
        <button className="kreo-btn icon" data-tip="Help & shortcuts" onClick={() => setShowHelp((v) => !v)} aria-label="Help"><I.help /></button>
        <button className="kreo-btn icon" data-tip="Settings" onClick={() => setShowSettings(true)} aria-label="Settings"><I.gear /></button>
      </div>

      {selElements.length > 0 && !readOnly && (
        <StylePanel
          elements={selElements}
          onPatch={patchSelected}
          onAction={(a) => {
            if (a === 'delete') deleteSelected();
            if (a === 'duplicate') duplicateSelected();
            if (a === 'group') groupSelected();
            if (a === 'ungroup') ungroupSelected();
            if (a === 'lock') lockSelected(true);
            if (a === 'unlock') lockSelected(false);
            if (a === 'front' || a === 'back' || a === 'forward' || a === 'backward') reorder(a);
          }}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          hasSelection={selected.length > 0}
          onClose={() => setCtxMenu(null)}
          onAction={(a) => {
            setCtxMenu(null);
            if (readOnly && !['copy'].includes(a)) return;
            if (a === 'cut') { copySelected(); deleteSelected(); }
            if (a === 'copy') copySelected();
            if (a === 'paste') pasteClipboard();
            if (a === 'duplicate') duplicateSelected();
            if (a === 'delete') deleteSelected();
            if (a === 'group') groupSelected();
            if (a === 'ungroup') ungroupSelected();
            if (a === 'lock') lockSelected(true);
            if (a === 'unlock') lockSelected(false);
            if (['front', 'back', 'forward', 'backward'].includes(a)) reorder(a as any);
            if (a === 'selectAll') selectAll();
          }}
        />
      )}

      {editingText && (
        <TextOverlay
          board={board}
          view={view}
          id={editingText.id}
          draft={editingText.draft}
          setDraft={(d) => setEditingText({ id: editingText.id, draft: d })}
          onCommit={(text) => {
            // empty text = nothing to keep: remove the element instead of
            // leaving an invisible box behind
            if (!text.trim()) {
              const el = elsRef.current.find((e) => e.id === editingText.id);
              if (el?.type === 'text' && !el.text) {
                applyElements(elsRef.current.filter((e) => e.id !== editingText.id));
                setSelected([]);
                broadcastElements();
              }
              setEditingText(null);
              return;
            }
            checkpoint();
            const committed = text;
            const targetId = editingText.id;
            const mapped = elsRef.current.map((el) =>
              el.id === targetId && el.type === 'text'
                ? { ...el, text: committed, w: Math.max(60, measureW(committed, el)), h: measureH(committed, el), updatedAt: Date.now() }
                : el
            );
            // text typed on top of a shape sticks to that shape
            applyElements(attachBelow(mapped, targetId));
            broadcastElements();
            // select the finished text so it can be styled/moved right away
            setSelected([targetId]);
            setEditingText(null);
          }}
          onCancel={() => {
            // if brand-new empty text, remove it
            const el = elsRef.current.find((e) => e.id === editingText.id);
            if (el?.type === 'text' && !el.text && !editingText.draft) {
              applyElements(elsRef.current.filter((e) => e.id !== editingText.id));
              setSelected([]);
            } else {
              // keep editing target selected so it isn't lost
              setSelected([editingText.id]);
            }
            setEditingText(null);
          }}
        />
      )}

      {showShare && (
        <ShareModal board={board} onUpdate={(share) => setBoard((b) => ({ ...b, share }))} onClose={() => setShowShare(false)} notify={notify} />
      )}
      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onRun={(cmd) => {
            setShowPalette(false);
            runCommand(cmd, {
              setTool, fitView, selectAll, deleteSelected, groupSelected, ungroupSelected,
              undo, redo, copySelected, pasteClipboard, duplicateSelected, lockSelected,
              doExportPNG, doExportSVG, doExportPDF, doExportJSON, notify,
            });
          }}
        />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          boardBackground={board.background}
          onChange={(s) => {
            setSettings(s);
            settingsRef.current = s;
            saveSettings(s);
            draw();
          }}
          onBoardBg={(bg) => setBoard((b) => ({ ...b, background: bg }))}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}

      {/* hidden import input */}
      <input
        id="kreo-import-input"
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) doImportJSON(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ─── element transform helpers ─────────────────────────────────────────────
function baseX(el: KreoElement): number {
  return el.type === 'pen' ? Math.min(...el.points.map((p) => p.x)) : el.x;
}
function baseY(el: KreoElement): number {
  return el.type === 'pen' ? Math.min(...el.points.map((p) => p.y)) : el.y;
}

function shiftElement<T extends KreoElement>(el: T, dx: number, dy: number): T {
  if (el.locked) return el;
  if (el.type === 'pen') {
    return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), x: el.x + dx, y: el.y + dy, updatedAt: Date.now() };
  }
  if (el.type === 'triangle') {
    return { ...el, x: el.x + dx, y: el.y + dy, pts: el.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), updatedAt: Date.now() };
  }
  return { ...el, x: el.x + dx, y: el.y + dy, updatedAt: Date.now() };
}

function resizeSnapshot(
  snapshot: KreoElement[], ids: Set<string>, handle: string,
  x0: number, y0: number, x1: number, y1: number,
  keepAspect: boolean, s: AppSettings
): KreoElement[] {
  const targets = snapshot.filter((e) => ids.has(e.id) && !e.locked);
  if (!targets.length) return snapshot;
  const u = unionBox(targets);
  let { x, y, w, h } = u;
  if (handle.includes('e')) w = x1 - x;
  if (handle.includes('s')) h = y1 - y;
  if (handle.includes('w')) { w = (x + u.w) - x1; x = x1; }
  if (handle.includes('n')) { h = (y + u.h) - y1; y = y1; }
  if (keepAspect) {
    const ratio = u.w / Math.max(1, u.h);
    if (Math.abs(w) / Math.max(1, Math.abs(h)) > ratio) w = Math.sign(w || 1) * Math.abs(h) * ratio;
    else h = Math.sign(h || 1) * Math.abs(w) / ratio;
    if (handle.includes('w')) x = u.x + u.w - w;
    if (handle.includes('n')) y = u.y + u.h - h;
  }
  // flip normalize
  let nx = w < 0 ? x + w : x;
  let ny = h < 0 ? y + h : y;
  const nw = Math.max(2, Math.abs(w)), nh = Math.max(2, Math.abs(h));
  if (s.snap) {
    nx = snapVal(nx, s.gridSize, true);
    ny = snapVal(ny, s.gridSize, true);
  }
  const sx = nw / Math.max(1, u.w), sy = nh / Math.max(1, u.h);
  const mapPt = (px: number, py: number): Pt => ({ x: nx + (px - u.x) * sx, y: ny + (py - u.y) * sy });
  return snapshot.map((el) => {
    if (!ids.has(el.id) || el.locked) return el;
    if (el.type === 'pen') {
      return { ...el, points: el.points.map((p) => mapPt(p.x, p.y)), updatedAt: Date.now() };
    }
    if (el.type === 'line' || el.type === 'arrow') {
      const a = mapPt(el.x, el.y), b = mapPt(el.x + el.w, el.y + el.h);
      return { ...el, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y, updatedAt: Date.now() };
    }
    if (el.type === 'text') {
      const a = mapPt(el.x, el.y);
      return { ...el, x: a.x, y: a.y, w: Math.max(20, nw), h: Math.max(10, nh), updatedAt: Date.now() };
    }
    if (el.type === 'triangle') {
      const a = mapPt(el.x, el.y);
      const ex2 = mapPt(el.x + el.w, el.y + el.h);
      const mapped = el.pts.map((p) => mapPt(p.x, p.y));
      let tminX = Infinity, tminY = Infinity, tmaxX = -Infinity, tmaxY = -Infinity;
      for (const p of mapped) {
        tminX = Math.min(tminX, p.x); tminY = Math.min(tminY, p.y);
        tmaxX = Math.max(tmaxX, p.x); tmaxY = Math.max(tmaxY, p.y);
      }
      void a; void ex2;
      return {
        ...el, x: tminX, y: tminY,
        w: Math.max(2, tmaxX - tminX), h: Math.max(2, tmaxY - tminY),
        pts: mapped, updatedAt: Date.now(),
      };
    }
    const a = mapPt(el.x, el.y);
    const ex2 = mapPt(el.x + el.w, el.y + el.h);
    return {
      ...el, x: Math.min(a.x, ex2.x), y: Math.min(a.y, ex2.y),
      w: Math.max(2, Math.abs(ex2.x - a.x)), h: Math.max(2, Math.abs(ex2.y - a.y)),
      updatedAt: Date.now(),
    };
  });
}

function buildShape(tool: ToolId, x0: number, y0: number, x1: number, y1: number, square: boolean, s: AppSettings): KreoElement {
  const sx = snapVal(x0, s.gridSize, s.snap), sy = snapVal(y0, s.gridSize, s.snap);
  let ex = snapVal(x1, s.gridSize, s.snap), ey = snapVal(y1, s.gridSize, s.snap);
  const base = {
    id: 'draft', rotation: 0, stroke: s.defaultStroke,
    fill: s.defaultFill, strokeWidth: s.defaultStrokeWidth, strokeStyle: 'solid' as const,
    opacity: 100, roughness: s.defaultRoughness, roundness: 0.3,
    locked: false, groupId: null, createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (tool === 'arrow') {
    const el: KreoElement = {
      ...base, type: 'arrow',
      x: sx, y: sy, w: ex - sx, h: ey - sy,
      startArrow: false, endArrow: true,
    };
    return el;
  }
  if (tool === 'line') {
    const el: KreoElement = {
      ...base, type: 'line',
      x: sx, y: sy, w: ex - sx, h: ey - sy,
    };
    return el;
  }
  let w = ex - sx, h = ey - sy;
  if (square) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
    ex = sx + w; ey = sy + h;
  }
  void ex; void ey;
  const x = Math.min(sx, sx + w), y = Math.min(sy, sy + h);
  const ww = Math.abs(w), hh = Math.abs(h);
  return { ...base, type: tool as 'rect' | 'diamond' | 'ellipse', x, y, w: ww, h: hh } as KreoElement;
}

function normalizeShape(el: KreoElement): KreoElement {
  if ((el.type === 'line' || el.type === 'arrow') && (Math.abs(el.w) < 2 && Math.abs(el.h) < 2)) {
    return { ...el, w: 2, h: 2 };
  }
  return el;
}

/**
 * Ink drawn (or typed) on top of a shape joins that shape: both get the same
 * groupId so they move/resize together and never drift apart.
 * Only attaches ungrouped newcomers to the topmost overlapping shape host.
 */
function attachBelow(list: KreoElement[], createdId: string): KreoElement[] {
  const created = list.find((e) => e.id === createdId);
  if (!created || created.groupId) return list;
  const bb = bboxOf(created);
  if (bb.w <= 0 || bb.h <= 0) return list;
  const hosts = ['rect', 'ellipse', 'diamond', 'triangle', 'image'];
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h.id === createdId || h.locked || !hosts.includes(h.type)) continue;
    const hb = bboxOf(h);
    const ix = Math.max(0, Math.min(bb.x + bb.w, hb.x + hb.w) - Math.max(bb.x, hb.x));
    const iy = Math.max(0, Math.min(bb.y + bb.h, hb.y + hb.h) - Math.max(bb.y, hb.y));
    if (ix > 2 && iy > 2) {
      const gid = h.groupId ?? uid('g');
      const now = Date.now();
      return list.map((e) =>
        e.id === createdId || e.id === h.id ? { ...e, groupId: gid, updatedAt: now } : e
      );
    }
  }
  return list;
}

/**
 * Convert a finished freehand stroke into its final element: a recognized
 * clean shape (ellipse/rect/triangle/diamond/line/arrow) when auto-correct
 * is on and confident, otherwise the raw smoothed pen stroke.
 */
function finalizeStroke(d: Extract<KreoElement, { type: 'pen' }>, s: AppSettings): KreoElement {
  const pts = d.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const base = {
    id: d.id, rotation: 0, stroke: d.stroke, fill: 'transparent' as string,
    strokeWidth: d.strokeWidth, strokeStyle: d.strokeStyle, opacity: d.opacity,
    roughness: d.roughness, roundness: 0.3, locked: false, groupId: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (s.autoCorrect) {
    try {
      const reco = recognizeStroke(pts);
      const box = reco.box;
      if (reco.kind === 'ellipse' || reco.kind === 'rect' || reco.kind === 'diamond') {
        return { ...base, type: reco.kind, x: box.x, y: box.y, w: box.w, h: box.h } as KreoElement;
      }
      if (reco.kind === 'triangle' && reco.corners.length >= 3) {
        const c = reco.corners.slice(0, 3);
        let tminX = Infinity, tminY = Infinity, tmaxX = -Infinity, tmaxY = -Infinity;
        for (const p of c) {
          tminX = Math.min(tminX, p.x); tminY = Math.min(tminY, p.y);
          tmaxX = Math.max(tmaxX, p.x); tmaxY = Math.max(tmaxY, p.y);
        }
        return {
          ...base, type: 'triangle', x: tminX, y: tminY,
          w: Math.max(2, tmaxX - tminX), h: Math.max(2, tmaxY - tminY), pts: c,
        } as KreoElement;
      }
      if ((reco.kind === 'line' || reco.kind === 'arrow') && reco.ends) {
        const [a, b] = reco.ends;
        return {
          ...base, type: reco.kind, x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y,
          ...(reco.kind === 'arrow' ? { startArrow: false, endArrow: true } : {}),
        } as KreoElement;
      }
    } catch {
      // fall through to raw pen on any recognizer surprise
    }
  }
  return {
    ...clone(d), x: minX, y: minY,
    w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), updatedAt: Date.now(),
  };
}

function cursorFor(tool: ToolId, spaceRef: React.MutableRefObject<boolean>): string {
  if (spaceRef.current) return 'grab';
  switch (tool) {
    case 'hand': return 'grab';
    case 'select': return 'default';
    case 'eraser': return 'cell';
    case 'text': return 'text';
    default: return 'crosshair';
  }
}

function measureW(text: string, el: Extract<KreoElement, { type: 'text' }>): number {
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700 ' : '400 '}${el.fontSize}px ${el.fontFamily}`;
  const lines = (text || 'M').split('\n');
  return Math.max(60, ...lines.map((l) => c.measureText(l || ' ').width)) + 16;
}
function measureH(text: string, el: Extract<KreoElement, { type: 'text' }>): number {
  return Math.max(24, text.split('\n').length * el.fontSize * el.lineHeight + 8);
}

// ─── remote cursor ──────────────────────────────────────────────────────────
function RemoteCursor({ p, view }: { p: PresenceMsg; view: { x: number; y: number; zoom: number } }) {
  if (!p.cursor) return null;
  const sx = (p.cursor.x - view.x) * view.zoom;
  const sy = (p.cursor.y - view.y) * view.zoom;
  return (
    <div style={{ position: 'absolute', left: sx, top: sy, zIndex: 10, pointerEvents: 'none' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill={p.color}>
        <path d="M6 3l14 7-6.5 1.5L10 18 6 3z" stroke="#fff" strokeWidth="1.5" />
      </svg>
      <span style={{ background: p.color, color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 999, marginLeft: 12, whiteSpace: 'nowrap' }}>
        {p.name}
      </span>
    </div>
  );
}

// ─── text overlay ───────────────────────────────────────────────────────────
function TextOverlay({ board, view, id, draft, setDraft, onCommit, onCancel }: {
  board: Board; view: { x: number; y: number; zoom: number };
  id: string; draft: string; setDraft: (d: string) => void;
  onCommit: (t: string) => void; onCancel: () => void;
}) {
  const el = board.elements.find((e) => e.id === id);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // focus after paint; autoFocus attr covers mount timing edge cases
    const t = window.setTimeout(() => taRef.current?.focus(), 0);
    taRef.current?.focus();
    return () => window.clearTimeout(t);
  }, []);
  if (!el || el.type !== 'text') return null;
  const sx = (el.x - view.x) * view.zoom;
  const sy = (el.y - view.y) * view.zoom;
  return (
    <textarea
      ref={taRef}
      className="kreo-textedit"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          onCommit(draft);
        }
        e.stopPropagation();
      }}
      placeholder="Type…"
      aria-label="Edit text"
      style={{
        left: sx - 8, top: sy - 8,
        minWidth: Math.max(140, el.w * view.zoom + 16),
        minHeight: Math.max(40, el.h * view.zoom + 16),
        font: `${el.italic ? 'italic ' : ''}${el.bold ? '700 ' : '400 '}${el.fontSize * view.zoom}px ${el.fontFamily}`,
        color: el.stroke, lineHeight: el.lineHeight, textAlign: el.align,
        background: board.background,
      }}
    />
  );
}

// ─── help panel ─────────────────────────────────────────────────────────────
function HelpPanel({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['V / H', 'Select / Hand'],
    ['R D O L A P T E', 'Shapes, arrow, pen, text, eraser'],
    ['Pen sketches', 'Circles, rects, triangles, lines, arrows auto-correct (toggle in Settings)'],
    ['Ink on shapes', 'Strokes/text drawn on a shape stick to it and move together'],
    ['Space + drag', 'Pan anywhere'],
    ['Wheel / Shift+wheel', 'Zoom / pan horizontally'],
    ['Ctrl+K', 'Command palette'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['Ctrl+C X V D', 'Copy, cut, paste, duplicate'],
    ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'],
    ['Ctrl+A / Del / Esc', 'Select all / delete / deselect'],
    ['Double-click text', 'Edit text on canvas'],
    ['Right-click', 'Context menu (order, lock…)'],
  ];
  return (
    <div className="kreo-overlay" onClick={onClose}>
      <div className="kreo-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Help and shortcuts">
        <h2>Shortcuts</h2>
        <p className="sub">KREO is fully keyboard-driven.</p>
        {rows.map(([k, v]) => (
          <div key={k} className="kreo-toggle"><span style={{ fontWeight: 700, fontSize: 12.5 }}>{k}</span><span style={{ color: 'var(--muted)', fontSize: 13 }}>{v}</span></div>
        ))}
        <div className="kreo-actions">
          <button className="kreo-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export type CommandId =
  | 'tool-rect' | 'tool-text' | 'tool-pen' | 'tool-arrow' | 'tool-ellipse'
  | 'zoom-fit' | 'zoom-100' | 'export-png' | 'export-svg' | 'export-pdf' | 'export-json'
  | 'copy-image' | 'delete' | 'group' | 'ungroup' | 'lock' | 'duplicate' | 'select-all'
  | 'bg-change' | 'toggle-grid' | 'undo' | 'redo';

function runCommand(cmd: CommandId, api: {
  setTool: (t: ToolId) => void; fitView: () => void; selectAll: () => void;
  deleteSelected: () => void; groupSelected: () => void; ungroupSelected: () => void;
  undo: () => void; redo: () => void; copySelected: () => void; pasteClipboard: () => void;
  duplicateSelected: () => void; lockSelected: (b: boolean) => void;
  doExportPNG: (s: boolean) => void; doExportSVG: (s: boolean) => void;
  doExportPDF: (s: boolean) => void; doExportJSON: () => void; notify: (m: string) => void;
}) {
  switch (cmd) {
    case 'tool-rect': api.setTool('rect'); break;
    case 'tool-text': api.setTool('text'); break;
    case 'tool-pen': api.setTool('pen'); break;
    case 'tool-arrow': api.setTool('arrow'); break;
    case 'tool-ellipse': api.setTool('ellipse'); break;
    case 'zoom-fit': api.fitView(); break;
    case 'zoom-100': api.notify('Use zoom % to reset to 100%'); break;
    case 'export-png': api.doExportPNG(false); break;
    case 'export-svg': api.doExportSVG(false); break;
    case 'export-pdf': api.doExportPDF(false); break;
    case 'export-json': api.doExportJSON(); break;
    case 'copy-image': api.notify('Select elements, right-click → Copy as image (or export PNG)'); break;
    case 'delete': api.deleteSelected(); break;
    case 'group': api.groupSelected(); break;
    case 'ungroup': api.ungroupSelected(); break;
    case 'lock': api.lockSelected(true); break;
    case 'duplicate': api.duplicateSelected(); break;
    case 'select-all': api.selectAll(); break;
    case 'undo': api.undo(); break;
    case 'redo': api.redo(); break;
    case 'bg-change': api.notify('Open Settings (gear) → Canvas background'); break;
    case 'toggle-grid': api.notify('Open Settings (gear) → Grid'); break;
  }
}

export { smoothPoints, PALETTE, SHORTCUTS };
