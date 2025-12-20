import { useState, useCallback } from 'react';
import type { Scene, SceneObject, SelectionState } from '@/types/scene';

interface SceneHierarchyProps {
  scene: Scene;
  selection: SelectionState;
  onSelectObject: (id: string, addToSelection?: boolean) => void;
  onSetParent: (objectId: string, parentId: string | null) => void;
  onRemoveObject: (id: string) => void;
  onDuplicateObject: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<SceneObject>) => void;
}

interface TreeNodeProps {
  object: SceneObject;
  scene: Scene;
  level: number;
  isSelected: boolean;
  isHovered: boolean;
  expandedNodes: Set<string>;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string, addToSelection?: boolean) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleLock: (id: string) => void;
}

function TreeNode({
  object,
  scene,
  level,
  isSelected,
  isHovered,
  expandedNodes,
  onToggleExpand,
  onSelect,
  onContextMenu,
  onToggleVisibility,
  onToggleLock,
}: TreeNodeProps) {
  const hasChildren = object.children.length > 0;
  const isExpanded = expandedNodes.has(object.id);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'sprite':
        return '🖼️';
      case 'shape':
        return '⬜';
      case 'text':
        return '📝';
      case 'group':
        return '📁';
      case 'empty':
        return '◯';
      default:
        return '📦';
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-base-300 ${
          isSelected ? 'bg-primary/20 text-primary' : ''
        } ${isHovered ? 'bg-base-300' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={(e) => onSelect(object.id, e.shiftKey)}
        onContextMenu={(e) => onContextMenu(e, object.id)}
      >
        {/* Expand/Collapse arrow */}
        <button
          className={`w-4 h-4 flex items-center justify-center transition-transform ${
            isExpanded ? 'rotate-90' : ''
          } ${!hasChildren ? 'opacity-0 pointer-events-none' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(object.id);
          }}
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Type icon */}
        <span className="text-sm">{getTypeIcon(object.type)}</span>

        {/* Name */}
        <span className="flex-1 truncate text-sm">{object.name}</span>

        {/* Visibility toggle */}
        <button
          className={`w-5 h-5 flex items-center justify-center hover:bg-base-content/10 rounded ${
            !object.visible ? 'text-base-content/30' : ''
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(object.id);
          }}
          title={object.visible ? 'Hide' : 'Show'}
        >
          {object.visible ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          )}
        </button>

        {/* Lock toggle */}
        <button
          className={`w-5 h-5 flex items-center justify-center hover:bg-base-content/10 rounded ${
            object.locked ? 'text-warning' : 'text-base-content/30'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(object.id);
          }}
          title={object.locked ? 'Unlock' : 'Lock'}
        >
          {object.locked ? (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {object.children.map((childId) => {
            const child = scene.objects[childId];
            if (!child) return null;
            return (
              <TreeNode
                key={childId}
                object={child}
                scene={scene}
                level={level + 1}
                isSelected={false} // Will be passed from parent
                isHovered={false}
                expandedNodes={expandedNodes}
                onToggleExpand={onToggleExpand}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onToggleVisibility={onToggleVisibility}
                onToggleLock={onToggleLock}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SceneHierarchy({
  scene,
  selection,
  onSelectObject,
  onSetParent,
  onRemoveObject,
  onDuplicateObject,
  onUpdateObject,
}: SceneHierarchyProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objectId: string } | null>(null);

  const toggleExpand = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, objectId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, objectId });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleToggleVisibility = useCallback((id: string) => {
    const obj = scene.objects[id];
    if (obj) {
      onUpdateObject(id, { visible: !obj.visible });
    }
  }, [scene.objects, onUpdateObject]);

  const handleToggleLock = useCallback((id: string) => {
    const obj = scene.objects[id];
    if (obj) {
      onUpdateObject(id, { locked: !obj.locked });
    }
  }, [scene.objects, onUpdateObject]);

  // Get root objects sorted by z-index
  const rootObjects = scene.rootObjects
    .map((id) => scene.objects[id])
    .filter((obj): obj is SceneObject => obj !== undefined)
    .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  return (
    <div className="flex flex-col h-full" onClick={closeContextMenu}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
        <span className="text-sm font-semibold uppercase tracking-wide">Hierarchy</span>
        <span className="text-xs text-base-content/50">{Object.keys(scene.objects).length} objects</span>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {rootObjects.length === 0 ? (
          <div className="px-4 py-8 text-center text-base-content/50">
            <p className="text-sm">No objects in scene</p>
            <p className="text-xs mt-1">Use the toolbar to add objects</p>
          </div>
        ) : (
          rootObjects.map((obj) => (
            <TreeNode
              key={obj.id}
              object={obj}
              scene={scene}
              level={0}
              isSelected={selection.selectedIds.includes(obj.id)}
              isHovered={selection.hoveredId === obj.id}
              expandedNodes={expandedNodes}
              onToggleExpand={toggleExpand}
              onSelect={onSelectObject}
              onContextMenu={handleContextMenu}
              onToggleVisibility={handleToggleVisibility}
              onToggleLock={handleToggleLock}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-base-100 border border-base-300 rounded-lg shadow-xl py-1 min-w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
            onClick={() => {
              onDuplicateObject(contextMenu.objectId);
              closeContextMenu();
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Duplicate
          </button>
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 flex items-center gap-2"
            onClick={() => {
              const obj = scene.objects[contextMenu.objectId];
              if (obj?.parentId) {
                onSetParent(contextMenu.objectId, null);
              }
              closeContextMenu();
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
            Move to Root
          </button>
          <div className="border-t border-base-300 my-1" />
          <button
            className="w-full px-4 py-2 text-left text-sm hover:bg-base-200 text-error flex items-center gap-2"
            onClick={() => {
              onRemoveObject(contextMenu.objectId);
              closeContextMenu();
            }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
