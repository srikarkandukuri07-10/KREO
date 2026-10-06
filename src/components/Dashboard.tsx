import { useMemo, useState } from 'react';
import type { Board } from '../types';
import { createBoard, deleteBoard, duplicateBoard, listBoards, loadBoard } from '../lib/storage';
import { contentBounds } from '../lib/geometry';
import { I } from './icons';

interface Props {
  onOpen: (id: string) => void;
  notify: (msg: string) => void;
}

export default function Dashboard({ onOpen, notify }: Props) {
  const [boards, setBoards] = useState<Board[]>(() => listBoards());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');

  const refresh = () => setBoards(listBoards());
  const filtered = useMemo(
    () => boards.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())),
    [boards, q]
  );

  const create = () => {
    const b = createBoard('Untitled board');
    notify('New board created');
    onOpen(b.id);
  };

  return (
    <div className="kreo-dash">
      <div className="kreo-dash-inner">
        <div className="kreo-dash-head">
          <div className="kreo-logo">
            <span className="kreo-logo-mark">K</span> KREO
            <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--muted)', marginLeft: 6 }}>infinite canvas</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search boards…"
                aria-label="Search boards"
                style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '9px 12px 9px 34px', fontSize: 13, width: 200, background: '#fff' }}
              />
              <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--muted)' }}><I.search size={15} /></span>
            </div>
            <button className="kreo-btn primary" onClick={create}><I.plus /> New board</button>
          </div>
        </div>

        <div className="kreo-grid">
          <button className="kreo-new" onClick={create} aria-label="Create new board">
            <span style={{ fontSize: 28, lineHeight: 1 }}>+</span>
            New board
          </button>
          {filtered.map((b) => (
            <div key={b.id} className="kreo-card" onClick={() => onOpen(b.id)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(b.id); }} aria-label={`Open ${b.name}`}>
              <div className="kreo-thumb" style={{ background: b.background }}>
                <MiniPreview board={b} />
              </div>
              <div className="kreo-card-body" onClick={(e) => e.stopPropagation()}>
                {renaming === b.id ? (
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => {
                      const cur = loadBoard(b.id);
                      if (cur && name.trim()) {
                        cur.name = name.trim();
                        cur.updatedAt = Date.now();
                        import('../lib/storage').then(({ saveBoard }) => saveBoard(cur));
                        refresh();
                      }
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 8px', fontSize: 14, width: '100%' }}
                    aria-label="Board name"
                  />
                ) : (
                  <b onDoubleClick={() => { setRenaming(b.id); setName(b.name); }} title="Double-click to rename">{b.name}</b>
                )}
                <small>
                  {b.elements.length} element{b.elements.length === 1 ? '' : 's'} · {new Date(b.updatedAt).toLocaleDateString()} · /board/{b.id}
                </small>
                <div className="kreo-card-menu">
                  <button onClick={() => onOpen(b.id)}>Open</button>
                  <button onClick={() => { setRenaming(b.id); setName(b.name); }}>Rename</button>
                  <button onClick={() => { duplicateBoard(b); refresh(); notify('Board duplicated'); }}>Duplicate</button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete “${b.name}”?`)) {
                        deleteBoard(b.id);
                        refresh();
                        notify('Board deleted');
                      }
                    }}
                    style={{ color: '#b42318' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {!filtered.length && boards.length > 0 && (
          <p style={{ color: 'var(--muted)', marginTop: 20 }}>No boards match “{q}”.</p>
        )}
      </div>
    </div>
  );
}

function MiniPreview({ board }: { board: Board }) {
  const b = contentBounds(board.elements);
  if (!b) return <span>Blank canvas</span>;
  const sx = 200 / Math.max(1, b.w), sy = 100 / Math.max(1, b.h);
  const s = Math.min(sx, sy, 4);
  return (
    <svg width="100%" height="100%" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} preserveAspectRatio="xMidYMid meet">
      {board.elements.slice(0, 60).map((el) => {
        if (el.type === 'triangle' && el.pts?.length >= 3) {
          return <polygon key={el.id} points={el.pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={el.fill === 'transparent' ? 'none' : el.fill} stroke={el.stroke} strokeWidth={Math.max(1, 2 / s)} />;
        }
        if (el.type === 'rect' || el.type === 'diamond' || el.type === 'ellipse') {
          return <rect key={el.id} x={el.x} y={el.y} width={Math.max(1, el.w)} height={Math.max(1, el.h)} fill={el.fill === 'transparent' ? 'none' : el.fill} stroke={el.stroke} strokeWidth={Math.max(1, 2 / s)} />;
        }
        if (el.type === 'pen' && el.points.length > 1) {
          return <polyline key={el.id} points={el.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={el.stroke} strokeWidth={Math.max(1, 3 / s)} strokeLinecap="round" />;
        }
        if (el.type === 'text') {
          return <rect key={el.id} x={el.x} y={el.y} width={Math.max(4, el.w)} height={Math.max(4, el.h)} fill="#d8d3c8" />;
        }
        return <circle key={el.id} cx={el.x} cy={el.y} r={3 / s + 1} fill={el.stroke} />;
      })}
    </svg>
  );
}
