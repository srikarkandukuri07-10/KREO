import { useEffect, useRef, useState } from 'react';
import type { Board } from '../types';
import { boardUrl, encodePortableLink } from '../lib/storage';
import { I } from './icons';

interface Props {
  board: Board;
  onUpdate: (share: Board['share']) => void;
  onClose: () => void;
  notify: (msg: string) => void;
}

export default function ShareModal({ board, onUpdate, onClose, notify }: Props) {
  const [mode, setMode] = useState<Board['share']['mode']>(board.share.mode);
  const [permission, setPermission] = useState<Board['share']['permission']>(board.share.permission);
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onUpdate({ mode, permission });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, permission]);

  const shareSuffix = permission === 'view' ? '?v=1' : '';
  const liveLink = mode === 'private'
    ? `${boardUrl(board.id)}${shareSuffix} (only you, on this device)`
    : `${boardUrl(board.id)}${shareSuffix}`;

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
        <p className="sub">Anyone with the link below opens this exact board{permission === 'view' ? ' (view-only)' : ''}.</p>

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

        <div className="kreo-field">
          <label>Share link — /board/{board.id}</label>
          <div className="kreo-linkbox">
            <input ref={linkRef} readOnly value={liveLink} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <button
              className="kreo-btn primary"
              disabled={mode === 'private'}
              onClick={() => copy(`${boardUrl(board.id)}${shareSuffix}`, permission === 'view' ? 'View-only link copied' : 'Share link copied')}
              data-tip={mode === 'private' ? 'Set access to “Anyone with the link” first' : 'Copy link'}
            >
              {copied ? <I.check /> : <I.copy />} Copy link
            </button>
          </div>
        </div>

        <div className="kreo-field">
          <label>Portable link (works on any device, no account)</label>
          <div className="kreo-linkbox">
            <input readOnly value="Embeds a snapshot of this board in the URL" aria-label="Portable link info" />
            <button
              className="kreo-btn"
              onClick={() => {
                try {
                  copy(encodePortableLink(board), 'Portable link copied — friends can open & fork it');
                } catch {
                  notify('Board too large for a portable link — export JSON instead');
                }
              }}
            >
              Copy
            </button>
          </div>
        </div>

        <div className="kreo-actions">
          <button className="kreo-btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
