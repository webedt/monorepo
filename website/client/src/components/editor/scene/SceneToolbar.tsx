import type { EditorTool, EditorViewport } from '@/types/scene';

interface SceneToolbarProps {
  tool: EditorTool;
  viewport: EditorViewport;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  onToolChange: (tool: EditorTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onResetViewport: () => void;
  onFitToContent: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onSave: () => void;
  onLoad: () => void;
  onNewScene: () => void;
}

export default function SceneToolbar({
  tool,
  viewport,
  canUndo,
  canRedo,
  isDirty,
  onToolChange,
  onUndo,
  onRedo,
  onZoomChange,
  onResetViewport,
  onFitToContent,
  onToggleGrid,
  onToggleSnap,
  onSave,
  onLoad,
  onNewScene,
}: SceneToolbarProps) {
  const tools: { id: EditorTool; icon: string; label: string; shortcut?: string }[] = [
    { id: 'select', icon: '⤢', label: 'Select', shortcut: 'V' },
    { id: 'move', icon: '✋', label: 'Move', shortcut: 'M' },
    { id: 'rotate', icon: '⟲', label: 'Rotate', shortcut: 'R' },
    { id: 'scale', icon: '⤡', label: 'Scale', shortcut: 'S' },
    { id: 'pan', icon: '🖐️', label: 'Pan', shortcut: 'Space' },
  ];

  const createTools: { id: EditorTool; icon: string; label: string }[] = [
    { id: 'rectangle', icon: '▢', label: 'Rectangle' },
    { id: 'circle', icon: '○', label: 'Circle' },
    { id: 'text', icon: 'T', label: 'Text' },
  ];

  const zoomPresets = [25, 50, 75, 100, 125, 150, 200, 300, 400];

  return (
    <div className="flex flex-col bg-base-100 border-r border-base-300 w-14">
      {/* File operations */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          <button
            onClick={onNewScene}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center"
            title="New Scene"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onLoad}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center"
            title="Open Scene"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
          </button>
          <button
            onClick={onSave}
            className={`btn btn-sm w-full aspect-square flex items-center justify-center ${isDirty ? 'btn-primary' : 'btn-ghost'}`}
            title="Save Scene (Ctrl+S)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Undo/Redo */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center disabled:opacity-30"
            title="Redo (Ctrl+Y)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Selection tools */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => onToolChange(t.id)}
              className={`btn btn-sm w-full aspect-square flex items-center justify-center text-lg ${
                tool === t.id ? 'btn-primary' : 'btn-ghost'
              }`}
              title={`${t.label}${t.shortcut ? ` (${t.shortcut})` : ''}`}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Creation tools */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          {createTools.map((t) => (
            <button
              key={t.id}
              onClick={() => onToolChange(t.id)}
              className={`btn btn-sm w-full aspect-square flex items-center justify-center text-lg ${
                tool === t.id ? 'btn-primary' : 'btn-ghost'
              }`}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Viewport controls */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          <button
            onClick={onToggleGrid}
            className={`btn btn-sm w-full aspect-square flex items-center justify-center ${
              viewport.showGrid ? 'btn-primary' : 'btn-ghost'
            }`}
            title="Toggle Grid (G)"
          >
            <span className="text-lg">⊞</span>
          </button>
          <button
            onClick={onToggleSnap}
            className={`btn btn-sm w-full aspect-square flex items-center justify-center ${
              viewport.snapToGrid ? 'btn-primary' : 'btn-ghost'
            }`}
            title="Snap to Grid"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1zM12 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-3zm2 2v-1h1v1h-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={onFitToContent}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center"
            title="Fit to Content"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <button
            onClick={onResetViewport}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center"
            title="Reset View"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Zoom control */}
      <div className="p-2 mt-auto border-t border-base-300">
        <div className="flex flex-col gap-1 items-center">
          <button
            onClick={() => onZoomChange(viewport.zoom + 25)}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center"
            title="Zoom In"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
            </svg>
          </button>
          <select
            value={viewport.zoom}
            onChange={(e) => onZoomChange(parseInt(e.target.value))}
            className="select select-xs w-full text-center"
          >
            {zoomPresets.map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
          <button
            onClick={() => onZoomChange(viewport.zoom - 25)}
            className="btn btn-sm btn-ghost w-full aspect-square flex items-center justify-center"
            title="Zoom Out"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
