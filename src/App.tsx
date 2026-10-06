import { useCallback, useEffect, useState } from 'react';
import type { Board } from './types';
import Dashboard from './components/Dashboard';
import Editor from './components/Editor';
import { createBoard, decodePortableHash, listBoards, loadBoard, saveBoard } from './lib/storage';

type Route =
  | { name: 'dash' }
  | { name: 'board'; id: string }
  | { name: 'shared'; id: string };

function parseHash(): Route {
  const h = window.location.hash || '#/';
  if (h.startsWith('#/board/')) {
    return { name: 'board', id: h.slice(8).split('?')[0] };
  }
  if (h.startsWith('#/s/')) {
    return { name: 'shared', id: h.slice(4).split('?')[0] };
  }
  return { name: 'dash' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash());
  const [toast, setToast] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((notify as any)._t);
    (notify as any)._t = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash());
      setTick((t) => t + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // ensure at least one board exists for first-run delight
  useEffect(() => {
    if (!listBoards().length) {
      const b = createBoard('My first board');
      void b;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <>
      {route.name === 'dash' && (
        <Dashboard key="dash" onOpen={(id) => go(`#/board/${id}`)} notify={notify} />
      )}

      {route.name === 'board' && (
        <BoardRoute key={`b-${route.id}-${tick}`} id={route.id} onExit={() => go('#/')} notify={notify} />
      )}

      {route.name === 'shared' && (
        <SharedRoute key={`s-${route.id}-${tick}`} id={route.id} onExit={() => go('#/')} notify={notify} />
      )}

      {toast && <div className="kreo-toast" role="status">{toast}</div>}
    </>
  );
}

function BoardRoute({ id, onExit, notify }: { id: string; onExit: () => void; notify: (m: string) => void }) {
  const [board] = useState<Board | null>(() => loadBoard(id));
  if (!board) {
    return (
      <div className="kreo-dash">
        <div className="kreo-dash-inner" style={{ textAlign: 'center', paddingTop: 80 }}>
          <h2>Board not found</h2>
          <p style={{ color: 'var(--muted)' }}>
            This link is invalid, or the board was deleted on this device.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="kreo-btn" onClick={onExit}>Back to boards</button>
            <button
              className="kreo-btn primary"
              onClick={() => {
                const b = createBoard('Untitled board');
                window.location.hash = `#/board/${b.id}`;
              }}
            >
              New board
            </button>
          </div>
        </div>
      </div>
    );
  }
  const readOnly = board.share.mode === 'public' && board.share.permission === 'view' && new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('v') === '1';
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Editor initial={board} readOnly={readOnly} onExit={onExit} notify={notify} />
    </div>
  );
}

function SharedRoute({ id, onExit, notify }: { id: string; onExit: () => void; notify: (m: string) => void }) {
  const [board] = useState<Board | null>(() => {
    // 1. local board with this id?
    const local = loadBoard(id);
    if (local) return local;
    // 2. portable payload embedded in URL?
    const decoded = decodePortableHash(window.location.hash);
    if (decoded) {
      const now = Date.now();
      return {
        id, name: decoded.name, createdAt: now, updatedAt: now,
        elements: decoded.elements, view: { x: 0, y: 0, zoom: 1 },
        share: { mode: 'public' as const, permission: (decoded.permission === 'edit' ? 'edit' : 'view') as 'view' | 'edit' },
        background: decoded.background, grid: false, snap: false,
      } as Board;
    }
    return null;
  });

  if (!board) {
    return (
      <div className="kreo-dash">
        <div className="kreo-dash-inner" style={{ textAlign: 'center', paddingTop: 80 }}>
          <h2>Shared board unavailable</h2>
          <p style={{ color: 'var(--muted)' }}>The link is invalid or has expired.</p>
          <button className="kreo-btn" onClick={onExit} style={{ marginTop: 12 }}>Back to boards</button>
        </div>
      </div>
    );
  }

  const readOnly = board.share.permission === 'view';
  const banner = readOnly ? `Viewing shared board “${board.name}” — view only` : `Viewing shared board “${board.name}”`;

  const fork = () => {
    const now = Date.now();
    const copy: Board = {
      ...JSON.parse(JSON.stringify(board)),
      id: `fork_${now.toString(36)}`,
      name: `${board.name} (shared copy)`,
      createdAt: now, updatedAt: now,
      share: { mode: 'private', permission: 'edit' },
    };
    saveBoard(copy);
    notify('Saved a copy to your boards');
    window.location.hash = `#/board/${copy.id}`;
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Editor initial={board} readOnly={readOnly} sharedBanner={banner} onExit={onExit} notify={notify} />
      <button
        className="kreo-btn primary"
        onClick={fork}
        style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}
      >
        Save a copy to my boards
      </button>
    </div>
  );
}
