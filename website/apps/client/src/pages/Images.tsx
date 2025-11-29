import { useState, useRef } from 'react';
import SessionLayout from '@/components/SessionLayout';

type EditorMode = 'image' | 'spritesheet' | 'animation';
type ViewMode = 'preview' | 'edit';

interface RecentItem {
  id: string;
  name: string;
  thumbnail: string;
  lastModified: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  icon?: string;
}

// Mock file tree data
const mockFileTree: FileNode[] = [
  {
    name: 'sprites',
    path: 'sprites',
    type: 'folder',
    children: [
      { name: 'character_idle.png', path: 'sprites/character_idle.png', type: 'file', icon: '🖼️' },
      { name: 'character_walk.png', path: 'sprites/character_walk.png', type: 'file', icon: '🖼️' },
      { name: 'character_jump.png', path: 'sprites/character_jump.png', type: 'file', icon: '🖼️' },
      { name: 'enemy_type_A.png', path: 'sprites/enemy_type_A.png', type: 'file', icon: '🖼️' },
      { name: 'enemy_type_B.png', path: 'sprites/enemy_type_B.png', type: 'file', icon: '🖼️' },
    ],
  },
  {
    name: 'spritesheets',
    path: 'spritesheets',
    type: 'folder',
    children: [
      { name: 'player_run.png', path: 'spritesheets/player_run.png', type: 'file', icon: '🎞️' },
      { name: 'player_attack.png', path: 'spritesheets/player_attack.png', type: 'file', icon: '🎞️' },
      { name: 'explosion_fx.png', path: 'spritesheets/explosion_fx.png', type: 'file', icon: '🎞️' },
    ],
  },
  {
    name: 'backgrounds',
    path: 'backgrounds',
    type: 'folder',
    children: [
      { name: 'forest_layer1.png', path: 'backgrounds/forest_layer1.png', type: 'file', icon: '🖼️' },
      { name: 'forest_layer2.png', path: 'backgrounds/forest_layer2.png', type: 'file', icon: '🖼️' },
      { name: 'sky_gradient.png', path: 'backgrounds/sky_gradient.png', type: 'file', icon: '🖼️' },
    ],
  },
  {
    name: 'ui',
    path: 'ui',
    type: 'folder',
    children: [
      { name: 'button_normal.png', path: 'ui/button_normal.png', type: 'file', icon: '🖼️' },
      { name: 'button_hover.png', path: 'ui/button_hover.png', type: 'file', icon: '🖼️' },
      { name: 'health_bar.png', path: 'ui/health_bar.png', type: 'file', icon: '🖼️' },
    ],
  },
];

// Mock recent items
const mockRecentImages: RecentItem[] = [
  { id: '1', name: 'character_idle.png', thumbnail: '👤', lastModified: '2 hours ago' },
  { id: '2', name: 'enemy_type_A.png', thumbnail: '👹', lastModified: '4 hours ago' },
  { id: '3', name: 'button_normal.png', thumbnail: '🔲', lastModified: 'Yesterday' },
  { id: '4', name: 'forest_layer1.png', thumbnail: '🌲', lastModified: 'Yesterday' },
  { id: '5', name: 'sky_gradient.png', thumbnail: '🌅', lastModified: '2 days ago' },
  { id: '6', name: 'health_bar.png', thumbnail: '💚', lastModified: '2 days ago' },
  { id: '7', name: 'coin_gold.png', thumbnail: '🪙', lastModified: '3 days ago' },
  { id: '8', name: 'gem_blue.png', thumbnail: '💎', lastModified: '3 days ago' },
];

const mockRecentSpritesheets: RecentItem[] = [
  { id: '1', name: 'player_run.png', thumbnail: '🏃', lastModified: '1 hour ago' },
  { id: '2', name: 'player_attack.png', thumbnail: '⚔️', lastModified: '3 hours ago' },
  { id: '3', name: 'explosion_fx.png', thumbnail: '💥', lastModified: 'Yesterday' },
  { id: '4', name: 'coin_spin.png', thumbnail: '🪙', lastModified: 'Yesterday' },
  { id: '5', name: 'fire_effect.png', thumbnail: '🔥', lastModified: '2 days ago' },
  { id: '6', name: 'water_splash.png', thumbnail: '💦', lastModified: '2 days ago' },
  { id: '7', name: 'dust_cloud.png', thumbnail: '💨', lastModified: '3 days ago' },
  { id: '8', name: 'magic_sparkle.png', thumbnail: '✨', lastModified: '4 days ago' },
];

const mockRecentAnimations: RecentItem[] = [
  { id: '1', name: 'Player_Idle', thumbnail: '🧍', lastModified: '30 mins ago' },
  { id: '2', name: 'Player_Run', thumbnail: '🏃', lastModified: '1 hour ago' },
  { id: '3', name: 'Player_Jump', thumbnail: '🦘', lastModified: '2 hours ago' },
  { id: '4', name: 'Enemy_Attack', thumbnail: '👊', lastModified: 'Yesterday' },
  { id: '5', name: 'Explosion_VFX', thumbnail: '💥', lastModified: 'Yesterday' },
  { id: '6', name: 'Coin_Collect', thumbnail: '🪙', lastModified: '2 days ago' },
  { id: '7', name: 'Door_Open', thumbnail: '🚪', lastModified: '3 days ago' },
  { id: '8', name: 'Flag_Wave', thumbnail: '🚩', lastModified: '4 days ago' },
];

function ImagesContent() {
  const [editorMode, setEditorMode] = useState<EditorMode>('image');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [showExplorer, setShowExplorer] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['sprites']));
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // Get recent items based on current mode
  const getRecentItems = () => {
    switch (editorMode) {
      case 'image':
        return mockRecentImages;
      case 'spritesheet':
        return mockRecentSpritesheets;
      case 'animation':
        return mockRecentAnimations;
    }
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleFileClick = (node: FileNode) => {
    if (node.type === 'folder') {
      toggleFolder(node.path);
    } else {
      setSelectedFile({ path: node.path, name: node.name });
      setViewMode('preview');
    }
  };

  const handleRecentClick = (item: RecentItem) => {
    setSelectedFile({ path: item.id, name: item.name });
    setViewMode('preview');
  };

  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim() || isGenerating) return;

    setIsGenerating(true);
    // Simulate AI generation
    setTimeout(() => {
      setIsGenerating(false);
      setAiPrompt('');
    }, 2000);
  };

  // Render file tree recursively
  const renderFileTree = (nodes: FileNode[], level = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const paddingLeft = level * 12 + 8;
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = selectedFile?.path === node.path;

      if (node.type === 'folder') {
        return (
          <div key={node.path}>
            <div
              onClick={() => handleFileClick(node)}
              className="flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-base-200 transition-colors"
              style={{ paddingLeft }}
            >
              <svg
                className={`w-3 h-3 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <svg className="w-4 h-4 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              <span className="text-xs font-medium truncate">{node.name}</span>
            </div>
            {isExpanded && node.children && renderFileTree(node.children, level + 1)}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          onClick={() => handleFileClick(node)}
          className={`flex items-center gap-1.5 py-1 px-2 cursor-pointer transition-colors ${
            isSelected ? 'bg-primary/20 text-primary' : 'hover:bg-base-200'
          }`}
          style={{ paddingLeft: paddingLeft + 16 }}
        >
          <span className="text-xs flex-shrink-0">{node.icon || '📄'}</span>
          <span className="text-xs truncate">{node.name}</span>
        </div>
      );
    });
  };

  // Left Sidebar
  const LeftSidebar = () => (
    <div className="w-64 bg-base-100 border-r border-base-300 flex flex-col flex-shrink-0">
      {/* Editor Mode Tabs */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setEditorMode('image')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm ${
              editorMode === 'image'
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-200'
            }`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
            ImageEDT
          </button>
          <button
            onClick={() => setEditorMode('spritesheet')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm ${
              editorMode === 'spritesheet'
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-200'
            }`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>
            </svg>
            SpriteSheetEDT
          </button>
          <button
            onClick={() => setEditorMode('animation')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm ${
              editorMode === 'animation'
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-200'
            }`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
            </svg>
            AnimationEDT
          </button>
        </div>
      </div>

      {/* Browse Button */}
      <div className="p-3 border-b border-base-300">
        <button
          onClick={() => setShowExplorer(!showExplorer)}
          className={`btn btn-sm w-full gap-2 ${showExplorer ? 'btn-primary' : 'btn-outline'}`}
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
          Browse
          <svg className={`w-3 h-3 ml-auto transition-transform ${showExplorer ? 'rotate-180' : ''}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* File Explorer (collapsible) */}
      {showExplorer && (
        <div className="border-b border-base-300 max-h-64 overflow-y-auto">
          <div className="py-2">
            {renderFileTree(mockFileTree)}
          </div>
        </div>
      )}

      {/* New Button */}
      <div className="p-3 border-b border-base-300">
        <button className="btn btn-sm btn-primary w-full gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          New {editorMode === 'image' ? 'Image' : editorMode === 'spritesheet' ? 'Sprite Sheet' : 'Animation'}
        </button>
      </div>

      {/* Recent Items */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          <div className="text-xs font-semibold text-base-content/50 uppercase tracking-wider px-2 mb-2">
            Recent {editorMode === 'image' ? 'Images' : editorMode === 'spritesheet' ? 'Sheets' : 'Animations'}
          </div>
          <div className="space-y-0.5">
            {getRecentItems().map((item) => (
              <button
                key={item.id}
                onClick={() => handleRecentClick(item)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left ${
                  selectedFile?.name === item.name
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-base-200 text-base-content'
                }`}
              >
                <div
                  className="w-6 h-6 rounded border border-base-300 flex items-center justify-center text-sm flex-shrink-0"
                  style={{
                    backgroundImage: 'linear-gradient(45deg, #f3f4f6 25%, transparent 25%), linear-gradient(-45deg, #f3f4f6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f3f4f6 75%), linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)',
                    backgroundSize: '4px 4px',
                    backgroundPosition: '0 0, 0 2px, 2px -2px, -2px 0px'
                  }}
                >
                  {item.thumbnail}
                </div>
                <span className="text-xs truncate">{item.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Preview Content (when file is selected but not editing)
  const PreviewContent = () => (
    <div className="flex-1 flex flex-col">
      {/* Preview Header */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🖼️</span>
          <span className="font-medium text-sm">{selectedFile?.name}</span>
          <span className="text-xs text-base-content/50">256 x 256 px</span>
        </div>
        <button
          onClick={() => setViewMode('edit')}
          className="btn btn-primary btn-sm gap-2"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
          </svg>
          Edit
        </button>
      </div>

      {/* Preview Content */}
      <div className="flex-1 flex items-center justify-center bg-base-200 p-8">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div
            className="w-64 h-64 flex items-center justify-center rounded relative"
            style={{
              backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
            }}
          >
            <span className="text-8xl">🖼️</span>
          </div>
        </div>
      </div>
    </div>
  );

  // Empty State Content
  const EmptyContent = () => (
    <div className="flex-1 flex items-center justify-center bg-base-200">
      <div className="text-center text-base-content/50">
        <svg className="w-20 h-20 mx-auto mb-4 opacity-30" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
        </svg>
        <p className="text-lg font-medium mb-2">No image selected</p>
        <p className="text-sm">Select an image from the sidebar or browse files</p>
      </div>
    </div>
  );

  // Editor Content (full editing mode)
  const EditorContent = () => (
    <div className="flex-1 flex flex-col">
      {/* Toolbar */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setViewMode('preview')}
          className="btn btn-ghost btn-sm btn-circle"
          title="Back to preview"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <div className="text-sm font-semibold text-base-content/70">{selectedFile?.name}</div>
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
          <button className="btn btn-xs btn-square btn-ghost" title="Brush">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34c-.39-.39-1.02-.39-1.41 0L9 12.25 11.75 15l8.96-8.96c.39-.39.39-1.02 0-1.41z"/>
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
          <button className="btn btn-xs btn-square btn-ghost" title="Line">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <line x1="4" y1="20" x2="20" y2="4" strokeWidth="2"/>
            </svg>
          </button>
          <div className="divider divider-horizontal mx-1"></div>
          <button className="btn btn-xs btn-square btn-ghost" title="Undo">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
            </svg>
          </button>
          <button className="btn btn-xs btn-square btn-ghost" title="Redo">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
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
      <div className="flex-1 flex items-center justify-center bg-base-200 p-4 min-h-0">
        <div className="relative">
          <div className="bg-white rounded shadow-lg p-4">
            <div className="relative" style={{ width: '384px', height: '384px' }}>
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
              }}></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-9xl">👤</div>
              </div>
              <div className="absolute inset-0 pointer-events-none" style={{
                backgroundImage: 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
                backgroundSize: '24px 24px'
              }}></div>
            </div>
          </div>
          <div className="absolute bottom-2 right-2 bg-base-100 px-3 py-1 rounded-lg shadow text-sm text-base-content/70 flex items-center gap-2">
            <button className="btn btn-xs btn-ghost btn-circle">-</button>
            <span>100%</span>
            <button className="btn btn-xs btn-ghost btn-circle">+</button>
          </div>
        </div>
      </div>

      {/* AI Prompt Input */}
      <div className="bg-base-100 border-t border-base-300 p-4 flex-shrink-0">
        <form onSubmit={handleAiSubmit} className="max-w-4xl mx-auto">
          <div className="relative">
            <textarea
              ref={promptInputRef}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Describe changes... (e.g., 'Add glowing effect', 'Change to blue')"
              rows={2}
              className="textarea textarea-bordered w-full pr-24 resize-none text-sm"
              disabled={isGenerating}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAiSubmit(e);
                }
              }}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <div className="text-xs text-base-content/50 hidden sm:block">
                Gemini 2.5
              </div>
              <button
                type="submit"
                disabled={!aiPrompt.trim() || isGenerating}
                className={`btn btn-circle btn-sm ${isGenerating ? 'btn-warning' : 'btn-primary'}`}
              >
                {isGenerating ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  // Right Sidebar - Context aware based on mode and view
  const RightSidebar = () => {
    // No file selected - show tips
    if (!selectedFile) {
      return (
        <div className="w-64 bg-base-100 border-l border-base-300 p-4 flex-shrink-0">
          <div className="text-sm font-semibold mb-4">Quick Start</div>
          <div className="space-y-3 text-sm text-base-content/70">
            <div className="flex items-start gap-2">
              <span className="text-primary">1.</span>
              <span>Select a recent image or browse files</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-primary">2.</span>
              <span>Click "Edit" to open the editor</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-primary">3.</span>
              <span>Use AI prompts to generate or modify</span>
            </div>
          </div>
        </div>
      );
    }

    // Preview mode - show file info
    if (viewMode === 'preview') {
      return (
        <div className="w-64 bg-base-100 border-l border-base-300 overflow-y-auto flex-shrink-0">
          <div className="p-4 space-y-4">
            {/* File Info */}
            <div>
              <div className="font-semibold text-base-content mb-3">File Info</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/60">Name</span>
                  <span className="truncate ml-2">{selectedFile.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Size</span>
                  <span>256 x 256</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Format</span>
                  <span>PNG</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">File size</span>
                  <span>24.5 KB</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-4 border-t border-base-300">
              <div className="font-semibold text-base-content mb-3">Actions</div>
              <div className="space-y-2">
                <button onClick={() => setViewMode('edit')} className="btn btn-sm btn-primary w-full gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                  Edit Image
                </button>
                <button className="btn btn-sm btn-outline w-full gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                  </svg>
                  Duplicate
                </button>
                <button className="btn btn-sm btn-outline w-full gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/>
                  </svg>
                  Export
                </button>
                <button className="btn btn-sm btn-ghost btn-error w-full gap-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Edit mode - show tools based on editor mode
    return (
      <div className="w-64 bg-base-100 border-l border-base-300 overflow-y-auto flex-shrink-0">
        <div className="p-4 space-y-4">
          {/* Mode-specific content */}
          {editorMode === 'image' && (
            <>
              {/* Color Palette */}
              <div>
                <div className="font-semibold text-base-content mb-3 flex items-center justify-between">
                  Colors
                  <button className="btn btn-xs btn-ghost">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z"/>
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded border-2 border-base-content bg-black"></div>
                  <div className="w-8 h-8 rounded border border-base-300 bg-white"></div>
                  <button className="btn btn-xs btn-ghost ml-auto">Swap</button>
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                    '#880000', '#008800', '#000088', '#888800', '#880088', '#008888', '#888888', '#444444'].map((color) => (
                    <button
                      key={color}
                      className="w-5 h-5 rounded border border-base-300 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>

              {/* Brush */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3">Brush</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Size: 4px</label>
                    <input type="range" min="1" max="32" defaultValue="4" className="range range-xs range-primary" />
                  </div>
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Opacity: 100%</label>
                    <input type="range" min="0" max="100" defaultValue="100" className="range range-xs range-primary" />
                  </div>
                </div>
              </div>

              {/* Layers */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3 flex items-center justify-between">
                  Layers
                  <button className="btn btn-xs btn-ghost">+</button>
                </div>
                <div className="space-y-1">
                  {['Layer 2', 'Layer 1', 'Background'].map((layer, i) => (
                    <div key={layer} className={`flex items-center gap-2 p-1.5 rounded text-xs ${i === 0 ? 'bg-primary/10' : 'bg-base-200'}`}>
                      <button className="btn btn-xs btn-ghost btn-circle p-0 min-h-0 h-4 w-4">👁</button>
                      <span className="flex-1 truncate">{layer}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {editorMode === 'spritesheet' && (
            <>
              {/* Slicing */}
              <div>
                <div className="font-semibold text-base-content mb-3">Slicing</div>
                <div className="flex gap-2 mb-3">
                  <button className="btn btn-sm btn-primary flex-1">Auto</button>
                  <button className="btn btn-sm btn-outline flex-1">Grid</button>
                </div>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Cell Size</label>
                    <div className="flex gap-2">
                      <input type="number" defaultValue="32" className="input input-xs input-bordered w-full" />
                      <input type="number" defaultValue="32" className="input input-xs input-bordered w-full" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Sprites */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3">Sprites (4)</div>
                <div className="grid grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="aspect-square bg-base-200 rounded border border-base-300 flex items-center justify-center text-xs">
                      {i}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {editorMode === 'animation' && (
            <>
              {/* Playback */}
              <div>
                <div className="font-semibold text-base-content mb-3">Playback</div>
                <div className="flex justify-center gap-2 mb-3">
                  <button className="btn btn-sm btn-circle btn-ghost">⏮</button>
                  <button className="btn btn-sm btn-circle btn-primary">▶</button>
                  <button className="btn btn-sm btn-circle btn-ghost">⏭</button>
                </div>
                <div>
                  <label className="text-xs text-base-content/70 mb-1 block">FPS: 12</label>
                  <input type="range" min="1" max="60" defaultValue="12" className="range range-xs range-primary" />
                </div>
              </div>

              {/* Frames */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3 flex items-center justify-between">
                  Frames (4)
                  <button className="btn btn-xs btn-ghost">+</button>
                </div>
                <div className="flex gap-1 overflow-x-auto pb-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={`w-12 h-12 flex-shrink-0 rounded border-2 flex items-center justify-center ${i === 2 ? 'border-primary' : 'border-base-300'}`}>
                      🧍
                    </div>
                  ))}
                </div>
              </div>

              {/* Properties */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3">Properties</div>
                <div className="space-y-2 text-sm">
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Name</label>
                    <input type="text" defaultValue="idle" className="input input-xs input-bordered w-full" />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="checkbox checkbox-xs" defaultChecked />
                    <span className="text-xs">Loop</span>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // Main content based on state
  const MainContent = () => {
    if (!selectedFile) {
      return <EmptyContent />;
    }
    if (viewMode === 'preview') {
      return <PreviewContent />;
    }
    return <EditorContent />;
  };

  return (
    <div className="h-full flex bg-base-300">
      <LeftSidebar />
      <MainContent />
      <RightSidebar />
    </div>
  );
}

export default function Images() {
  return (
    <SessionLayout>
      <ImagesContent />
    </SessionLayout>
  );
}
