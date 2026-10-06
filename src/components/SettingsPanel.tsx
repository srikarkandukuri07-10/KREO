import type { AppSettings } from '../types';
import { I } from './icons';

interface Props {
  settings: AppSettings;
  boardBackground: string;
  onChange: (s: AppSettings) => void;
  onBoardBg: (bg: string) => void;
  onClose: () => void;
}

export default function SettingsPanel({ settings, boardBackground, onChange, onBoardBg, onClose }: Props) {
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => onChange({ ...settings, [k]: v });

  return (
    <div className="kreo-overlay" style={{ justifyContent: 'flex-end', padding: 0 }} onClick={onClose}>
      <div className="kreo-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3>Settings</h3>
          <button className="kreo-btn icon" onClick={onClose} aria-label="Close settings"><I.x /></button>
        </div>

        <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)' }}>Canvas</h4>
        <div className="kreo-row">
          <label style={{ fontSize: 13 }}>Background</label>
          <input type="color" value={boardBackground} onChange={(e) => onBoardBg(e.target.value)} aria-label="Canvas background" style={{ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 8, background: 'none', padding: 2 }} />
        </div>
        <Toggle label="Show grid" value={settings.grid} onChange={(v) => set('grid', v)} />
        <Toggle label="Snap to grid" value={settings.snap} onChange={(v) => set('snap', v)} />
        <div className="kreo-row" style={{ marginTop: 8 }}>
          <label style={{ fontSize: 13 }}>Grid size — {settings.gridSize}px</label>
          <input type="range" min={8} max={64} step={4} value={settings.gridSize} onChange={(e) => set('gridSize', Number(e.target.value))} aria-label="Grid size" />
        </div>

        <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginTop: 16 }}>Defaults</h4>
        <div className="kreo-row" style={{ marginTop: 8 }}>
          <label style={{ fontSize: 13 }}>Stroke width — {settings.defaultStrokeWidth}</label>
          <input type="range" min={1} max={12} step={1} value={settings.defaultStrokeWidth} onChange={(e) => set('defaultStrokeWidth', Number(e.target.value))} aria-label="Default stroke width" />
        </div>
        <div className="kreo-row">
          <label style={{ fontSize: 13 }}>Sketch style — {['Clean', 'Slight', 'Sketchy', 'Wild'][settings.defaultRoughness] ?? 'Slight'}</label>
          <input type="range" min={0} max={3} step={1} value={settings.defaultRoughness} onChange={(e) => set('defaultRoughness', Number(e.target.value))} aria-label="Default roughness" />
        </div>
        <div className="kreo-row">
          <label style={{ fontSize: 13 }}>Default font</label>
          <select value={settings.defaultFont} onChange={(e) => set('defaultFont', e.target.value)} aria-label="Default font">
            <option value="Inter, system-ui, sans-serif">Inter</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="Comic Sans MS, cursive">Handwritten-ish</option>
            <option value="Courier New, monospace">Monospace</option>
          </select>
        </div>

        <h4 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', marginTop: 16 }}>Sync</h4>
        <Toggle label="Autosave" value={settings.autosave} onChange={(v) => set('autosave', v)} />
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
          Boards are stored locally in your browser and sync live across open tabs. Realtime server sync can plug into the sync layer without touching the editor.
        </p>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="kreo-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    </label>
  );
}
