import type { DrawingTool } from '@/utils/imageEditor';

interface ToolbarProps {
  tool: DrawingTool;
  brushSize: number;
  brushOpacity: number;
  primaryColor: string;
  secondaryColor: string;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  onToolChange: (tool: DrawingTool) => void;
  onBrushSizeChange: (size: number) => void;
  onBrushOpacityChange: (opacity: number) => void;
  onPrimaryColorChange: (color: string) => void;
  onSecondaryColorChange: (color: string) => void;
  onZoomChange: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onFitToScreen: () => void;
  onSave?: () => void;
  onExport?: () => void;
}

const tools: { id: DrawingTool; label: string; icon: string }[] = [
  { id: 'select', label: 'Select', icon: '⬚' },
  { id: 'pencil', label: 'Pencil', icon: '✏️' },
  { id: 'brush', label: 'Brush', icon: '🖌️' },
  { id: 'eraser', label: 'Eraser', icon: '🧹' },
  { id: 'fill', label: 'Fill', icon: '🪣' },
  { id: 'rectangle', label: 'Rectangle', icon: '▭' },
  { id: 'circle', label: 'Circle', icon: '○' },
  { id: 'line', label: 'Line', icon: '/' }
];

const zoomLevels = [25, 50, 75, 100, 150, 200, 300, 400];

export default function Toolbar({
  tool,
  brushSize,
  brushOpacity,
  primaryColor,
  secondaryColor,
  zoom,
  canUndo,
  canRedo,
  isDirty,
  onToolChange,
  onBrushSizeChange,
  onBrushOpacityChange,
  onPrimaryColorChange,
  onSecondaryColorChange,
  onZoomChange,
  onUndo,
  onRedo,
  onClear,
  onFitToScreen,
  onSave,
  onExport
}: ToolbarProps) {
  return (
    <div className="flex flex-col gap-4 p-3 bg-base-200 border-r border-base-300 w-64 overflow-y-auto">
      {/* Tools Section */}
      <div>
        <h3 className="text-xs font-semibold text-base-content/60 uppercase mb-2">Tools</h3>
        <div className="grid grid-cols-4 gap-1">
          {tools.map(t => (
            <button
              key={t.id}
              className={`btn btn-sm btn-square ${tool === t.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => onToolChange(t.id)}
              title={t.label}
            >
              <span className="text-lg">{t.icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Colors Section */}
      <div>
        <h3 className="text-xs font-semibold text-base-content/60 uppercase mb-2">Colors</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="color"
              value={primaryColor}
              onChange={e => onPrimaryColorChange(e.target.value)}
              className="w-10 h-10 cursor-pointer rounded border border-base-300"
              title="Primary Color"
            />
            <span className="absolute -bottom-1 -right-1 text-[10px] bg-base-100 px-1 rounded">1</span>
          </div>
          <div className="relative">
            <input
              type="color"
              value={secondaryColor}
              onChange={e => onSecondaryColorChange(e.target.value)}
              className="w-10 h-10 cursor-pointer rounded border border-base-300"
              title="Secondary Color"
            />
            <span className="absolute -bottom-1 -right-1 text-[10px] bg-base-100 px-1 rounded">2</span>
          </div>
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => {
              const temp = primaryColor;
              onPrimaryColorChange(secondaryColor);
              onSecondaryColorChange(temp);
            }}
            title="Swap Colors"
          >
            ⇄
          </button>
        </div>
      </div>

      {/* Brush Settings */}
      <div>
        <h3 className="text-xs font-semibold text-base-content/60 uppercase mb-2">Brush Settings</h3>

        <div className="space-y-2">
          <div>
            <label className="text-xs text-base-content/70">Size: {brushSize}px</label>
            <input
              type="range"
              min="1"
              max="100"
              value={brushSize}
              onChange={e => onBrushSizeChange(parseInt(e.target.value))}
              className="range range-xs range-primary"
            />
          </div>

          <div>
            <label className="text-xs text-base-content/70">Opacity: {brushOpacity}%</label>
            <input
              type="range"
              min="1"
              max="100"
              value={brushOpacity}
              onChange={e => onBrushOpacityChange(parseInt(e.target.value))}
              className="range range-xs range-primary"
            />
          </div>
        </div>
      </div>

      {/* History Controls */}
      <div>
        <h3 className="text-xs font-semibold text-base-content/60 uppercase mb-2">History</h3>
        <div className="flex gap-1">
          <button
            className="btn btn-sm btn-ghost flex-1"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
            Undo
          </button>
          <button
            className="btn btn-sm btn-ghost flex-1"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
            Redo
          </button>
        </div>
      </div>

      {/* Zoom Controls */}
      <div>
        <h3 className="text-xs font-semibold text-base-content/60 uppercase mb-2">Zoom</h3>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => onZoomChange(Math.max(10, zoom - 25))}
            title="Zoom Out"
          >
            −
          </button>
          <select
            className="select select-xs select-bordered flex-1"
            value={zoom}
            onChange={e => onZoomChange(parseInt(e.target.value))}
          >
            {zoomLevels.map(level => (
              <option key={level} value={level}>
                {level}%
              </option>
            ))}
          </select>
          <button
            className="btn btn-xs btn-ghost"
            onClick={() => onZoomChange(Math.min(400, zoom + 25))}
            title="Zoom In"
          >
            +
          </button>
        </div>
        <button
          className="btn btn-xs btn-ghost w-full mt-1"
          onClick={onFitToScreen}
        >
          Fit to Screen
        </button>
      </div>

      {/* Actions */}
      <div className="mt-auto">
        <h3 className="text-xs font-semibold text-base-content/60 uppercase mb-2">Actions</h3>
        <div className="flex flex-col gap-1">
          <button
            className="btn btn-sm btn-ghost"
            onClick={onClear}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear Canvas
          </button>

          {onSave && (
            <button
              className={`btn btn-sm ${isDirty ? 'btn-primary' : 'btn-ghost'}`}
              onClick={onSave}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save
            </button>
          )}

          {onExport && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={onExport}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
