// Ambient type for the data bridge the vanilla renderer installs on window.
// Mirrors the CalderaBridge declared in src/renderer-globals.d.ts; the two type
// worlds (global-script renderer vs. bundled React island) can't share a file,
// so keep these in sync until the migration is complete.
import type { CalAPI, CalData } from '../types';

declare global {
  interface Window {
    calAPI: CalAPI;
    calderaBridge?: {
      getData(): CalData;
      save(): Promise<void>;
      subscribe(listener: () => void): () => void;
      notify(): void;
      pushSnapshot(): void;
    };
    calderaAppearance?: {
      palette(): { base: string; highlight: string }[];
      slotForBlock(block: { paletteSlot?: number; color?: string }): number;
      gradientCss(block: { paletteSlot?: number; color?: string }): string;
      cornerRadius(): number;
    };
    calderaSchedule?: {
      createBlock(key: string, block: { startMin: number; endMin: number; label: string }, recurrence: string, ampm: 'AM' | 'PM'): Promise<void>;
      updateBlock(key: string, id: string, label: string, recurrence: string, scope: string, ampm: 'AM' | 'PM'): Promise<void>;
      deleteBlock(key: string, id: string, scope?: string): Promise<void>;
    };
    calderaView?: {
      scheduleDate(): string | null;
      setScheduleDate(key: string): void;
      subscribe(listener: () => void): () => void;
      notify(): void;
    };
    calderaTabs?: {
      list(): { id: string; name: string }[];
      activeId(): string;
      setActive(id: string): void;
      create(name?: string): string;
      rename(id: string, name: string): void;
      close(id: string): void;
      reorder(fromIndex: number, toIndex: number): void;
      subscribe(listener: () => void): () => void;
      notify(): void;
    };
    calderaPrefs?: {
      theme(): 'light' | 'dark';
      setTheme(theme: 'light' | 'dark'): void;
      skin(): 'default' | 'arctic' | 'glacier' | 'teal';
      setSkin(skin: 'default' | 'arctic' | 'glacier' | 'teal'): void;
      shaderPref(): 'auto' | 'on' | 'off';
      setShaderPref(pref: 'auto' | 'on' | 'off'): void;
      shaderHint(): { lowPower: boolean; reducedMotion: boolean };
      subscribe(listener: () => void): () => void;
      notify(): void;
    };
  }
}

export {};
