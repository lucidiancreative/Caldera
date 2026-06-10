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
    };
  }
}

export {};
