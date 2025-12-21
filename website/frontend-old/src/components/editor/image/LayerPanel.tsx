import { useImageLayersStore, type ImageLayer } from '@/lib/store';

interface LayerPanelProps {
  className?: string;
}

export default function LayerPanel({ className = '' }: LayerPanelProps) {
  const {
    layers,
    activeLayerId,
    addLayer,
    removeLayer,
    duplicateLayer,
    setActiveLayer,
    toggleLayerVisibility,
    setLayerOpacity,
    setLayerBlendMode,
    setLayerLocked,
    renameLayer,
    moveLayerUp,
    moveLayerDown
  } = useImageLayersStore();

  const handleAddLayer = () => {
    addLayer();
  };

  const handleDeleteLayer = (id: string) => {
    if (layers.length > 1) {
      removeLayer(id);
    }
  };

  const handleDuplicateLayer = (id: string) => {
    duplicateLayer(id);
  };

  const handleRename = (id: string, currentName: string) => {
    const newName = window.prompt('Enter new layer name:', currentName);
    if (newName && newName.trim()) {
      renameLayer(id, newName.trim());
    }
  };

  // Reverse layers for display (top layer first)
  const displayLayers = [...layers].reverse();

  return (
    <div className={`flex flex-col bg-base-200 border-l border-base-300 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-base-300">
        <h3 className="text-sm font-semibold">Layers</h3>
        <div className="flex gap-1">
          <button
            className="btn btn-xs btn-ghost btn-square"
            onClick={handleAddLayer}
            title="Add Layer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Layer List */}
      <div className="flex-1 overflow-y-auto">
        {displayLayers.length === 0 ? (
          <div className="p-4 text-center text-sm text-base-content/50">
            No layers yet.
            <br />
            <button className="link link-primary" onClick={handleAddLayer}>
              Add a layer
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-base-300">
            {displayLayers.map((layer) => (
              <LayerItem
                key={layer.id}
                layer={layer}
                isActive={layer.id === activeLayerId}
                canDelete={layers.length > 1}
                canMoveUp={layers.indexOf(layer) < layers.length - 1}
                canMoveDown={layers.indexOf(layer) > 0}
                onSelect={() => setActiveLayer(layer.id)}
                onToggleVisibility={() => toggleLayerVisibility(layer.id)}
                onToggleLock={() => setLayerLocked(layer.id, !layer.locked)}
                onOpacityChange={(opacity) => setLayerOpacity(layer.id, opacity)}
                onBlendModeChange={(mode) => setLayerBlendMode(layer.id, mode)}
                onRename={() => handleRename(layer.id, layer.name)}
                onDuplicate={() => handleDuplicateLayer(layer.id)}
                onDelete={() => handleDeleteLayer(layer.id)}
                onMoveUp={() => moveLayerUp(layer.id)}
                onMoveDown={() => moveLayerDown(layer.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Layer Info */}
      {activeLayerId && (
        <div className="p-2 border-t border-base-300">
          <ActiveLayerInfo
            layer={layers.find(l => l.id === activeLayerId)}
            onOpacityChange={(opacity) => setLayerOpacity(activeLayerId, opacity)}
            onBlendModeChange={(mode) => setLayerBlendMode(activeLayerId, mode)}
          />
        </div>
      )}
    </div>
  );
}

interface LayerItemProps {
  layer: ImageLayer;
  isActive: boolean;
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onOpacityChange: (opacity: number) => void;
  onBlendModeChange: (mode: ImageLayer['blendMode']) => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function LayerItem({
  layer,
  isActive,
  canDelete,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onRename,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown
}: LayerItemProps) {
  return (
    <li
      className={`flex items-center gap-2 p-2 cursor-pointer hover:bg-base-300 ${
        isActive ? 'bg-primary/10 border-l-2 border-primary' : ''
      }`}
      onClick={onSelect}
    >
      {/* Visibility Toggle */}
      <button
        className="btn btn-xs btn-ghost btn-square"
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisibility();
        }}
        title={layer.visible ? 'Hide Layer' : 'Show Layer'}
      >
        {layer.visible ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        )}
      </button>

      {/* Layer Thumbnail */}
      <div className="w-10 h-10 bg-base-300 rounded overflow-hidden flex-shrink-0">
        {layer.imageData ? (
          <img
            src={layer.imageData}
            alt={layer.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-base-100 to-base-300" />
        )}
      </div>

      {/* Layer Name */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm truncate ${!layer.visible ? 'opacity-50' : ''}`}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          {layer.name}
        </p>
        <p className="text-xs text-base-content/50">
          {layer.opacity}% • {layer.blendMode}
        </p>
      </div>

      {/* Lock Toggle */}
      <button
        className="btn btn-xs btn-ghost btn-square"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
      >
        {layer.locked ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
          </svg>
        )}
      </button>

      {/* Actions Dropdown */}
      <div className="dropdown dropdown-end">
        <label
          tabIndex={0}
          className="btn btn-xs btn-ghost btn-square"
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </label>
        <ul
          tabIndex={0}
          className="dropdown-content z-50 menu p-2 shadow bg-base-100 rounded-box w-40"
        >
          <li>
            <button onClick={onRename}>Rename</button>
          </li>
          <li>
            <button onClick={onDuplicate}>Duplicate</button>
          </li>
          <li className={canMoveUp ? '' : 'disabled'}>
            <button onClick={canMoveUp ? onMoveUp : undefined}>Move Up</button>
          </li>
          <li className={canMoveDown ? '' : 'disabled'}>
            <button onClick={canMoveDown ? onMoveDown : undefined}>Move Down</button>
          </li>
          <li className={canDelete ? '' : 'disabled'}>
            <button
              className="text-error"
              onClick={canDelete ? onDelete : undefined}
            >
              Delete
            </button>
          </li>
        </ul>
      </div>
    </li>
  );
}

interface ActiveLayerInfoProps {
  layer?: ImageLayer;
  onOpacityChange: (opacity: number) => void;
  onBlendModeChange: (mode: ImageLayer['blendMode']) => void;
}

function ActiveLayerInfo({
  layer,
  onOpacityChange,
  onBlendModeChange
}: ActiveLayerInfoProps) {
  if (!layer) return null;

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs text-base-content/70">
          Opacity: {layer.opacity}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={layer.opacity}
          onChange={(e) => onOpacityChange(parseInt(e.target.value))}
          className="range range-xs range-primary"
        />
      </div>

      <div>
        <label className="text-xs text-base-content/70">Blend Mode</label>
        <select
          className="select select-xs select-bordered w-full"
          value={layer.blendMode}
          onChange={(e) => onBlendModeChange(e.target.value as ImageLayer['blendMode'])}
        >
          <option value="normal">Normal</option>
          <option value="multiply">Multiply</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
          <option value="darken">Darken</option>
          <option value="lighten">Lighten</option>
        </select>
      </div>
    </div>
  );
}
