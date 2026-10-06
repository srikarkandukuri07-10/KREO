import { useEffect, useRef } from 'react';

interface Props {
  x: number;
  y: number;
  hasSelection: boolean;
  canDetach: boolean;
  onClose: () => void;
  onAction: (a: string) => void;
}

export default function ContextMenu({ x, y, hasSelection, canDetach, onClose, onAction }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const W = 220, H = 380;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - H - 8);

  const item = (label: string, kbd: string, action: string, disabled = false) => (
    <button key={action} disabled={disabled} style={disabled ? { opacity: 0.35 } : undefined} onClick={() => onAction(action)}>
      <span>{label}</span>
      <kbd>{kbd}</kbd>
    </button>
  );

  return (
    <div ref={ref} className="kreo-ctx" style={{ left, top }} role="menu">
      {item('Cut', '⌃X', 'cut', !hasSelection)}
      {item('Copy', '⌃C', 'copy', !hasSelection)}
      {item('Paste', '⌃V', 'paste')}
      {item('Duplicate', '⌃D', 'duplicate', !hasSelection)}
      {item('Delete', 'Del', 'delete', !hasSelection)}
      <hr />
      {item('Group', '⌃G', 'group', !hasSelection)}
      {item('Ungroup', '⌃⇧G', 'ungroup', !hasSelection)}
      {item('Detach from shape', '', 'detach', !canDetach)}
      {item('Lock', '', 'lock', !hasSelection)}
      {item('Unlock', '', 'unlock', !hasSelection)}
      <hr />
      {item('Bring forward', '', 'forward', !hasSelection)}
      {item('Send backward', '', 'backward', !hasSelection)}
      {item('Bring to front', '', 'front', !hasSelection)}
      {item('Send to back', '', 'back', !hasSelection)}
      <hr />
      {item('Select all', '⌃A', 'selectAll')}
    </div>
  );
}
