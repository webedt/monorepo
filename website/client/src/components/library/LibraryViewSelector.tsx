import { ViewMode } from '@/hooks/useViewMode';

interface LibraryViewSelectorProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

/**
 * View selector component for the library page.
 * Allows switching between Grid, List, and Compact List views.
 */
export default function LibraryViewSelector({ viewMode, onViewModeChange }: LibraryViewSelectorProps) {
  return (
    <div className="flex gap-1 bg-base-300 rounded-lg p-1">
      {/* Grid View */}
      <button
        onClick={() => onViewModeChange('grid')}
        className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : 'btn-ghost'}`}
        title="Grid View - Thumbnail-based grid layout"
        aria-label="Switch to grid view"
        aria-pressed={viewMode === 'grid'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
        <span className="hidden sm:inline ml-1">Grid</span>
      </button>

      {/* List View */}
      <button
        onClick={() => onViewModeChange('detailed')}
        className={`btn btn-sm ${viewMode === 'detailed' ? 'btn-primary' : 'btn-ghost'}`}
        title="List View - Standard list with more details"
        aria-label="Switch to list view"
        aria-pressed={viewMode === 'detailed'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span className="hidden sm:inline ml-1">List</span>
      </button>

      {/* Compact List View */}
      <button
        onClick={() => onViewModeChange('minimal')}
        className={`btn btn-sm ${viewMode === 'minimal' ? 'btn-primary' : 'btn-ghost'}`}
        title="Compact List View - Dense list for power users"
        aria-label="Switch to compact list view"
        aria-pressed={viewMode === 'minimal'}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
        <span className="hidden sm:inline ml-1">Compact</span>
      </button>
    </div>
  );
}
