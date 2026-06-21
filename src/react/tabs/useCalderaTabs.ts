import { useEffect, useState } from 'react';

export interface ProjectTab {
  id: string;
  name: string;
}

// Mirrors the vanilla calderaTabs bridge: the workspace (all projects + the active
// one) is owned by the data layer; this hook just reflects it and forwards mutations.
export function useCalderaTabs() {
  const bridge = window.calderaTabs;
  const [tabs, setTabs] = useState<ProjectTab[]>(bridge?.list() ?? []);
  const [activeId, setActiveId] = useState<string>(bridge?.activeId() ?? '');

  useEffect(() => {
    if (!bridge) return;
    const sync = () => {
      setTabs(bridge.list());
      setActiveId(bridge.activeId());
    };
    sync();
    return bridge.subscribe(sync);
  }, [bridge]);

  return {
    tabs,
    activeId,
    setActive: (id: string) => bridge?.setActive(id),
    create: (name?: string) => bridge?.create(name),
    rename: (id: string, name: string) => bridge?.rename(id, name),
    close: (id: string) => bridge?.close(id),
    reorder: (from: number, to: number) => bridge?.reorder(from, to),
  };
}
