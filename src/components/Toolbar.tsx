import type { ToolId } from '../types';
import { SHORTCUTS } from '../types';
import { I } from './icons';

interface Props {
  tool: ToolId;
  disabled?: boolean;
  setTool: (t: ToolId) => void;
  onImage: () => void;
  onMore: () => void;
}

const TOOLS: { id: ToolId; label: string; icon: (p: { size?: number }) => JSX.Element }[] = [
  { id: 'select', label: 'Select', icon: I.select },
  { id: 'hand', label: 'Hand', icon: I.hand },
  { id: 'rect', label: 'Rectangle', icon: I.rect },
  { id: 'diamond', label: 'Diamond', icon: I.diamond },
  { id: 'ellipse', label: 'Ellipse', icon: I.ellipse },
  { id: 'arrow', label: 'Arrow', icon: I.arrow },
  { id: 'line', label: 'Line', icon: I.line },
  { id: 'pen', label: 'Draw', icon: I.pen },
  { id: 'text', label: 'Text', icon: I.text },
  { id: 'image', label: 'Image', icon: I.image },
  { id: 'eraser', label: 'Eraser', icon: I.eraser },
];

export default function Toolbar({ tool, disabled, setTool, onImage, onMore }: Props) {
  return (
    <div className="kreo-toolbar" role="toolbar" aria-label="Drawing tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`kreo-tool${tool === t.id ? ' active' : ''}`}
          data-tip={`${t.label} — ${SHORTCUTS[t.id] ?? ''}`}
          aria-label={`${t.label} tool`}
          aria-pressed={tool === t.id}
          disabled={disabled && t.id !== 'select' && t.id !== 'hand'}
          onClick={() => {
            if (t.id === 'image') onImage();
            else setTool(t.id);
          }}
        >
          <t.icon />
        </button>
      ))}
      <div className="kreo-sep" />
      <button className="kreo-tool" data-tip="More actions (Ctrl+K)" aria-label="More actions" onClick={onMore}>
        <I.more />
      </button>
    </div>
  );
}
