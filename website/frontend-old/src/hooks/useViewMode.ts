import { useState } from 'react';

export type ViewMode = 'grid' | 'detailed' | 'minimal';

export function useViewMode(storageKey: string = 'viewMode'): [ViewMode, (mode: ViewMode) => void] {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(storageKey);
    return (stored as ViewMode) || 'grid';
  });

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(storageKey, mode);
  };

  return [viewMode, setViewMode];
}
