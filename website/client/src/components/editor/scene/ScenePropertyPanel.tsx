import { useCallback } from 'react';
import type { Scene, SceneObject, ShapeObject, TextObject, Transform2D } from '@/types/scene';

interface ScenePropertyPanelProps {
  scene: Scene;
  selectedIds: string[];
  onUpdateObject: (id: string, updates: Partial<SceneObject>) => void;
  onUpdateTransform: (id: string, transform: Partial<Transform2D>) => void;
  onUpdateSceneViewport: (updates: { width?: number; height?: number; backgroundColor?: string }) => void;
}

export default function ScenePropertyPanel({
  scene,
  selectedIds,
  onUpdateObject,
  onUpdateTransform,
  onUpdateSceneViewport,
}: ScenePropertyPanelProps) {
  const selectedObject = selectedIds.length === 1 ? scene.objects[selectedIds[0]] : null;

  const handleTransformChange = useCallback(
    (field: keyof Transform2D, value: number) => {
      if (selectedObject) {
        onUpdateTransform(selectedObject.id, { [field]: value });
      }
    },
    [selectedObject, onUpdateTransform]
  );

  const handlePropertyChange = useCallback(
    (field: string, value: any) => {
      if (selectedObject) {
        onUpdateObject(selectedObject.id, { [field]: value } as Partial<SceneObject>);
      }
    },
    [selectedObject, onUpdateObject]
  );

  // Number input component
  const NumberInput = ({
    label,
    value,
    onChange,
    min,
    max,
    step = 1,
  }: {
    label: string;
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
  }) => (
    <div className="flex items-center gap-2">
      <label className="text-xs text-base-content/70 w-8">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className="input input-xs input-bordered flex-1 bg-base-200"
      />
    </div>
  );

  // Color input component
  const ColorInput = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (val: string) => void;
  }) => (
    <div className="flex items-center gap-2">
      <label className="text-xs text-base-content/70 flex-1">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input input-xs input-bordered w-20 bg-base-200 font-mono"
      />
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-base-100">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-base-300">
        <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
          <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
        </svg>
        <h2 className="text-sm font-semibold">
          {selectedObject ? selectedObject.name : selectedIds.length > 1 ? `${selectedIds.length} Selected` : 'Properties'}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedObject ? (
          // Scene properties when nothing selected
          <div className="p-4 space-y-4">
            <details open className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                <h3 className="text-sm font-semibold text-base-content">Scene Settings</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </summary>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <NumberInput
                    label="W"
                    value={scene.viewport.width}
                    onChange={(val) => onUpdateSceneViewport({ width: val })}
                    min={1}
                    max={4096}
                  />
                  <NumberInput
                    label="H"
                    value={scene.viewport.height}
                    onChange={(val) => onUpdateSceneViewport({ height: val })}
                    min={1}
                    max={4096}
                  />
                </div>
                <ColorInput
                  label="Background"
                  value={scene.viewport.backgroundColor}
                  onChange={(val) => onUpdateSceneViewport({ backgroundColor: val })}
                />
              </div>
            </details>

            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                <h3 className="text-sm font-semibold text-base-content">Scene Info</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </summary>

              <div className="space-y-2 text-xs text-base-content/70">
                <div className="flex justify-between">
                  <span>Name:</span>
                  <span>{scene.metadata.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Objects:</span>
                  <span>{Object.keys(scene.objects).length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Version:</span>
                  <span>{scene.metadata.version}</span>
                </div>
              </div>
            </details>
          </div>
        ) : (
          // Object properties
          <div className="p-4 space-y-4">
            {/* Name */}
            <div>
              <label className="text-xs text-base-content/70 mb-1 block">Name</label>
              <input
                type="text"
                value={selectedObject.name}
                onChange={(e) => handlePropertyChange('name', e.target.value)}
                className="input input-sm input-bordered w-full bg-base-200"
              />
            </div>

            {/* Transform */}
            <details open className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                <h3 className="text-sm font-semibold text-base-content">Transform</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </summary>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-base-content/70 mb-1 block">Position</label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberInput
                      label="X"
                      value={selectedObject.transform.x}
                      onChange={(val) => handleTransformChange('x', val)}
                    />
                    <NumberInput
                      label="Y"
                      value={selectedObject.transform.y}
                      onChange={(val) => handleTransformChange('y', val)}
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-base-content/70 mb-1 block">Rotation</label>
                  <NumberInput
                    label="°"
                    value={selectedObject.transform.rotation}
                    onChange={(val) => handleTransformChange('rotation', val)}
                    min={-360}
                    max={360}
                  />
                </div>

                <div>
                  <label className="text-xs text-base-content/70 mb-1 block">Scale</label>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberInput
                      label="X"
                      value={selectedObject.transform.scaleX}
                      onChange={(val) => handleTransformChange('scaleX', val)}
                      step={0.1}
                    />
                    <NumberInput
                      label="Y"
                      value={selectedObject.transform.scaleY}
                      onChange={(val) => handleTransformChange('scaleY', val)}
                      step={0.1}
                    />
                  </div>
                </div>
              </div>
            </details>

            {/* Shape properties */}
            {selectedObject.type === 'shape' && (
              <details open className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                  <h3 className="text-sm font-semibold text-base-content">Shape</h3>
                  <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </summary>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <NumberInput
                      label="W"
                      value={(selectedObject as ShapeObject).width}
                      onChange={(val) => handlePropertyChange('width', val)}
                      min={1}
                    />
                    <NumberInput
                      label="H"
                      value={(selectedObject as ShapeObject).height}
                      onChange={(val) => handlePropertyChange('height', val)}
                      min={1}
                    />
                  </div>
                  <ColorInput
                    label="Fill"
                    value={(selectedObject as ShapeObject).fillColor}
                    onChange={(val) => handlePropertyChange('fillColor', val)}
                  />
                  <ColorInput
                    label="Stroke"
                    value={(selectedObject as ShapeObject).strokeColor}
                    onChange={(val) => handlePropertyChange('strokeColor', val)}
                  />
                  <NumberInput
                    label="Stroke Width"
                    value={(selectedObject as ShapeObject).strokeWidth}
                    onChange={(val) => handlePropertyChange('strokeWidth', val)}
                    min={0}
                    max={50}
                  />
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Opacity</label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={(selectedObject as ShapeObject).opacity}
                      onChange={(e) => handlePropertyChange('opacity', parseFloat(e.target.value))}
                      className="range range-xs range-primary"
                    />
                  </div>
                </div>
              </details>
            )}

            {/* Text properties */}
            {selectedObject.type === 'text' && (
              <details open className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                  <h3 className="text-sm font-semibold text-base-content">Text</h3>
                  <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </summary>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Content</label>
                    <textarea
                      value={(selectedObject as TextObject).text}
                      onChange={(e) => handlePropertyChange('text', e.target.value)}
                      className="textarea textarea-bordered textarea-sm w-full bg-base-200"
                      rows={3}
                    />
                  </div>
                  <NumberInput
                    label="Size"
                    value={(selectedObject as TextObject).fontSize}
                    onChange={(val) => handlePropertyChange('fontSize', val)}
                    min={8}
                    max={200}
                  />
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Font</label>
                    <select
                      value={(selectedObject as TextObject).fontFamily}
                      onChange={(e) => handlePropertyChange('fontFamily', e.target.value)}
                      className="select select-sm select-bordered w-full bg-base-200"
                    >
                      <option value="Arial">Arial</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Courier New">Courier New</option>
                      <option value="Verdana">Verdana</option>
                    </select>
                  </div>
                  <ColorInput
                    label="Color"
                    value={(selectedObject as TextObject).color}
                    onChange={(val) => handlePropertyChange('color', val)}
                  />
                  <div className="flex gap-2">
                    <button
                      className={`btn btn-sm flex-1 ${(selectedObject as TextObject).fontWeight === 'bold' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => handlePropertyChange('fontWeight', (selectedObject as TextObject).fontWeight === 'bold' ? 'normal' : 'bold')}
                    >
                      <strong>B</strong>
                    </button>
                    <button
                      className={`btn btn-sm flex-1 ${(selectedObject as TextObject).fontStyle === 'italic' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => handlePropertyChange('fontStyle', (selectedObject as TextObject).fontStyle === 'italic' ? 'normal' : 'italic')}
                    >
                      <em>I</em>
                    </button>
                  </div>
                </div>
              </details>
            )}

            {/* Visibility and Lock */}
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                <h3 className="text-sm font-semibold text-base-content">Display</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </summary>

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedObject.visible}
                    onChange={(e) => handlePropertyChange('visible', e.target.checked)}
                    className="checkbox checkbox-sm checkbox-primary"
                  />
                  <span className="text-sm">Visible</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedObject.locked}
                    onChange={(e) => handlePropertyChange('locked', e.target.checked)}
                    className="checkbox checkbox-sm checkbox-primary"
                  />
                  <span className="text-sm">Locked</span>
                </label>
                <NumberInput
                  label="Z-Index"
                  value={selectedObject.zIndex}
                  onChange={(val) => handlePropertyChange('zIndex', val)}
                />
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
