import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

// Props for split view support
interface SceneEditorContentProps {
  sessionId?: string;
}

export function SceneEditorContent({ sessionId: sessionIdProp }: SceneEditorContentProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  // sessionId available for future use
  void (sessionIdProp ?? sessionIdParam);
  return <EditorPlaceholder />;
}

function EditorPlaceholder() {
  const [selectedObject, setSelectedObject] = useState('Cube');

  const sceneObjects = [
    { id: 'scene-root', name: 'Scene Root', icon: '📁', hasChildren: true },
    { id: 'camera', name: 'Main Camera', icon: '📹', hasChildren: false },
    { id: 'light', name: 'Directional Light', icon: '💡', hasChildren: false },
    { id: 'cube', name: 'Cube', icon: '🧊', hasChildren: false },
    { id: 'sphere', name: 'Sphere', icon: '⚪', hasChildren: false },
  ];

  const tools = [
    { id: 'select', icon: '⤢', label: 'Select' },
    { id: 'move', icon: '✋', label: 'Move' },
    { id: 'zoom', icon: '🔍', label: 'Zoom' },
    { id: 'rotate', icon: '⟲', label: 'Rotate' },
    { id: 'grid', icon: '⊞', label: 'Grid' },
    { id: 'more', icon: '⋮', label: 'More' },
  ];

  return (
    <div className="h-full flex flex-col bg-base-300">
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Hierarchy */}
        <div className="w-72 bg-base-100 border-r border-base-300 flex flex-col">
          {/* Hierarchy Header */}
          <div className="p-4 border-b border-base-300">
            <h2 className="text-sm font-semibold text-base-content mb-2">Hierarchy</h2>
            <p className="text-xs text-base-content/60 mb-3">Scene objects</p>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search objects..."
                className="input input-sm input-bordered w-full pl-8 bg-base-200"
              />
              <svg className="w-4 h-4 absolute left-2.5 top-2 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          {/* Object List */}
          <div className="flex-1 overflow-y-auto p-2">
            {sceneObjects.map((obj, index) => (
              <button
                key={obj.id}
                onClick={() => setSelectedObject(obj.name)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                  selectedObject === obj.name
                    ? 'bg-primary text-primary-content'
                    : 'hover:bg-base-200 text-base-content'
                } ${index === 0 ? '' : 'ml-0'}`}
              >
                <span className="text-base">{obj.icon}</span>
                <span className="text-sm flex-1">{obj.name}</span>
                <svg className="w-4 h-4 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                  <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/>
                </svg>
              </button>
            ))}
          </div>
        </div>

        {/* Center - Viewport */}
        <div className="flex-1 flex flex-col bg-base-200">
          {/* Viewport Container */}
          <div className="flex-1 flex relative">
            {/* Toolbar */}
            <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-base-100 rounded-lg shadow-lg border border-base-300">
              {tools.map((tool, index) => (
                <button
                  key={tool.id}
                  className={`w-12 h-12 flex items-center justify-center hover:bg-primary hover:text-primary-content transition-colors text-xl ${
                    index === 3 ? 'bg-primary text-primary-content' : ''
                  } ${index === 0 ? 'rounded-t-lg' : ''} ${index === tools.length - 1 ? 'rounded-b-lg' : 'border-b border-base-300'}`}
                  title={tool.label}
                >
                  {tool.icon}
                </button>
              ))}
            </div>

            {/* Viewport Area */}
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="relative inline-block mb-4">
                  {/* Grid background */}
                  <div className="w-96 h-64 bg-gradient-to-b from-base-300 to-base-100 rounded-lg border-2 border-base-300 flex items-center justify-center overflow-hidden">
                    {/* Grid pattern */}
                    <div className="absolute inset-0" style={{
                      backgroundImage: `
                        linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)
                      `,
                      backgroundSize: '32px 32px'
                    }}></div>

                    {/* Simple 3D cube representation */}
                    <div className="relative z-10">
                      <div className="w-24 h-24 bg-base-content/20 border-2 border-base-content/40 rounded-lg transform rotate-12 flex items-center justify-center">
                        <span className="text-4xl">🧊</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-base-content/60">3D Viewport - Coming Soon</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Properties */}
        <div className="w-80 bg-base-100 border-l border-base-300 flex flex-col overflow-y-auto">
          {/* Properties Header */}
          <div className="p-4 border-b border-base-300 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
              <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z"/>
            </svg>
            <h2 className="text-sm font-semibold text-base-content">{selectedObject} Properties</h2>
          </div>

          {/* Transform Section */}
          <div className="p-4 border-b border-base-300">
            <details open className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none mb-3">
                <h3 className="text-sm font-semibold text-base-content">Transform</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </summary>
              <p className="text-xs text-base-content/60 mb-3">Position, Rotation, and Scale values.</p>

              {/* Position */}
              <div className="mb-3">
                <label className="text-xs text-base-content/70 mb-1 block">Position</label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" placeholder="0.0" className="input input-xs input-bordered bg-base-200" defaultValue="0.0" />
                  <input type="number" placeholder="0.5" className="input input-xs input-bordered bg-base-200" defaultValue="0.5" />
                  <input type="number" placeholder="0.0" className="input input-xs input-bordered bg-base-200" defaultValue="0.0" />
                </div>
              </div>

              {/* Rotation */}
              <div className="mb-3">
                <label className="text-xs text-base-content/70 mb-1 block">Rotation</label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" placeholder="0" className="input input-xs input-bordered bg-base-200" defaultValue="0" />
                  <input type="number" placeholder="0" className="input input-xs input-bordered bg-base-200" defaultValue="0" />
                  <input type="number" placeholder="0" className="input input-xs input-bordered bg-base-200" defaultValue="0" />
                </div>
              </div>

              {/* Scale */}
              <div>
                <label className="text-xs text-base-content/70 mb-1 block">Scale</label>
                <div className="grid grid-cols-3 gap-2">
                  <input type="number" placeholder="1.0" className="input input-xs input-bordered bg-base-200" defaultValue="1.0" />
                  <input type="number" placeholder="1.0" className="input input-xs input-bordered bg-base-200" defaultValue="1.0" />
                  <input type="number" placeholder="1.0" className="input input-xs input-bordered bg-base-200" defaultValue="1.0" />
                </div>
              </div>
            </details>
          </div>

          {/* Mesh Properties Section */}
          <div className="p-4 border-b border-base-300">
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <h3 className="text-sm font-semibold text-base-content">Mesh Properties</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </summary>
            </details>
          </div>

          {/* Material Section */}
          <div className="p-4">
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <h3 className="text-sm font-semibold text-base-content">Material</h3>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                </svg>
              </summary>
            </details>
          </div>
        </div>
      </div>

      {/* Bottom Panel - Assets */}
      <div className="h-48 bg-base-100 border-t border-base-300 flex flex-col">
        {/* Assets Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-base-300">
          <div className="flex items-center gap-4">
            <div className="flex gap-1 text-xs">
              <button className="px-3 py-1 rounded hover:bg-base-200 text-base-content/70">Assets</button>
              <span className="px-2 py-1 text-base-content/40">›</span>
              <button className="px-3 py-1 rounded bg-base-200 text-base-content">Models</button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <input
                type="text"
                placeholder="Search assets..."
                className="input input-xs input-bordered w-48 pl-7 bg-base-200"
              />
              <svg className="w-3.5 h-3.5 absolute left-2 top-1.5 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>

            {/* Import Button */}
            <button className="btn btn-primary btn-xs gap-1">
              <span className="text-lg leading-none">+</span>
              Import
            </button>
          </div>
        </div>

        {/* Assets Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-6 gap-3">
            {/* Asset Items */}
            {['📁', '🤖', '🧱', '🎨', '📦', '🌳'].map((icon, i) => (
              <div key={i} className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-base-200 cursor-pointer transition-colors">
                <div className="w-16 h-16 bg-base-300 rounded-lg flex items-center justify-center text-3xl border border-base-content/10">
                  {icon}
                </div>
                <span className="text-xs text-base-content/70 text-center truncate w-full">
                  {['Textures', 'Robot', 'Rock Wall', 'Materials', 'Cube', 'Tree'][i]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SceneEditorProps {
  isEmbedded?: boolean;
}

export default function SceneEditor({ isEmbedded: isEmbeddedProp = false }: SceneEditorProps) {
  // Check if we're embedded via context (from split view) or prop
  const { isEmbedded: isEmbeddedContext } = useEmbedded();
  const isEmbedded = isEmbeddedProp || isEmbeddedContext;

  // Wrap content conditionally - when embedded, skip SessionLayout wrapper
  const Wrapper = isEmbedded ?
    ({ children }: { children: React.ReactNode }) => <div className="h-full flex flex-col overflow-hidden bg-base-200">{children}</div> :
    ({ children }: { children: React.ReactNode }) => (
      <SessionLayout>
        {children}
      </SessionLayout>
    );

  return (
    <Wrapper>
      <EditorPlaceholder />
    </Wrapper>
  );
}
