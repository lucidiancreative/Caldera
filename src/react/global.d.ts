// Ambient type for the data bridge the vanilla renderer installs on window.
// Mirrors the CalderaBridge declared in src/renderer-globals.d.ts; the two type
// worlds (global-script renderer vs. bundled React island) can't share a file,
// so keep these in sync until the migration is complete.
import type { CalData } from '../types';

declare global {
  interface Window {
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
      moveBlock(key: string, id: string, newKey: string): Promise<void>;
      addSubtask(key: string, id: string, label: string): Promise<void>;
      deleteSubtask(key: string, id: string, subtaskId: string): Promise<void>;
    };
  }
}

export {};
