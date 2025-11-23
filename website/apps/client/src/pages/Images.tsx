import { useState } from 'react';
import SessionLayout from '@/components/SessionLayout';

type EditorType = 'sprite' | 'spritesheet' | 'animation';

function ImagesContent() {
  const [selectedEditor, setSelectedEditor] = useState<EditorType>('sprite');
  const [selectedAsset, setSelectedAsset] = useState<string>('character_idle.png');

  const mockImages = [
    'character_idle.png',
    'character_walk.png',
    'enemy_type_A.png',
    'background_layer1.png',
    'explosion.png',
  ];

  const mockAnimations = [
    'Player_Idle',
    'Player_Run',
    'Player_Jump',
  ];

  const mockSprites = [
    'idle_0',
    'idle_1',
    'idle_2',
    'idle_3',
  ];

  return (
    <div className="h-full flex bg-base-300">
      {/* Left Sidebar */}
      <div className="w-64 bg-base-100 border-r border-base-300 flex flex-col">
        {/* Project Info */}
        <div className="p-4 border-b border-base-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
              </svg>
            </div>
            <div>
              <div className="font-semibold text-base-content">Project Alpha</div>
              <div className="text-xs text-base-content/60">Images & Animations</div>
            </div>
          </div>
        </div>

        {/* Browse Button */}
        <div className="p-4 border-b border-base-300">
          <button className="btn btn-sm btn-outline w-full gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            Browse
          </button>
        </div>

        {/* Editor Navigation */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <button
              onClick={() => setSelectedEditor('sprite')}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${
                selectedEditor === 'sprite'
                  ? 'bg-primary/10 text-primary'
                  : 'text-base-content/70 hover:bg-base-200'
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18 4V3c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v4c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V6h1v4H9v11c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-9h8V4h-3z"/>
              </svg>
              Sprite Editor
            </button>

            <button
              onClick={() => setSelectedEditor('spritesheet')}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${
                selectedEditor === 'spritesheet'
                  ? 'bg-primary/10 text-primary'
                  : 'text-base-content/70 hover:bg-base-200'
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>
              </svg>
              Sprite Sheet Editor
            </button>

            <button
              onClick={() => setSelectedEditor('animation')}
              className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors ${
                selectedEditor === 'animation'
                  ? 'bg-primary/10 text-primary'
                  : 'text-base-content/70 hover:bg-base-200'
              }`}
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
              Animation Editor
            </button>
          </div>

          {/* Assets Section */}
          {selectedEditor !== 'animation' && (
            <div className="p-2 mt-4">
              <div className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-3 mb-2">
                Images
              </div>
              <div className="space-y-1">
                {mockImages.map((image) => (
                  <button
                    key={image}
                    onClick={() => setSelectedAsset(image)}
                    className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                      selectedAsset === image
                        ? 'bg-primary/10 text-primary'
                        : 'text-base-content/70 hover:bg-base-200'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                    </svg>
                    {image}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedEditor === 'animation' && (
            <div className="p-2 mt-4">
              <div className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-3 mb-2">
                Animations
              </div>
              <div className="space-y-1">
                {mockAnimations.map((animation) => (
                  <button
                    key={animation}
                    className="w-full text-left px-3 py-1.5 rounded text-sm text-base-content/70 hover:bg-base-200 transition-colors"
                  >
                    {animation}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedEditor === 'spritesheet' && selectedAsset && (
            <div className="p-2 mt-4">
              <div className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-3 mb-2">
                Sprite List ({mockSprites.length})
              </div>
              <div className="space-y-1">
                {mockSprites.map((sprite) => (
                  <button
                    key={sprite}
                    className="w-full text-left px-3 py-1.5 rounded text-sm text-base-content/70 hover:bg-base-200 transition-colors"
                  >
                    {sprite}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {selectedEditor === 'sprite' && <SpriteEditor />}
        {selectedEditor === 'spritesheet' && <SpritesheetEditor />}
        {selectedEditor === 'animation' && <AnimationEditor />}
      </div>
    </div>
  );
}

function SpriteEditor() {
  return (
    <>
      {/* Toolbar */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center gap-2">
        <div className="text-sm font-semibold text-base-content/70">Sprite Editor</div>
        <div className="flex-1 flex gap-1 ml-4">
          {/* Drawing Tools */}
          <button className="btn btn-xs btn-square btn-ghost" title="Select">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 3h2v2H3V3zm4 0h2v2H7V3zm4 0h2v2h-2V3zm4 0h2v2h-2V3zm4 0h2v2h-2V3zm0 4h2v2h-2V7zM3 7h2v2H3V7zm0 4h2v2H3v-2zm0 4h2v2H3v-2zm0 4h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm0-4h2v2h-2v-2zm0-4h2v2h-2v-2z"/>
            </svg>
          </button>
          <button className="btn btn-xs btn-square btn-primary" title="Pencil">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
          </button>
          <button className="btn btn-xs btn-square btn-ghost" title="Fill">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z"/>
            </svg>
          </button>
          <button className="btn btn-xs btn-square btn-ghost" title="Eraser">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-6.36-6.36-3.54 3.53c-.78.79-.78 2.05 0 2.83z"/>
            </svg>
          </button>
          <div className="divider divider-horizontal mx-1"></div>
          <button className="btn btn-xs btn-square btn-ghost" title="Rectangle">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" strokeWidth="2"/>
            </svg>
          </button>
          <button className="btn btn-xs btn-square btn-ghost" title="Circle">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" strokeWidth="2"/>
            </svg>
          </button>
        </div>
        <button className="btn btn-sm btn-primary gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
          </svg>
          Save
        </button>
        <button className="btn btn-sm btn-outline gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/>
          </svg>
          Export
        </button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex items-center justify-center bg-base-200 p-4">
        <div className="relative">
          {/* Pixel Grid Canvas Mock */}
          <div className="bg-white rounded shadow-lg p-4">
            {/* Mock character sprite using CSS */}
            <div className="relative" style={{ width: '256px', height: '256px' }}>
              {/* Checkerboard pattern background */}
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
              }}></div>

              {/* Mock pixel art character */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-6xl">👤</div>
              </div>

              {/* Grid overlay */}
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: 'linear-gradient(rgba(0,0,0,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.1) 1px, transparent 1px)',
                backgroundSize: '32px 32px'
              }}></div>
            </div>
          </div>

          {/* Zoom indicator */}
          <div className="absolute bottom-2 right-2 bg-base-100 px-2 py-1 rounded text-xs text-base-content/70">
            800%
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-64 bg-base-100 border-l border-base-300 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Color Palette */}
          <div>
            <div className="font-semibold text-base-content mb-2">Colors</div>
            <div className="grid grid-cols-8 gap-1">
              {['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                '#880000', '#008800', '#000088', '#888800', '#880088', '#008888', '#888888', '#444444'].map((color) => (
                <button
                  key={color}
                  className="w-6 h-6 rounded border border-base-300 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
          </div>

          {/* Layers */}
          <div className="pt-4 border-t border-base-300">
            <div className="font-semibold text-base-content mb-2 flex items-center justify-between">
              Layers
              <button className="btn btn-xs btn-ghost">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
              </button>
            </div>
            <div className="space-y-1">
              {['Main', 'Shadow', 'Outline'].map((layer, i) => (
                <div
                  key={layer}
                  className={`flex items-center gap-2 p-2 rounded ${i === 0 ? 'bg-primary/10' : 'bg-base-200'}`}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                  </svg>
                  <span className="text-sm flex-1">{layer}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SpritesheetEditor() {
  return (
    <>
      {/* Toolbar */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center gap-4">
        <div className="text-sm font-semibold text-base-content/70">Sprite Sheet Editor</div>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-ghost btn-square" title="Zoom In">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
            </svg>
          </button>
          <button className="btn btn-sm btn-ghost btn-square" title="Zoom Out">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              <path d="M7 9h5v1H7z"/>
            </svg>
          </button>
          <div className="text-sm text-base-content/50 px-2 flex items-center">100%</div>
        </div>
        <div className="flex-1"></div>
        <button className="btn btn-sm btn-primary gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/>
          </svg>
          Export Sprites
        </button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex items-center justify-center bg-base-200 p-8 overflow-auto">
        <div className="relative">
          {/* Mock sprite sheet with character animations */}
          <div className="bg-white rounded shadow-lg p-4">
            <div className="grid grid-cols-4 gap-2">
              {/* Mock 4 frames of idle animation */}
              {[1, 2, 3, 4].map((frame) => (
                <div
                  key={frame}
                  className="w-32 h-32 border-2 border-primary/60 rounded flex items-center justify-center relative group hover:bg-primary/5 transition-colors"
                  style={{
                    backgroundImage: 'linear-gradient(45deg, #f3f4f6 25%, transparent 25%), linear-gradient(-45deg, #f3f4f6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f3f4f6 75%), linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                  }}
                >
                  <div className="text-4xl">{frame % 2 === 0 ? '🧍' : '🚶'}</div>
                  <div className="absolute top-1 right-1 bg-primary text-primary-content text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                    {frame}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Slice count indicator */}
          <div className="absolute top-2 right-2 bg-base-100 px-3 py-1 rounded-lg shadow text-sm text-base-content">
            <span className="font-semibold">4</span> sprites detected
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-64 bg-base-100 border-l border-base-300 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Slicing Tools */}
          <div>
            <div className="font-semibold text-base-content mb-3">Slicing Tools</div>
            <div className="space-y-3">
              <div className="flex gap-2">
                <button className="btn btn-sm btn-primary flex-1">Automatic</button>
                <button className="btn btn-sm btn-outline flex-1">Manual</button>
              </div>
            </div>
          </div>

          {/* Grid Settings */}
          <div className="pt-4 border-t border-base-300">
            <div className="font-semibold text-base-content mb-3">Grid Settings</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">By Cell Size</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="32"
                    defaultValue="32"
                    className="input input-sm input-bordered flex-1"
                  />
                  <input
                    type="number"
                    placeholder="32"
                    defaultValue="32"
                    className="input input-sm input-bordered flex-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">By Cell Count</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="4"
                    defaultValue="4"
                    className="input input-sm input-bordered flex-1"
                  />
                  <input
                    type="number"
                    placeholder="1"
                    defaultValue="1"
                    className="input input-sm input-bordered flex-1"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Export Options */}
          <div className="pt-4 border-t border-base-300">
            <div className="font-semibold text-base-content mb-3">Export Options</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="checkbox checkbox-sm" defaultChecked />
                <span className="text-sm">Trim transparency</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="checkbox checkbox-sm" defaultChecked />
                <span className="text-sm">Generate JSON</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AnimationEditor() {
  return (
    <>
      {/* Toolbar */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center gap-4">
        <div className="text-sm font-semibold text-base-content/70">Animation Editor</div>
        <div className="flex-1"></div>
        <button className="btn btn-sm btn-outline gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
          </svg>
          Share
        </button>
        <button className="btn btn-sm btn-primary gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/>
          </svg>
          Export
        </button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 flex items-center justify-center bg-base-200 p-8">
          {/* Animation Preview with mock character */}
          <div className="relative">
            <div className="w-96 h-64 bg-white rounded-lg shadow-lg flex items-center justify-center relative overflow-hidden">
              {/* Checkerboard background */}
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(45deg, #f3f4f6 25%, transparent 25%), linear-gradient(-45deg, #f3f4f6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f3f4f6 75%), linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
              }}></div>

              {/* Mock animated character */}
              <div className="relative z-10 text-8xl">
                🏃
              </div>
            </div>

            {/* FPS counter */}
            <div className="absolute top-2 right-2 bg-base-100 px-2 py-1 rounded text-xs text-base-content/70">
              10 FPS
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="bg-base-100 border-t border-base-300 p-4">
          {/* Playback Controls */}
          <div className="mb-4 flex items-center justify-center gap-3">
            <button className="btn btn-sm btn-primary btn-circle" title="Play/Pause">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
            <button className="btn btn-sm btn-outline btn-circle" title="Restart">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
            </button>
            <button className="btn btn-sm btn-outline btn-circle" title="Mute/Unmute">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </button>
          </div>

          {/* Frames */}
          <div>
            <div className="text-xs text-base-content/70 mb-2 flex items-center justify-between">
              <span>Frames</span>
              <span className="text-base-content/50">Frame 2 / 4</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[
                { emoji: '🧍', label: 'Idle' },
                { emoji: '🏃', label: 'Run 1' },
                { emoji: '🚶', label: 'Run 2' },
                { emoji: '🏃', label: 'Run 3' }
              ].map((frame, index) => (
                <div
                  key={index}
                  className={`w-24 h-24 flex-shrink-0 border-2 rounded ${
                    index === 1
                      ? 'border-primary bg-primary/10'
                      : 'border-base-300 bg-base-200'
                  } flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors relative`}
                  style={{
                    backgroundImage: 'linear-gradient(45deg, #f9fafb 25%, transparent 25%), linear-gradient(-45deg, #f9fafb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f9fafb 75%), linear-gradient(-45deg, transparent 75%, #f9fafb 75%)',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                  }}
                >
                  <div className="text-3xl">{frame.emoji}</div>
                  <div className="text-[10px] text-base-content/50 mt-1">{frame.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-64 bg-base-100 border-l border-base-300 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Animation Properties */}
          <div>
            <div className="font-semibold text-base-content mb-3">Animation Properties</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Animation Name</label>
                <input
                  type="text"
                  placeholder="Player_Run"
                  defaultValue="Player_Run"
                  className="input input-sm input-bordered w-full"
                />
              </div>
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Frame Duration (ms)</label>
                <input
                  type="number"
                  placeholder="100"
                  defaultValue="100"
                  className="input input-sm input-bordered w-full"
                />
              </div>
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Easing</label>
                <select className="select select-sm select-bordered w-full">
                  <option>Linear</option>
                  <option>Ease In</option>
                  <option>Ease Out</option>
                  <option>Ease In Out</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-base-content/70">Loop</label>
                <input type="checkbox" className="toggle toggle-sm toggle-primary" defaultChecked />
              </div>
            </div>
          </div>

          {/* Layers */}
          <div className="pt-4 border-t border-base-300">
            <div className="font-semibold text-base-content mb-3">Layers</div>
            <div className="space-y-2">
              {['Player Body', 'Weapon', 'Background'].map((layer) => (
                <div
                  key={layer}
                  className="flex items-center justify-between p-2 rounded bg-base-200 hover:bg-base-300 transition-colors"
                >
                  <span className="text-sm">{layer}</span>
                  <div className="flex gap-1">
                    <button className="btn btn-xs btn-ghost btn-circle">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                      </svg>
                    </button>
                    <button className="btn btn-xs btn-ghost btn-circle">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Images() {
  // Always use SessionLayout to show status bar
  return (
    <SessionLayout>
      <ImagesContent />
    </SessionLayout>
  );
}
