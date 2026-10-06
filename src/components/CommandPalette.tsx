import { useEffect, useRef, useState } from 'react';
import type { CommandId } from './Editor';

interface Props {
  onClose: () => void;
  onRun: (cmd: CommandId) => void;
}

const COMMANDS: { id: CommandId; label: string; hint: string; keys: string }[] = [
  { id: 'tool-rect', label: 'Create rectangle', hint: 'Tool', keys: 'R' },
  { id: 'tool-ellipse', label: 'Create ellipse', hint: 'Tool', keys: 'O' },
  { id: 'tool-arrow', label: 'Create arrow', hint: 'Tool', keys: 'A' },
  { id: 'tool-text', label: 'Add text', hint: 'Tool', keys: 'T' },
  { id: 'tool-pen', label: 'Draw freehand', hint: 'Tool', keys: 'P' },
  { id: 'zoom-fit', label: 'Zoom to fit', hint: 'View', keys: '⌃0' },
  { id: 'zoom-100', label: 'Reset zoom to 100%', hint: 'View', keys: '' },
  { id: 'export-png', label: 'Export as PNG', hint: 'Export', keys: '' },
  { id: 'export-svg', label: 'Export as SVG', hint: 'Export', keys: '' },
  { id: 'export-pdf', label: 'Export as PDF', hint: 'Export', keys: '' },
  { id: 'export-json', label: 'Export project JSON', hint: 'Export', keys: '' },
  { id: 'copy-image', label: 'Copy as image', hint: 'Export', keys: '' },
  { id: 'select-all', label: 'Select all', hint: 'Edit', keys: '⌃A' },
  { id: 'duplicate', label: 'Duplicate selected', hint: 'Edit', keys: '⌃D' },
  { id: 'delete', label: 'Delete selected', hint: 'Edit', keys: 'Del' },
  { id: 'group', label: 'Group selected', hint: 'Edit', keys: '⌃G' },
  { id: 'ungroup', label: 'Ungroup selected', hint: 'Edit', keys: '⌃⇧G' },
  { id: 'lock', label: 'Lock selected', hint: 'Edit', keys: '' },
  { id: 'undo', label: 'Undo', hint: 'Edit', keys: '⌃Z' },
  { id: 'redo', label: 'Redo', hint: 'Edit', keys: '⌃⇧Z' },
  { id: 'bg-change', label: 'Change canvas background', hint: 'Settings', keys: '' },
  { id: 'toggle-grid', label: 'Toggle grid & snap', hint: 'Settings', keys: '' },
];

export default function CommandPalette({ onClose, onRun }: Props) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const list = COMMANDS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).slice(0, 12);

  return (
    <div className="kreo-overlay" style={{ alignItems: 'flex-start', background: 'transparent' }} onClick={onClose}>
      <div className="kreo-cmd" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(list.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
            if (e.key === 'Enter' && list[idx]) onRun(list[idx].id);
            if (e.key === 'Escape') onClose();
            e.stopPropagation();
          }}
          placeholder="Type a command… (rectangle, export, group…)"
          aria-label="Search commands"
        />
        <ul>
          {list.map((c, i) => (
            <li key={c.id}>
              <button className={i === idx ? 'sel' : ''} onMouseEnter={() => setIdx(i)} onClick={() => onRun(c.id)}>
                <span>{c.label} <small style={{ color: 'var(--muted)' }}>· {c.hint}</small></span>
                <kbd>{c.keys}</kbd>
              </button>
            </li>
          ))}
          {!list.length && <li style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>No matching command</li>}
        </ul>
      </div>
    </div>
  );
}
