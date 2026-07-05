import { useEffect, useState } from 'react';
import type { SkinId } from '../../types';

type ThemeMode = 'light' | 'dark';
type ShaderPref = 'auto' | 'on' | 'off';

export function useCalderaPrefs() {
  const bridge = window.calderaPrefs;
  const [theme, setThemeState] = useState<ThemeMode>(bridge?.theme() ?? 'light');
  const [skin, setSkinState] = useState<SkinId>(bridge?.skin() ?? 'default');
  const [shaderPref, setShaderPrefState] = useState<ShaderPref>(bridge?.shaderPref() ?? 'auto');
  const [shaderHint, setShaderHint] = useState(() =>
    bridge?.shaderHint() ?? { lowPower: false, reducedMotion: false },
  );
  const [showRecurring, setShowRecurringState] = useState<boolean>(bridge?.showRecurring() ?? true);

  useEffect(() => {
    if (!bridge) return;
    const sync = () => {
      setThemeState(bridge.theme());
      setSkinState(bridge.skin());
      setShaderPrefState(bridge.shaderPref());
      setShaderHint(bridge.shaderHint());
      setShowRecurringState(bridge.showRecurring());
    };
    sync();
    return bridge.subscribe(sync);
  }, [bridge]);

  return {
    theme,
    skin,
    shaderPref,
    shaderHint,
    showRecurring,
    setTheme: (next: ThemeMode) => bridge?.setTheme(next),
    setSkin: (next: SkinId) => bridge?.setSkin(next),
    setShaderPref: (next: ShaderPref) => bridge?.setShaderPref(next),
    setShowRecurring: (next: boolean) => bridge?.setShowRecurring(next),
  };
}
