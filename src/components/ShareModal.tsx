import { useEffect, useRef, useState } from 'react';
import type { Board } from '../types';
import { boardUrl, createPortableLink } from '../lib/storage';
import { I } from './icons';

interface Props {
  board: Board;
  onUpdate: (share: Board['share']) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

// links above this length may get truncated by messaging apps
const LINK_WARN_CHARS = 15000;

export default function ShareModal({ board, onUpdate, onClose, notify }: Props) {
  const [mode, setMode] = useState<Board['share']['mode']>(board.share.mode);
  const [permission, setPermission] = useState<Board['share']['permission']>(board.share.permission);
  const [copied, setCopied] = useState(false);
  const [portable, setPortable] = useState<{ url: string; chars: number } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onUpdate({ mode, permission });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, permission]);

  // build the cross-device link whenever it becomes relevant
  useEffect(() => {
    if (mode !== 'public') {
      setPortable(null);
      return;
    }
    let live = true;
    setPreparing(true);
    createPortableLink({ ...board, share: { mode, permission } })
      .then((p) => {
        if (live) setPortable(p);
      })
      .catch(() => {
        if (live) setPortable(null);
      })
      .finally(() => {
        if (live) setPreparing(false);
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, permission]);

  const shareSuffix = permission === 'view' ? '?v=1' : '';
  const localLink = `${boardUrl(board.id)}${shareSuffix}`;

  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      linkRef.current?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    notify(msg);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="kreo-overlay" onClick={onClose}>
      <div className="kreo-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share board">
        <h2>Share “{board.name}”</h2>
        <p className="sub">
          {mode === 'public'
            ? `Anyone with the link opens this exact board${permission === 'view' ? ' (view-only)' : ''} — on any device, no account.`
            : 'Only you, on this device.'}
        </p>

        <div className="kreo-field">
          <label htmlFor="kreo-share-mode">Link access</label>
          <select id="kreo-share-mode" value={mode} onChange={(e) => setMode(e.target.value as 'private' | 'public')}>
            <option value="public">Anyone with the link</option>
            <option value="private">Private — only me</option>
          </select>
        </div>

        <div className="kreo-field">
          <label htmlFor="kreo-share-perm">Permission</label>
          <select id="kreo-share-perm" value={permission} onChange={(e) => setPermission(e.target.value as 'view' | 'edit')}>
            <option value="edit">Can edit</option>
            <option value="view">Can view</option>
          </select>
        </div>

        {mode === 'public' ? (
          <div className="kreo-field">
            <label>Share link — /s/{board.id} (works on any device)</label>
            <div className="kreo-linkbox">
              <input
                ref={linkRef}
                readOnly
                value={preparing ? 'Preparing link…' : portable ? portable.url : 'Could not prepare link'}
                onFocus={(e) => e.target.select()}
                aria-label="Share link"
              />
              <button
                className="kreo-btn primary"
                disabled={!portable}
                onClick={() => portable && copy(portable.url, permission === 'view' ? 'View-only link copied — works on any device' : 'Share link copied — works on any device')}
              >
                {copied ? <I.check /> : <I.copy />} Copy link
              </button>
            </div>
            {portable && portable.chars > LINK_WARN_CHARS && (
              <p className="sub" style={{ marginTop: 8 }}>
                This board is large ({(portable.chars / 1024).toFixed(0)} KB of link). If the link gets cut off in
                chat apps, export the project JSON instead (More actions → Export project JSON).
              </p>
            )}
          </div>
        ) : (
          <div className="kreo-field">
            <label>Private link — /board/{board.id} (only you, on this device)</label>
            <div className="kreo-linkbox">
              <input ref={linkRef} readOnly value={localLink} onFocus={(e) => e.target.select()} aria-label="Private link" />
              <button className="kreo-btn primary" onClick={() => copy(localLink, 'Private link copied')}>
                {copied ? <I.check /> : <I.copy />} Copy link
              </button>
            </div>
          </div>
        )}

        <div className="kreo-actions">
          <button className="kreo-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
