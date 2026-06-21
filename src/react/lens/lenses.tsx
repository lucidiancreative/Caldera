import type { ReactNode } from 'react';

// The six project-management framework lenses. Each project is viewed through one lens
// at a time; the LensBar (top of the sidebar) switches between them. `icon` is the inner
// SVG content of a Lucide glyph — LensBar wraps it in the shared <svg> chrome, matching
// the inline-icon style already used for the settings gear and the tab-bar import button.
export type LensId = 'people' | 'time' | 'money' | 'materials' | 'scope' | 'information';

export interface LensDef {
  id: LensId;
  label: string;
  icon: ReactNode;
}

export const LENSES: LensDef[] = [
  {
    id: 'people',
    label: 'People',
    // Lucide: users
    icon: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    id: 'time',
    label: 'Time',
    // Lucide: clock
    icon: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
  },
  {
    id: 'money',
    label: 'Money',
    // Lucide: dollar-sign
    icon: (
      <>
        <line x1="12" x2="12" y1="2" y2="22" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </>
    ),
  },
  {
    id: 'materials',
    label: 'Materials',
    // Lucide: hammer
    icon: (
      <>
        <path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9" />
        <path d="M17.64 15 22 10.64" />
        <path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h.86c.85 0 1.65.33 2.25.93l1.25 1.25" />
      </>
    ),
  },
  {
    id: 'scope',
    label: 'Scope',
    // Lucide: navigation
    icon: (
      <>
        <polygon points="3 11 22 2 13 21 11 13 3 11" />
      </>
    ),
  },
  {
    id: 'information',
    label: 'Information',
    // Lucide: folder
    icon: (
      <>
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      </>
    ),
  },
];
