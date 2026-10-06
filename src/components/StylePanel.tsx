import type { KreoElement } from '../types';
import { PALETTE } from '../types';
import { I } from './icons';

interface Props {
  elements: KreoElement[];
  onPatch: (patch: Partial<KreoElement>) => void;
  onAction: (a: 'delete' | 'duplicate' | 'group' | 'ungroup' | 'detach' | 'lock' | 'unlock' | 'front' | 'back' | 'forward' | 'backward') => void;
}

const FONTS = [
  'Inter, system-ui, sans-serif',
  'Georgia, serif',
  'Comic Sans MS, cursive',
  '"Courier New", monospace',
  'Virgil, Caveat, cursive',
];

export default function StylePanel({ elements, onPatch, onAction }: Props) {
  const first = elements[0];
  const kinds = new Set(elements.map((e) => e.type));
  const isText = kinds.size === 1 && kinds.has('text');
  const isArrow = kinds.has('arrow');
  const isPenOnly = kinds.size === 1 && kinds.has('pen');
  const multi = elements.length > 1;

  return (
    <aside className="kreo-style" aria-label="Style panel">
      <h4>{multi ? `${elements.length} selected` : label(first.type)}</h4>

      {/* stroke color */}
      <div className="kreo-row">
        <h4>{isText ? 'Text color' : 'Stroke'}</h4>
        <div className="kreo-swatches">
          {PALETTE.map((c) => (
            <button
              key={c}
              className={`kreo-sw${first.stroke === c ? ' sel' : ''}`}
              style={{ background: c }}
              aria-label={`Stroke ${c}`}
              onClick={() => onPatch({ stroke: c } as Partial<KreoElement>)}
            />
          ))}
          <input
            type="color"
            value={first.stroke.startsWith('#') ? first.stroke : '#1a1a1a'}
            onChange={(e) => onPatch({ stroke: e.target.value } as Partial<KreoElement>)}
            aria-label="Custom stroke color"
            style={{ width: 24, height: 24, border: '1px solid rgba(0,0,0,.15)', borderRadius: 7, padding: 0, background: 'none' }}
          />
        </div>
      </div>

      {/* fill */}
      {!isText && !isPenOnly && first.type !== 'image' && (
        <div className="kreo-row">
          <h4>Background</h4>
          <div className="kreo-swatches">
            <button
              className={`kreo-sw${first.fill === 'transparent' ? ' sel' : ''}`}
              style={{ background: 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 12px 12px' }}
              aria-label="No fill"
              onClick={() => onPatch({ fill: 'transparent' })}
            />
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`kreo-sw${first.fill === c ? ' sel' : ''}`}
                style={{ background: c }}
                aria-label={`Fill ${c}`}
                onClick={() => onPatch({ fill: c })}
              />
            ))}
            <input
              type="color"
              value={first.fill.startsWith('#') ? first.fill : '#ffffff'}
              onChange={(e) => onPatch({ fill: e.target.value })}
              aria-label="Custom fill color"
              style={{ width: 24, height: 24, border: '1px solid rgba(0,0,0,.15)', borderRadius: 7, padding: 0, background: 'none' }}
            />
          </div>
        </div>
      )}

      {/* stroke width */}
      {first.type !== 'image' && (
        <div className="kreo-row">
          <h4>Stroke width — {first.strokeWidth}</h4>
          <input
            type="range" min={1} max={12} step={1} value={first.strokeWidth}
            onChange={(e) => onPatch({ strokeWidth: Number(e.target.value) })}
            aria-label="Stroke width"
          />
        </div>
      )}

      {/* stroke style */}
      {!isText && (
        <div className="kreo-row">
          <h4>Stroke style</h4>
          <div className="kreo-seg">
            {(['solid', 'dashed', 'dotted'] as const).map((s) => (
              <button key={s} className={first.strokeStyle === s ? 'sel' : ''} onClick={() => onPatch({ strokeStyle: s })}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* opacity */}
      <div className="kreo-row">
        <h4>Opacity — {first.opacity}%</h4>
        <input
          type="range" min={10} max={100} step={5} value={first.opacity}
          onChange={(e) => onPatch({ opacity: Number(e.target.value) })}
          aria-label="Opacity"
        />
      </div>

      {/* roughness */}
      {first.type !== 'image' && first.type !== 'text' && (
        <div className="kreo-row">
          <h4>Sketch style — {['Clean', 'Slight', 'Sketchy', 'Wild'][Math.min(3, first.roughness)]}</h4>
          <input
            type="range" min={0} max={3} step={1} value={first.roughness}
            onChange={(e) => onPatch({ roughness: Number(e.target.value) })}
            aria-label="Roughness"
          />
        </div>
      )}

      {/* corner radius */}
      {first.type === 'rect' && (
        <div className="kreo-row">
          <h4>Corners</h4>
          <input
            type="range" min={0} max={1} step={0.05} value={first.roundness}
            onChange={(e) => onPatch({ roundness: Number(e.target.value) })}
            aria-label="Corner radius"
          />
        </div>
      )}

      {/* arrowheads */}
      {isArrow && (
        <div className="kreo-row">
          <h4>Arrowheads</h4>
          <div className="kreo-seg">
            <button
              className={(first as any).startArrow ? 'sel' : ''}
              onClick={() => onPatch({ startArrow: !(first as any).startArrow } as Partial<KreoElement>)}
            >
              Start
            </button>
            <button
              className={(first as any).endArrow !== false ? 'sel' : ''}
              onClick={() => onPatch({ endArrow: (first as any).endArrow === false } as Partial<KreoElement>)}
            >
              End
            </button>
          </div>
        </div>
      )}

      {/* text controls */}
      {isText && (
        <>
          <div className="kreo-row">
            <h4>Font size — {(first as any).fontSize}</h4>
            <input
              type="range" min={10} max={96} step={1} value={(first as any).fontSize}
              onChange={(e) => onPatch({ fontSize: Number(e.target.value) } as Partial<KreoElement>)}
              aria-label="Font size"
            />
          </div>
          <div className="kreo-row">
            <h4>Font</h4>
            <select
              value={(first as any).fontFamily}
              onChange={(e) => onPatch({ fontFamily: e.target.value } as Partial<KreoElement>)}
              aria-label="Font family"
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>{f.split(',')[0]}</option>
              ))}
            </select>
          </div>
          <div className="kreo-row">
            <div className="kreo-seg">
              <button className={(first as any).bold ? 'sel' : ''} onClick={() => onPatch({ bold: !(first as any).bold } as Partial<KreoElement>)}><b>B</b></button>
              <button className={(first as any).italic ? 'sel' : ''} onClick={() => onPatch({ italic: !(first as any).italic } as Partial<KreoElement>)}><i>I</i></button>
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} className={(first as any).align === a ? 'sel' : ''} onClick={() => onPatch({ align: a } as Partial<KreoElement>)}>
                  {a[0].toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* actions */}
      <div className="kreo-row">
        <h4>Arrange</h4>
        {elements.some((e) => e.parentId) && (
          <div className="kreo-seg" style={{ marginBottom: 4 }}>
            <button onClick={() => onAction('detach')} data-tip="Detach from the shape underneath — moves on its own">
              Detach from shape
            </button>
          </div>
        )}
        <div className="kreo-seg">
          <button onClick={() => onAction('front')} data-tip="Bring to front">Front</button>
          <button onClick={() => onAction('forward')} data-tip="Bring forward">Fwd</button>
          <button onClick={() => onAction('backward')} data-tip="Send backward">Back</button>
          <button onClick={() => onAction('back')} data-tip="Send to back">End</button>
        </div>
        <div className="kreo-seg" style={{ marginTop: 4 }}>
          <button onClick={() => onAction('duplicate')} data-tip="Duplicate (Ctrl+D)"><I.copy size={14} /></button>
          <button onClick={() => onAction('group')} data-tip="Group (Ctrl+G)"><I.group size={14} /></button>
          <button onClick={() => onAction(first.locked ? 'unlock' : 'lock')} data-tip={first.locked ? 'Unlock' : 'Lock'}>
            {first.locked ? <I.unlock size={14} /> : <I.lock size={14} />}
          </button>
          <button onClick={() => onAction('delete')} data-tip="Delete (Del)"><I.trash size={14} /></button>
        </div>
      </div>
    </aside>
  );
}

function label(t: string): string {
  const m: Record<string, string> = {
    rect: 'Rectangle', diamond: 'Diamond', triangle: 'Triangle', ellipse: 'Ellipse', line: 'Line',
    arrow: 'Arrow', pen: 'Drawing', text: 'Text', image: 'Image',
  };
  return m[t] ?? t;
}
