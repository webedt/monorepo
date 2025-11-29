import { useState, useRef } from 'react';
import SessionLayout from '@/components/SessionLayout';

type EditorMode = 'image' | 'spritesheet' | 'animation';

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
  const [showExplorer, setShowExplorer] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['sprites']));
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string } | null>(null);
  const [previewFile, setPreviewFile] = useState<{ path: string; name: string } | null>(null);
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
      setPreviewFile({ path: node.path, name: node.name });
    }
  };

  const handleOpenFile = () => {
    if (previewFile) {
      setSelectedFile(previewFile);
      setShowExplorer(false);
      setPreviewFile(null);
    }
  };

  const handleBack = () => {
    if (previewFile) {
      setPreviewFile(null);
    } else {
      setShowExplorer(false);
    }
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
      const paddingLeft = level * 16 + 12;
      const isExpanded = expandedFolders.has(node.path);
      const isSelected = previewFile?.path === node.path;

      if (node.type === 'folder') {
        return (
          <div key={node.path}>
            <div
              onClick={() => handleFileClick(node)}
              className="flex items-center gap-2 py-1.5 px-2 cursor-pointer hover:bg-base-300 transition-colors"
              style={{ paddingLeft }}
            >
              <svg
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
              <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              <span className="text-sm font-medium">{node.name}</span>
            </div>
            {isExpanded && node.children && renderFileTree(node.children, level + 1)}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          onClick={() => handleFileClick(node)}
          className={`flex items-center gap-2 py-1.5 px-2 cursor-pointer transition-colors ${
            isSelected ? 'bg-primary/20 text-primary' : 'hover:bg-base-300'
          }`}
          style={{ paddingLeft }}
        >
          <span className="text-sm">{node.icon || '📄'}</span>
          <span className="text-sm truncate">{node.name}</span>
        </div>
      );
    });
  };

  // File Explorer View
  const FileExplorerView = () => (
    <div className="h-full flex bg-base-200">
      {/* File Tree */}
      <div className="w-72 bg-base-100 border-r border-base-300 flex flex-col">
        {/* Header with back button */}
        <div className="px-4 py-3 border-b border-base-300 flex items-center gap-3">
          <button
            onClick={handleBack}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <span className="font-semibold">Browse Files</span>
        </div>

        {/* File Tree */}
        <div className="flex-1 overflow-y-auto py-2">
          {renderFileTree(mockFileTree)}
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 flex flex-col">
        {previewFile ? (
          <>
            {/* Preview Header */}
            <div className="bg-base-100 border-b border-base-300 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🖼️</span>
                <span className="font-medium">{previewFile.name}</span>
              </div>
              <button
                onClick={handleOpenFile}
                className="btn btn-primary btn-sm gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                </svg>
                Open
              </button>
            </div>

            {/* Preview Content */}
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="bg-white rounded-lg shadow-lg p-8 max-w-lg">
                {/* Checkerboard background */}
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
                <div className="mt-4 text-center">
                  <div className="font-medium">{previewFile.name}</div>
                  <div className="text-sm text-base-content/60 mt-1">256 x 256 px</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-base-content/50">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              <p>Select a file to preview</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // Recent Items Grid
  const RecentItemsGrid = ({ items, title }: { items: RecentItem[]; title: string }) => (
    <div className="mb-8">
      <h3 className="text-lg font-semibold mb-4 text-base-content">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
        {items.map((item) => (
          <div
            key={item.id}
            onClick={() => setSelectedFile({ path: item.id, name: item.name })}
            className="group cursor-pointer"
          >
            <div
              className="aspect-square rounded-lg border-2 border-base-300 bg-base-200 flex items-center justify-center text-4xl group-hover:border-primary group-hover:bg-primary/5 transition-all"
              style={{
                backgroundImage: 'linear-gradient(45deg, #f3f4f6 25%, transparent 25%), linear-gradient(-45deg, #f3f4f6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f3f4f6 75%), linear-gradient(-45deg, transparent 75%, #f3f4f6 75%)',
                backgroundSize: '8px 8px',
                backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
              }}
            >
              {item.thumbnail}
            </div>
            <div className="mt-2">
              <div className="text-sm font-medium truncate">{item.name}</div>
              <div className="text-xs text-base-content/50">{item.lastModified}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Dashboard View (when no file is selected and explorer is closed)
  const DashboardView = () => (
    <div className="h-full flex flex-col bg-base-200">
      {/* Header */}
      <div className="bg-base-100 border-b border-base-300 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
              </div>
              <div>
                <div className="font-semibold text-base-content">Project Alpha</div>
                <div className="text-xs text-base-content/60">Images & Animations</div>
              </div>
            </div>
          </div>

          {/* Browse Button */}
          <button
            onClick={() => setShowExplorer(true)}
            className="btn btn-outline btn-sm gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            Browse
          </button>
        </div>

        {/* Editor Mode Tabs */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setEditorMode('image')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              editorMode === 'image'
                ? 'bg-primary text-primary-content'
                : 'bg-base-200 text-base-content/70 hover:bg-base-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
              ImageEDT
            </span>
          </button>
          <button
            onClick={() => setEditorMode('spritesheet')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              editorMode === 'spritesheet'
                ? 'bg-primary text-primary-content'
                : 'bg-base-200 text-base-content/70 hover:bg-base-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3v8h8V3H3zm6 6H5V5h4v4zm-6 4v8h8v-8H3zm6 6H5v-4h4v4zm4-16v8h8V3h-8zm6 6h-4V5h4v4zm-6 4v8h8v-8h-8zm6 6h-4v-4h4v4z"/>
              </svg>
              SpriteSheetEDT
            </span>
          </button>
          <button
            onClick={() => setEditorMode('animation')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              editorMode === 'animation'
                ? 'bg-primary text-primary-content'
                : 'bg-base-200 text-base-content/70 hover:bg-base-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
              AnimationEDT
            </span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <RecentItemsGrid
          items={getRecentItems()}
          title={`Recent ${editorMode === 'image' ? 'Images' : editorMode === 'spritesheet' ? 'Sprite Sheets' : 'Animations'}`}
        />

        {/* Quick Actions */}
        <div className="mt-8">
          <h3 className="text-lg font-semibold mb-4 text-base-content">Quick Actions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button className="p-4 bg-base-100 rounded-lg border border-base-300 hover:border-primary hover:bg-primary/5 transition-all text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-success/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-success" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                </div>
                <div>
                  <div className="font-medium">New {editorMode === 'image' ? 'Image' : editorMode === 'spritesheet' ? 'Sprite Sheet' : 'Animation'}</div>
                  <div className="text-xs text-base-content/60">Create from scratch</div>
                </div>
              </div>
            </button>
            <button className="p-4 bg-base-100 rounded-lg border border-base-300 hover:border-primary hover:bg-primary/5 transition-all text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-info/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-info" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/>
                  </svg>
                </div>
                <div>
                  <div className="font-medium">Import</div>
                  <div className="text-xs text-base-content/60">Upload from computer</div>
                </div>
              </div>
            </button>
            <button className="p-4 bg-base-100 rounded-lg border border-base-300 hover:border-primary hover:bg-primary/5 transition-all text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-warning/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-warning" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
                  </svg>
                </div>
                <div>
                  <div className="font-medium">AI Generate</div>
                  <div className="text-xs text-base-content/60">Create with AI prompt</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // Full Image Editor View
  const ImageEditorView = () => (
    <div className="h-full flex flex-col bg-base-200">
      {/* Toolbar */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setSelectedFile(null)}
          className="btn btn-ghost btn-sm btn-circle"
          title="Back"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
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

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas Area */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="relative">
            {/* Pixel Grid Canvas Mock */}
            <div className="bg-white rounded shadow-lg p-4">
              {/* Mock character sprite using CSS */}
              <div className="relative" style={{ width: '384px', height: '384px' }}>
                {/* Checkerboard pattern background */}
                <div className="absolute inset-0" style={{
                  backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
                }}></div>

                {/* Mock pixel art character */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-9xl">👤</div>
                </div>

                {/* Grid overlay */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  backgroundImage: 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }}></div>
              </div>
            </div>

            {/* Zoom indicator */}
            <div className="absolute bottom-2 right-2 bg-base-100 px-3 py-1 rounded-lg shadow text-sm text-base-content/70 flex items-center gap-2">
              <button className="btn btn-xs btn-ghost btn-circle">-</button>
              <span>100%</span>
              <button className="btn btn-xs btn-ghost btn-circle">+</button>
            </div>
          </div>
        </div>

        {/* Right Sidebar - Tools & Layers */}
        <div className="w-72 bg-base-100 border-l border-base-300 overflow-y-auto flex-shrink-0">
          <div className="p-4 space-y-4">
            {/* Color Palette */}
            <div>
              <div className="font-semibold text-base-content mb-3 flex items-center justify-between">
                Colors
                <button className="btn btn-xs btn-ghost">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded border-2 border-base-content bg-black"></div>
                <div className="w-10 h-10 rounded border border-base-300 bg-white"></div>
                <button className="btn btn-xs btn-ghost ml-auto">Swap</button>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                  '#880000', '#008800', '#000088', '#888800', '#880088', '#008888', '#888888', '#444444',
                  '#FF8800', '#88FF00', '#0088FF', '#FF0088', '#8800FF', '#00FF88', '#FFCCCC', '#CCFFCC'].map((color) => (
                  <button
                    key={color}
                    className="w-6 h-6 rounded border border-base-300 hover:scale-110 transition-transform"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>

            {/* Brush Settings */}
            <div className="pt-4 border-t border-base-300">
              <div className="font-semibold text-base-content mb-3">Brush</div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-base-content/70 mb-1 block">Size</label>
                  <input type="range" min="1" max="32" defaultValue="4" className="range range-xs range-primary" />
                </div>
                <div>
                  <label className="text-xs text-base-content/70 mb-1 block">Opacity</label>
                  <input type="range" min="0" max="100" defaultValue="100" className="range range-xs range-primary" />
                </div>
              </div>
            </div>

            {/* Layers */}
            <div className="pt-4 border-t border-base-300">
              <div className="font-semibold text-base-content mb-3 flex items-center justify-between">
                Layers
                <button className="btn btn-xs btn-ghost">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                </button>
              </div>
              <div className="space-y-1">
                {['Layer 3 (outline)', 'Layer 2 (character)', 'Layer 1 (background)'].map((layer, i) => (
                  <div
                    key={layer}
                    className={`flex items-center gap-2 p-2 rounded ${i === 1 ? 'bg-primary/10 border border-primary/30' : 'bg-base-200'}`}
                  >
                    <button className="btn btn-xs btn-ghost btn-circle">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                      </svg>
                    </button>
                    <span className="text-sm flex-1 truncate">{layer}</span>
                    <span className="text-xs text-base-content/50">100%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* History */}
            <div className="pt-4 border-t border-base-300">
              <div className="font-semibold text-base-content mb-3">History</div>
              <div className="space-y-1 text-sm">
                {['Pencil stroke', 'Fill area', 'Move layer', 'New layer', 'Open file'].map((action, i) => (
                  <div
                    key={i}
                    className={`px-2 py-1 rounded ${i === 0 ? 'bg-primary/10 text-primary' : 'text-base-content/70 hover:bg-base-200'} cursor-pointer`}
                  >
                    {action}
                  </div>
                ))}
              </div>
            </div>
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
              placeholder="Describe changes or generate new elements... (e.g., 'Add a glowing effect', 'Change color to blue', 'Create a pixel art sword')"
              rows={2}
              className="textarea textarea-bordered w-full pr-24 resize-none"
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
                Gemini Flash 2.5
              </div>
              <button
                type="submit"
                disabled={!aiPrompt.trim() || isGenerating}
                className={`btn btn-circle btn-sm ${isGenerating ? 'btn-warning' : 'btn-primary'}`}
                title={isGenerating ? 'Generating...' : 'Generate'}
              >
                {isGenerating ? (
                  <span className="loading loading-spinner loading-xs"></span>
                ) : (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-base-content/50">
            <span className="flex items-center gap-1">
              <kbd className="kbd kbd-xs">Enter</kbd> to send
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd kbd-xs">Shift</kbd>+<kbd className="kbd kbd-xs">Enter</kbd> new line
            </span>
          </div>
        </form>
      </div>
    </div>
  );

  // Determine which view to show
  const renderContent = () => {
    if (showExplorer) {
      return <FileExplorerView />;
    }
    if (selectedFile) {
      return <ImageEditorView />;
    }
    return <DashboardView />;
  };

  return (
    <div className="h-full">
      {renderContent()}
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
