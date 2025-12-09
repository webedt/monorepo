import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';
import { githubApi, sessionsApi, storageWorkerApi } from '@/lib/api';

// Editor mode for the left sidebar
type EditorMode = 'objects' | 'scenes';

// Asset file types
type AssetFileType = 'object' | 'scene' | 'model';

// File node structure for the tree
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  icon?: string;
  fileType?: AssetFileType;
}

interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
}

interface SceneSession {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  sessionId?: string;
}

interface PreSelectedSettings {
  repositoryUrl?: string;
  baseBranch?: string;
}

// File extensions for different asset types
const MODEL_EXTENSIONS = ['gltf', 'glb', 'obj', 'fbx', 'dae', 'stl', '3ds'];
const SCENE_PATTERNS = ['.scene.json', '.scene.yaml', '.scene.yml'];
const OBJECT_PATTERNS = ['.object.json', '.prefab.json', '.entity.json'];

// Helper to determine file type
const getAssetFileType = (filename: string): AssetFileType | null => {
  const lowerName = filename.toLowerCase();

  // Check for scene patterns first (more specific)
  if (SCENE_PATTERNS.some(pattern => lowerName.endsWith(pattern))) {
    return 'scene';
  }

  // Check for object patterns
  if (OBJECT_PATTERNS.some(pattern => lowerName.endsWith(pattern))) {
    return 'object';
  }

  // Check for model extensions
  const ext = lowerName.split('.').pop();
  if (ext && MODEL_EXTENSIONS.includes(ext)) {
    return 'model';
  }

  return null;
};

// Helper to get file icon based on type
const getFileIcon = (filename: string, fileType?: AssetFileType): string => {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (fileType === 'scene') return '🎬';
  if (fileType === 'object') return '📦';
  if (fileType === 'model') {
    // Different icons for different model formats
    const modelIcons: Record<string, string> = {
      gltf: '🎭',
      glb: '🎭',
      obj: '🗿',
      fbx: '🎮',
      dae: '🏛️',
      stl: '🔩',
      '3ds': '🎲',
    };
    return modelIcons[ext || ''] || '🧊';
  }

  return '📄';
};

// Helper to recursively remove empty folders from the tree
const removeEmptyFolders = (nodes: FileNode[]): FileNode[] => {
  return nodes
    .map(node => {
      if (node.type === 'folder' && node.children) {
        const cleanedChildren = removeEmptyFolders(node.children);
        return { ...node, children: cleanedChildren };
      }
      return node;
    })
    .filter(node => {
      if (node.type === 'file') return true;
      return node.children && node.children.length > 0;
    });
};

// Transform storage-worker files to filtered TreeNode format for scenes
const transformStorageFilesForScenes = (
  files: { path: string; size: number; type: 'file' | 'directory' }[],
  filterMode: EditorMode | 'all'
): FileNode[] => {
  const root: FileNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Filter to only include files under workspace/ and strip the prefix
  // Also filter out .git directories
  const workspaceFiles = files
    .filter(f => f.path.startsWith('workspace/'))
    .filter(f => {
      const pathWithoutPrefix = f.path.replace(/^workspace\//, '');
      const parts = pathWithoutPrefix.split('/');
      return !parts.some(part => part === '.git');
    })
    .map(f => ({
      ...f,
      path: f.path.replace(/^workspace\//, ''),
    }));

  // Sort items: directories first, then alphabetically
  const sortedItems = [...workspaceFiles].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.path.localeCompare(b.path);
  });

  // First pass: identify all files and their types
  const fileTypes = new Map<string, AssetFileType>();
  for (const item of sortedItems) {
    if (item.type === 'file') {
      const fileType = getAssetFileType(item.path.split('/').pop() || '');
      if (fileType) {
        fileTypes.set(item.path, fileType);
      }
    }
  }

  // Build the tree structure
  for (const item of sortedItems) {
    const pathParts = item.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const currentPath = pathParts.slice(0, i + 1).join('/');
      const isLastPart = i === pathParts.length - 1;

      if (isLastPart) {
        if (item.type === 'file') {
          const fileType = fileTypes.get(item.path);

          // Filter by mode - only include matching files
          if (!fileType) continue;
          if (filterMode !== 'all') {
            if (filterMode === 'objects' && fileType !== 'object' && fileType !== 'model') continue;
            if (filterMode === 'scenes' && fileType !== 'scene') continue;
          }

          currentLevel.children!.push({
            name: part,
            path: currentPath,
            type: 'file',
            icon: getFileIcon(part, fileType),
            fileType,
          });
        } else {
          const existing = currentLevel.children!.find(
            c => c.type === 'folder' && c.name === part
          );
          if (!existing) {
            currentLevel.children!.push({
              name: part,
              path: currentPath,
              type: 'folder',
              children: [],
            });
          }
        }
      } else {
        let folder = currentLevel.children!.find(
          c => c.type === 'folder' && c.name === part
        ) as FileNode | undefined;

        if (!folder) {
          folder = { name: part, path: currentPath, type: 'folder', children: [] };
          currentLevel.children!.push(folder);
        }

        currentLevel = folder;
      }
    }
  }

  return removeEmptyFolders(root.children || []);
};

// Props for split view support
interface SceneEditorContentProps {
  sessionId?: string;
  isEmbedded?: boolean;
}

export function SceneEditorContent({ sessionId: sessionIdProp, isEmbedded: _isEmbedded = false }: SceneEditorContentProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  const sessionId = sessionIdProp ?? sessionIdParam;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Get pre-selected settings from navigation state
  const preSelectedSettings = (location.state as { preSelectedSettings?: PreSelectedSettings } | null)?.preSelectedSettings;
  const hasInitializedFromPreSelected = useRef(false);

  // Scene session state
  const [sceneSession, setSceneSession] = useState<SceneSession | null>(null);
  const [_isInitializing, setIsInitializing] = useState(false);
  const [_initError, setInitError] = useState<string | null>(null);

  // Editor state
  const [editorMode, setEditorMode] = useState<EditorMode>('objects');
  const [showExplorer, setShowExplorer] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; fileType?: AssetFileType } | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<{ path: string; name: string } | null>(null);
  const [selectedObject, setSelectedObject] = useState<string | null>(null);

  // Fetch existing session if sessionId is provided
  const { data: existingSessionData, isLoading: isLoadingExistingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
  });

  // Set scene session from existing session data
  useEffect(() => {
    if (existingSessionData?.data) {
      const session = existingSessionData.data;
      if (session.repositoryOwner && session.repositoryName && session.branch) {
        setSceneSession({
          owner: session.repositoryOwner,
          repo: session.repositoryName,
          branch: session.branch,
          baseBranch: session.baseBranch || 'main',
          sessionId: session.id,
        });
      }
    }
  }, [existingSessionData]);

  // Fetch user's GitHub repos (only when no existing session)
  const { data: reposData, isLoading: _isLoadingRepos } = useQuery({
    queryKey: ['github-repos'],
    queryFn: githubApi.getRepos,
    enabled: !sessionId && !sceneSession,
  });

  const repos: GitHubRepo[] = reposData?.data || [];

  // Create branch mutation
  const createBranchMutation = useMutation({
    mutationFn: async ({ owner, repo, branchName, baseBranch }: {
      owner: string;
      repo: string;
      branchName: string;
      baseBranch: string;
    }) => {
      return githubApi.createBranch(owner, repo, { branchName, baseBranch });
    },
  });

  // Auto-initialize from pre-selected settings
  useEffect(() => {
    if (
      preSelectedSettings?.repositoryUrl &&
      repos.length > 0 &&
      !hasInitializedFromPreSelected.current &&
      !sceneSession &&
      !sessionId
    ) {
      hasInitializedFromPreSelected.current = true;
      const matchingRepo = repos.find(r => r.cloneUrl === preSelectedSettings.repositoryUrl);
      if (matchingRepo) {
        initializeSceneSession(matchingRepo, preSelectedSettings.baseBranch);
      }
    }
  }, [preSelectedSettings, repos, sceneSession, sessionId]);

  // Initialize Scene session when repo is selected
  const initializeSceneSession = async (repo: GitHubRepo, selectedBranch?: string) => {
    setIsInitializing(true);
    setInitError(null);

    const [owner, repoName] = repo.fullName.split('/');
    const baseBranch = selectedBranch || repo.defaultBranch;

    const randomId = Math.random().toString(36).substring(2, 10);
    const branchName = `webedt/scene-editor-${randomId}`;

    try {
      await createBranchMutation.mutateAsync({
        owner,
        repo: repoName,
        branchName,
        baseBranch,
      });

      const sessionResponse = await sessionsApi.createCodeSession({
        title: `Scenes: ${owner}/${repoName}`,
        repositoryUrl: repo.cloneUrl,
        repositoryOwner: owner,
        repositoryName: repoName,
        baseBranch,
        branch: branchName,
      });

      const dbSessionId = sessionResponse.data.sessionId;

      setSceneSession({
        owner,
        repo: repoName,
        branch: branchName,
        baseBranch,
        sessionId: dbSessionId,
      });

      navigate(`/session/${dbSessionId}/scene-editor`, { replace: true });
      setExpandedFolders(new Set());
    } catch (error: any) {
      console.error('Failed to create branch:', error);
      setInitError(error.message || 'Failed to create branch');
    } finally {
      setIsInitializing(false);
    }
  };

  // Fetch file tree from storage-worker
  const { data: treeData, isLoading: isLoadingTree, error: treeError } = useQuery({
    queryKey: ['scene-file-tree', sceneSession?.sessionId],
    queryFn: async () => {
      const storageSessionId = sceneSession!.sessionId;

      if (!storageSessionId) {
        throw new Error('No session ID available');
      }

      console.log('[SceneEditor] Fetching file tree from storage-worker:', storageSessionId);
      const files = await storageWorkerApi.listFiles(storageSessionId);

      if (files && files.length > 0) {
        return { source: 'storage', files };
      }

      console.log('[SceneEditor] Storage-worker returned empty file list');
      return { source: 'storage', files: [] };
    },
    enabled: !!sceneSession?.sessionId,
    retry: 1,
  });

  // Transform and filter the file tree based on editor mode
  const fileTree = useMemo(() => {
    if (!treeData) return [];
    if (treeData.source === 'storage' && treeData.files) {
      return transformStorageFilesForScenes(treeData.files, editorMode);
    }
    return [];
  }, [treeData, editorMode]);

  // Count files by type for display
  const fileCounts = useMemo(() => {
    if (!treeData) return { object: 0, scene: 0, model: 0 };

    const counts = { object: 0, scene: 0, model: 0 };

    if (treeData.source === 'storage' && treeData.files) {
      const workspaceFiles = treeData.files.filter(
        (f: { path: string; type: string }) => f.path.startsWith('workspace/') && f.type === 'file'
      );
      for (const item of workspaceFiles) {
        const fileName = item.path.split('/').pop() || '';
        const fileType = getAssetFileType(fileName);
        if (fileType) {
          counts[fileType]++;
        }
      }
    }

    return counts;
  }, [treeData]);

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
      setSelectedDirectory({ path: node.path, name: node.name });
      setSelectedFile(null);
      setSelectedObject(null);
    } else {
      setSelectedFile({ path: node.path, name: node.name, fileType: node.fileType });
      setSelectedDirectory(null);
      setSelectedObject(node.name);
    }
  };

  // Render file tree recursively
  const renderFileTree = (nodes: FileNode[], level = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const paddingLeft = level * 16 + 8;

      if (node.type === 'file') {
        const isSelected = selectedFile?.path === node.path;
        return (
          <div
            key={node.path}
            onClick={() => handleFileClick(node)}
            className={`group flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
              isSelected ? 'bg-base-300 text-primary' : ''
            }`}
            style={{ paddingLeft }}
            title={node.path}
          >
            <span className="text-sm flex-shrink-0">{node.icon}</span>
            <span className="text-sm truncate flex-1">{node.name}</span>
            {node.fileType && (
              <span className="text-xs text-base-content/40 group-hover:text-base-content/60">
                {node.fileType === 'scene' ? 'scene' : node.fileType === 'object' ? 'obj' : node.fileType === 'model' ? '3d' : ''}
              </span>
            )}
          </div>
        );
      }

      const isExpanded = expandedFolders.has(node.path);
      const isSelectedDir = selectedDirectory?.path === node.path;
      const fileCount = node.children?.filter(c => c.type === 'file').length || 0;
      const folderCount = node.children?.filter(c => c.type === 'folder').length || 0;

      return (
        <div key={node.path}>
          <div
            onClick={() => handleFileClick(node)}
            className={`group flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
              isSelectedDir ? 'bg-base-300 text-primary' : ''
            }`}
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
            <svg className={`w-4 h-4 flex-shrink-0 ${isSelectedDir ? 'text-primary' : 'text-yellow-500'}`} fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            <span className="text-sm font-medium truncate flex-1">{node.name}</span>
            {(fileCount > 0 || folderCount > 0) && (
              <span className="text-xs text-base-content/40">
                {fileCount > 0 && `${fileCount}`}
                {fileCount > 0 && folderCount > 0 && '/'}
                {folderCount > 0 && <span className="text-base-content/30">{folderCount}</span>}
              </span>
            )}
          </div>
          {isExpanded && node.children && node.children.length > 0 && renderFileTree(node.children, level + 1)}
        </div>
      );
    });
  };

  // Left Sidebar
  const LeftSidebar = () => (
    <div className="w-64 bg-base-100 border-r border-base-300 flex flex-col flex-shrink-0">
      {/* Header with Explorer title and refresh */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
        <span className="text-sm font-semibold uppercase tracking-wide">Scene Explorer</span>
        <div className="flex gap-1">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['scene-file-tree', sceneSession?.sessionId] })}
            className="p-1 hover:bg-base-200 rounded"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Editor Mode Tabs with counts */}
      <div className="p-2 border-b border-base-300">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setEditorMode('objects')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm ${
              editorMode === 'objects'
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-200'
            }`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9zM12 4.15L6.04 7.5 12 10.85l5.96-3.35L12 4.15zM5 15.91l6 3.38v-6.71L5 9.21v6.7zm14 0v-6.7l-6 3.37v6.71l6-3.38z"/>
            </svg>
            <span className="flex-1">Objects</span>
            <span className="badge badge-sm badge-ghost">{fileCounts.object + fileCounts.model}</span>
          </button>
          <button
            onClick={() => setEditorMode('scenes')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm ${
              editorMode === 'scenes'
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/70 hover:bg-base-200'
            }`}
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
            </svg>
            <span className="flex-1">Scenes</span>
            <span className="badge badge-sm badge-ghost">{fileCounts.scene}</span>
          </button>
        </div>
      </div>

      {/* File Explorer Toggle */}
      <div className="px-3 py-2 border-b border-base-300">
        <button
          onClick={() => setShowExplorer(!showExplorer)}
          className="w-full flex items-center gap-2 text-sm text-base-content/70 hover:text-base-content transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${showExplorer ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">Files</span>
          <span className="text-xs text-base-content/40 ml-auto">
            {fileTree.length > 0 ? `${fileTree.reduce((acc, node) => acc + (node.type === 'folder' ? (node.children?.length || 0) : 1), 0)} items` : ''}
          </span>
        </button>
      </div>

      {/* File Explorer (collapsible) */}
      {showExplorer && (
        <div className="flex-1 overflow-y-auto">
          <div className="py-2">
            {isLoadingTree ? (
              <div className="flex items-center justify-center py-8">
                <span className="loading loading-spinner loading-sm"></span>
              </div>
            ) : treeError ? (
              <div className="px-3 py-4 text-sm text-center">
                <div className="text-error mb-2">⚠️ Failed to load files</div>
                <div className="text-base-content/70 text-xs">
                  {(treeError as Error).message?.toLowerCase().includes('session not found') || (treeError as Error).message?.includes('session_not_found')
                    ? 'Session not found in storage. The AI may still be processing files.'
                    : (treeError as Error).message || 'Unknown error'}
                </div>
              </div>
            ) : fileTree.length > 0 ? (
              renderFileTree(fileTree)
            ) : (
              <div className="px-3 py-4 text-sm text-base-content/70 text-center">
                <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9z"/>
                </svg>
                <p>No {editorMode === 'objects' ? 'objects' : 'scenes'} found</p>
                <p className="text-xs mt-1">
                  {editorMode === 'objects'
                    ? 'Looking for: .object.json, .gltf, .glb, .obj, .fbx'
                    : 'Looking for: .scene.json, .scene.yaml'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Button - at bottom */}
      <div className="p-3 border-t border-base-300 mt-auto">
        <button className="btn btn-sm btn-primary w-full gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          New {editorMode === 'objects' ? 'Object' : 'Scene'}
        </button>
      </div>
    </div>
  );

  const tools = [
    { id: 'select', icon: '⤢', label: 'Select' },
    { id: 'move', icon: '✋', label: 'Move' },
    { id: 'zoom', icon: '🔍', label: 'Zoom' },
    { id: 'rotate', icon: '⟲', label: 'Rotate' },
    { id: 'grid', icon: '⊞', label: 'Grid' },
    { id: 'more', icon: '⋮', label: 'More' },
  ];

  // Loading existing session
  if (sessionId && isLoadingExistingSession) {
    return (
      <div className="h-full flex items-center justify-center bg-base-200">
        <div className="text-center">
          <span className="loading loading-spinner loading-lg"></span>
          <p className="mt-4 text-base-content/70">Loading session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-base-300">
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Explorer */}
        <LeftSidebar />

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
                        <span className="text-4xl">{selectedFile?.fileType === 'scene' ? '🎬' : selectedFile?.fileType === 'object' ? '📦' : '🧊'}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-base-content/60">
                  {selectedFile ? `Selected: ${selectedFile.name}` : '3D Viewport - Coming Soon'}
                </p>
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
            <h2 className="text-sm font-semibold text-base-content">{selectedObject || 'No Selection'} Properties</h2>
          </div>

          {selectedFile ? (
            <>
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
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center text-base-content/50">
                <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 16.5c0 .38-.21.71-.53.88l-7.9 4.44c-.16.12-.36.18-.57.18-.21 0-.41-.06-.57-.18l-7.9-4.44A.991.991 0 013 16.5v-9c0-.38.21-.71.53-.88l7.9-4.44c.16-.12.36-.18.57-.18.21 0 .41.06.57.18l7.9 4.44c.32.17.53.5.53.88v9z"/>
                </svg>
                <p className="text-sm">Select an object or scene to view properties</p>
              </div>
            </div>
          )}
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
      <SceneEditorContent isEmbedded={isEmbedded} />
    </Wrapper>
  );
}
