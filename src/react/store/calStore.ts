import { create } from 'zustand';
import type { CalData } from '../../types';

const EMPTY_CAL_DATA: CalData = { _recurring: [] };

interface CalStoreState {
  // Bumped whenever the vanilla bridge reports a data change, so subscribed React
  // components re-render and re-read the live calData. The data itself stays owned
  // by the vanilla source of truth during the migration; this store is a mirror.
  revision: number;
}

export const useCalStore = create<CalStoreState>(() => ({ revision: 0 }));

// Mirror the single source of truth: every vanilla data change bumps revision.
// Optional chaining guards the (not expected) case of the bundle loading before
// the vanilla scripts have installed the bridge.
window.calderaBridge?.subscribe(() => {
  useCalStore.setState((state) => ({ revision: state.revision + 1 }));
});

/** Live calData, re-rendering the calling component whenever the vanilla data changes. */
export function useCalData(): CalData {
  useCalStore((state) => state.revision); // subscribe to change notifications
  return window.calderaBridge?.getData() ?? EMPTY_CAL_DATA;
}

/** Persist the shared calData. `save()` already fans the change out to all mirrors. */
export async function saveCalData(): Promise<void> {
  await window.calderaBridge?.save();
}
