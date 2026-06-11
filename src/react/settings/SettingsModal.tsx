import type { SkinId } from '../../types';
import { useCalderaPrefs } from '../hooks/useCalderaPrefs';

const SKINS: Array<{ id: SkinId; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'arctic', label: 'Arctic' },
  { id: 'glacier', label: 'Glacier' },
  { id: 'teal', label: 'Teal' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme, setTheme, skin, setSkin, shaderPref, setShaderPref, shaderHint } = useCalderaPrefs();
  const glassSkin = skin !== 'default';

  return (
    <div id="settings-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div id="settings-modal">
        <button id="settings-modal-close" onClick={onClose}>&#10005;</button>
        <h2 id="settings-modal-title">Settings</h2>

        <div id="theme-toggle-section" className="settings-section">
          <label className="settings-label">Theme</label>
          <div id="theme-toggle-row">
            <button className={'theme-opt' + (theme === 'light' ? ' active' : '')} onClick={() => setTheme('light')}>Light</button>
            <button className={'theme-opt' + (theme === 'dark' ? ' active' : '')} onClick={() => setTheme('dark')}>Dark</button>
          </div>
        </div>

        <div id="skin-section" className="settings-section">
          <label className="settings-label">Skin</label>
          <div id="skin-grid">
            {SKINS.map((entry) => (
              <button
                key={entry.id}
                className={'skin-card' + (entry.id === skin ? ' active' : '')}
                data-skin-id={entry.id}
                onClick={() => setSkin(entry.id)}
              >
                <div className={`skin-preview skin-preview-${entry.id}`} />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
        </div>

        {glassSkin && (
          <div id="shader-toggle-section" className="settings-section">
            <label className="settings-label">Animated Background</label>
            <div id="shader-toggle-row">
              <button className={'shader-opt' + (shaderPref === 'auto' ? ' active' : '')} onClick={() => setShaderPref('auto')}>Auto</button>
              <button className={'shader-opt' + (shaderPref === 'on' ? ' active' : '')} onClick={() => setShaderPref('on')}>On</button>
              <button className={'shader-opt' + (shaderPref === 'off' ? ' active' : '')} onClick={() => setShaderPref('off')}>Off</button>
            </div>
            <p id="shader-toggle-hint">
              {shaderPref === 'auto'
                ? shaderHint.lowPower
                  ? 'Disabled (low battery detected)'
                  : shaderHint.reducedMotion
                    ? 'Disabled (reduced motion preference)'
                    : 'Adjusts based on battery and system preferences'
                : shaderPref === 'off'
                  ? 'Static background for better performance'
                  : 'Animated shader always enabled'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
