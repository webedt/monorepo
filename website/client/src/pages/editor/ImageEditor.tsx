import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDrawing } from '@/hooks/useDrawing';
import { useImageLayersStore, useSessionLastPageStore } from '@/lib/store';
import { Canvas, Toolbar, LayerPanel } from '@/components/editor/image';
import { downloadCanvas, getMimeType } from '@/utils/imageEditor';

// Image dimension presets
const DIMENSION_PRESETS = [
  { label: 'HD (1920x1080)', width: 1920, height: 1080 },
  { label: 'Full HD (1920x1080)', width: 1920, height: 1080 },
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: 'Square (1024x1024)', width: 1024, height: 1024 },
  { label: 'Instagram (1080x1080)', width: 1080, height: 1080 },
  { label: 'Icon (256x256)', width: 256, height: 256 },
  { label: 'Icon (64x64)', width: 64, height: 64 },
  { label: 'Custom', width: 800, height: 600 }
];

export default function ImageEditor() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();

  // Session tracking for navigation
  const setLastPage = useSessionLastPageStore((state) => state.setLastPage);

  // Track this page as last visited when session is active
  useEffect(() => {
    if (sessionId) {
      setLastPage(sessionId, 'images');
    }
  }, [sessionId, setLastPage]);

  // Drawing hook with touch support
  const drawing = useDrawing();

  // Layers store
  const { initializeBaseLayer, clearLayers, layers } = useImageLayersStore();

  // UI state
  const [showNewImageModal, setShowNewImageModal] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showLayerPanel, setShowLayerPanel] = useState(true);
  const [newImageWidth, setNewImageWidth] = useState(1024);
  const [newImageHeight, setNewImageHeight] = useState(1024);
  const [newImageBackground, setNewImageBackground] = useState<'transparent' | 'white' | 'black'>('white');
  const [exportFilename, setExportFilename] = useState('image');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpg' | 'webp'>('png');

  // Handle creating new image
  const handleCreateNewImage = useCallback(() => {
    const backgroundColor = newImageBackground === 'transparent'
      ? undefined
      : newImageBackground === 'white' ? '#FFFFFF' : '#000000';

    drawing.initializeCanvas(newImageWidth, newImageHeight, backgroundColor);
    clearLayers();
    initializeBaseLayer();
    setShowNewImageModal(false);
  }, [newImageWidth, newImageHeight, newImageBackground, drawing, clearLayers, initializeBaseLayer]);

  // Handle preset selection
  const handlePresetSelect = (preset: typeof DIMENSION_PRESETS[0]) => {
    setNewImageWidth(preset.width);
    setNewImageHeight(preset.height);
  };

  // Handle export
  const handleExport = useCallback(() => {
    const canvasEl = drawing.canvasRef.current;
    if (!canvasEl) return;

    const mimeType = getMimeType(exportFormat);
    downloadCanvas(canvasEl, `${exportFilename}.${exportFormat}`, mimeType);
    setShowExportModal(false);
  }, [drawing.canvasRef, exportFilename, exportFormat]);

  // Handle save (for future session management)
  const handleSave = useCallback(() => {
    // For now, just show export modal
    // In production, this would save to storage
    setShowExportModal(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for modifier keys
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        drawing.undo();
      } else if (isCtrlOrCmd && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        drawing.redo();
      } else if (isCtrlOrCmd && e.key === 's') {
        e.preventDefault();
        handleSave();
      } else if (isCtrlOrCmd && e.key === 'e') {
        e.preventDefault();
        setShowExportModal(true);
      } else if (e.key === 'Escape') {
        drawing.setSelection(null);
      }

      // Tool shortcuts (no modifier)
      if (!isCtrlOrCmd && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v':
            drawing.setTool('select');
            break;
          case 'p':
            drawing.setTool('pencil');
            break;
          case 'b':
            drawing.setTool('brush');
            break;
          case 'e':
            drawing.setTool('eraser');
            break;
          case 'g':
            drawing.setTool('fill');
            break;
          case 'r':
            drawing.setTool('rectangle');
            break;
          case 'c':
            drawing.setTool('circle');
            break;
          case 'l':
            drawing.setTool('line');
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawing, handleSave]);

  return (
    <div className="h-screen flex flex-col bg-base-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-base-200 border-b border-base-300">
        <div className="flex items-center gap-4">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => navigate(-1)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold">Image Editor</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setShowNewImageModal(true)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setShowLayerPanel(!showLayerPanel)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Layers
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Toolbar */}
        <Toolbar
          tool={drawing.config.tool}
          brushSize={drawing.config.brushSize}
          brushOpacity={drawing.config.brushOpacity}
          primaryColor={drawing.config.primaryColor}
          secondaryColor={drawing.config.secondaryColor}
          zoom={drawing.canvasState.zoom}
          canUndo={drawing.canUndo}
          canRedo={drawing.canRedo}
          isDirty={drawing.isDirty}
          onToolChange={drawing.setTool}
          onBrushSizeChange={drawing.setBrushSize}
          onBrushOpacityChange={drawing.setBrushOpacity}
          onPrimaryColorChange={drawing.setPrimaryColor}
          onSecondaryColorChange={drawing.setSecondaryColor}
          onZoomChange={drawing.setZoom}
          onResetPan={drawing.resetPan}
          onUndo={drawing.undo}
          onRedo={drawing.redo}
          onClear={drawing.clearCanvas}
          onFitToScreen={drawing.fitToContainer}
          onSave={handleSave}
          onExport={() => setShowExportModal(true)}
        />

        {/* Canvas Area */}
        <Canvas
          canvasRef={drawing.canvasRef}
          drawingLayerRef={drawing.drawingLayerRef}
          containerRef={drawing.containerRef}
          width={drawing.canvasState.width}
          height={drawing.canvasState.height}
          zoom={drawing.canvasState.zoom}
          panX={drawing.canvasState.panX}
          panY={drawing.canvasState.panY}
          selection={drawing.selection}
          isPanning={drawing.isPanning}
          onMouseDown={drawing.handleMouseDown}
          onMouseMove={drawing.handleMouseMove}
          onMouseUp={drawing.handleMouseUp}
          onMouseLeave={drawing.handleMouseLeave}
          onWheel={drawing.handleWheel}
          onTouchStart={drawing.handleTouchStart}
          onTouchMove={drawing.handleTouchMove}
          onTouchEnd={drawing.handleTouchEnd}
        />

        {/* Layer Panel */}
        {showLayerPanel && (
          <LayerPanel className="w-64" />
        )}
      </div>

      {/* Status Bar */}
      <footer className="flex items-center justify-between px-4 py-1 bg-base-200 border-t border-base-300 text-xs text-base-content/70">
        <div className="flex items-center gap-4">
          <span>
            {drawing.canvasState.width} × {drawing.canvasState.height}px
          </span>
          <span>
            Zoom: {drawing.canvasState.zoom}%
          </span>
          <span>
            Layers: {layers.length}
          </span>
          {sessionId && (
            <span className="text-primary">Session: {sessionId.slice(0, 8)}...</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {drawing.isDirty && (
            <span className="text-warning">Unsaved changes</span>
          )}
          <span>
            Tool: {drawing.config.tool}
          </span>
        </div>
      </footer>

      {/* New Image Modal */}
      {showNewImageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-semibold mb-4">Create New Image</h2>

            {/* Preset Selection */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Presets</label>
              <div className="grid grid-cols-2 gap-2">
                {DIMENSION_PRESETS.slice(0, 6).map((preset, i) => (
                  <button
                    key={i}
                    className={`btn btn-sm ${
                      newImageWidth === preset.width && newImageHeight === preset.height
                        ? 'btn-primary'
                        : 'btn-ghost'
                    }`}
                    onClick={() => handlePresetSelect(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Dimensions */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Dimensions</label>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  className="input input-bordered input-sm w-24"
                  value={newImageWidth}
                  onChange={(e) => setNewImageWidth(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="8192"
                />
                <span>×</span>
                <input
                  type="number"
                  className="input input-bordered input-sm w-24"
                  value={newImageHeight}
                  onChange={(e) => setNewImageHeight(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1"
                  max="8192"
                />
                <span className="text-sm text-base-content/50">px</span>
              </div>
            </div>

            {/* Background */}
            <div className="mb-6">
              <label className="text-sm font-medium mb-2 block">Background</label>
              <div className="flex gap-2">
                <button
                  className={`btn btn-sm ${newImageBackground === 'transparent' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setNewImageBackground('transparent')}
                >
                  Transparent
                </button>
                <button
                  className={`btn btn-sm ${newImageBackground === 'white' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setNewImageBackground('white')}
                >
                  White
                </button>
                <button
                  className={`btn btn-sm ${newImageBackground === 'black' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setNewImageBackground('black')}
                >
                  Black
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setShowNewImageModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateNewImage}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-semibold mb-4">Export Image</h2>

            {/* Filename */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Filename</label>
              <input
                type="text"
                className="input input-bordered w-full"
                value={exportFilename}
                onChange={(e) => setExportFilename(e.target.value)}
                placeholder="image"
              />
            </div>

            {/* Format */}
            <div className="mb-6">
              <label className="text-sm font-medium mb-2 block">Format</label>
              <div className="flex gap-2">
                {(['png', 'jpg', 'webp'] as const).map((format) => (
                  <button
                    key={format}
                    className={`btn btn-sm ${exportFormat === format ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setExportFormat(format)}
                  >
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setShowExportModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleExport}
              >
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
