import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { githubApi, sessionsApi, storageWorkerApi } from '@/lib/api';
import {
  useNewImagePreferencesStore,
  RESOLUTION_PRESETS,
  type AspectRatioTab,
  type ImageExtension,
} from '@/lib/store';

type EditorMode = 'image' | 'spritesheet' | 'animation';
type ViewMode = 'preview' | 'edit';

// File types for filtering
type ImageFileType = 'image' | 'spritesheet' | 'animation';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  icon?: string;
  fileType?: ImageFileType; // For files: what kind of image asset
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
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

interface ImageSession {
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
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
const SPRITESHEET_PATTERNS = ['.spritesheet.json', '.atlas.json', '-atlas.json', '_atlas.json'];
const ANIMATION_PATTERNS = ['.animation.json', '.anim.json', '-anim.json', '_anim.json'];

// Helper to determine file type
const getImageFileType = (filename: string): ImageFileType | null => {
  const lowerName = filename.toLowerCase();

  // Check for spritesheet patterns first (more specific)
  if (SPRITESHEET_PATTERNS.some(pattern => lowerName.endsWith(pattern))) {
    return 'spritesheet';
  }

  // Check for animation patterns
  if (ANIMATION_PATTERNS.some(pattern => lowerName.endsWith(pattern))) {
    return 'animation';
  }

  // Check for image extensions
  const ext = lowerName.split('.').pop();
  if (ext && IMAGE_EXTENSIONS.includes(ext)) {
    return 'image';
  }

  return null;
};

// Helper to get file icon based on type
const getFileIcon = (filename: string, fileType?: ImageFileType): string => {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (fileType === 'spritesheet') return '🎞️';
  if (fileType === 'animation') return '🎬';

  // Image icons based on extension
  const iconMap: Record<string, string> = {
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🎭',
    webp: '🖼️',
    svg: '📐',
    ico: '🔲',
    bmp: '🖼️',
  };

  return iconMap[ext || ''] || '🖼️';
};

// Transform GitHub tree to our filtered TreeNode format
// Now includes ALL directories, not just those with images
const transformGitHubTreeForImages = (
  items: GitHubTreeItem[],
  filterMode: EditorMode | 'all'
): FileNode[] => {
  const root: FileNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Sort items: directories first, then alphabetically
  const sortedItems = [...items].sort((a, b) => {
    if (a.type === 'tree' && b.type !== 'tree') return -1;
    if (a.type !== 'tree' && b.type === 'tree') return 1;
    return a.path.localeCompare(b.path);
  });

  // First pass: identify all files and their types
  const fileTypes = new Map<string, ImageFileType>();
  for (const item of sortedItems) {
    if (item.type === 'blob') {
      const fileType = getImageFileType(item.path.split('/').pop() || '');
      if (fileType) {
        fileTypes.set(item.path, fileType);
      }
    }
  }

  // Collect all directory paths
  const allDirectories = new Set<string>();
  for (const item of sortedItems) {
    if (item.type === 'tree') {
      allDirectories.add(item.path);
    }
  }

  // Build the tree structure - include ALL directories
  for (const item of sortedItems) {
    const pathParts = item.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const currentPath = pathParts.slice(0, i + 1).join('/');
      const isLastPart = i === pathParts.length - 1;

      if (isLastPart) {
        if (item.type === 'blob') {
          const fileType = fileTypes.get(item.path);

          // Filter by mode - only include matching image files
          if (!fileType) continue;
          if (filterMode !== 'all') {
            if (filterMode === 'image' && fileType !== 'image') continue;
            if (filterMode === 'spritesheet' && fileType !== 'spritesheet') continue;
            if (filterMode === 'animation' && fileType !== 'animation') continue;
          }

          currentLevel.children!.push({
            name: part,
            path: currentPath,
            type: 'file',
            icon: getFileIcon(part, fileType),
            fileType,
          });
        } else {
          // Directory - always add all directories
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
        // Navigate to or create intermediate folder
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

  return root.children || [];
};

function ImagesContent() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Get pre-selected settings from navigation state (from QuickSessionSetup)
  const preSelectedSettings = (location.state as { preSelectedSettings?: PreSelectedSettings } | null)?.preSelectedSettings;
  const hasInitializedFromPreSelected = useRef(false);

  // Image session state (similar to Code's codeSession)
  const [imageSession, setImageSession] = useState<ImageSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // Editor state
  const [editorMode, setEditorMode] = useState<EditorMode>('image');
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [showExplorer, setShowExplorer] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<{ path: string; name: string; fileType?: ImageFileType } | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<{ path: string; name: string } | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // New Image Modal state
  const [showNewImageModal, setShowNewImageModal] = useState(false);
  const [newImageFilename, setNewImageFilename] = useState('image.png');
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const [isCreatingImage, setIsCreatingImage] = useState(false);
  const resolutionPickerRef = useRef<HTMLDivElement>(null);

  // Get preferences from store
  const imagePrefs = useNewImagePreferencesStore();

  // Fetch existing session if sessionId is provided
  const { data: existingSessionData, isLoading: isLoadingExistingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
  });

  // Set image session from existing session data
  useEffect(() => {
    if (existingSessionData?.data) {
      const session = existingSessionData.data;
      // Only set if we have the required fields
      if (session.repositoryOwner && session.repositoryName && session.branch) {
        setImageSession({
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
  const { data: reposData, isLoading: isLoadingRepos, error: reposError } = useQuery({
    queryKey: ['github-repos'],
    queryFn: githubApi.getRepos,
    enabled: !sessionId && !imageSession, // Only fetch repos if not viewing an existing session
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

  // Auto-initialize from pre-selected settings (from QuickSessionSetup)
  useEffect(() => {
    if (
      preSelectedSettings?.repositoryUrl &&
      repos.length > 0 &&
      !hasInitializedFromPreSelected.current &&
      !imageSession &&
      !sessionId
    ) {
      hasInitializedFromPreSelected.current = true;
      const matchingRepo = repos.find(r => r.cloneUrl === preSelectedSettings.repositoryUrl);
      if (matchingRepo) {
        initializeImageSession(matchingRepo, preSelectedSettings.baseBranch);
      }
    }
  }, [preSelectedSettings, repos, imageSession, sessionId]);

  // Initialize Image session when repo is selected
  const initializeImageSession = async (repo: GitHubRepo, selectedBranch?: string) => {
    setIsInitializing(true);
    setInitError(null);

    const [owner, repoName] = repo.fullName.split('/');
    const baseBranch = selectedBranch || repo.defaultBranch;

    // Generate random ID for branch
    const randomId = Math.random().toString(36).substring(2, 10);
    const branchName = `webedt/started-from-images-${randomId}`;

    try {
      // Create the GitHub branch
      await createBranchMutation.mutateAsync({
        owner,
        repo: repoName,
        branchName,
        baseBranch,
      });

      // Create the database session for tracking
      const sessionResponse = await sessionsApi.createCodeSession({
        title: `Images: ${owner}/${repoName}`,
        repositoryUrl: repo.cloneUrl,
        repositoryOwner: owner,
        repositoryName: repoName,
        baseBranch,
        branch: branchName,
      });

      const dbSessionId = sessionResponse.data.sessionId;

      setImageSession({
        owner,
        repo: repoName,
        branch: branchName,
        baseBranch,
        sessionId: dbSessionId,
      });

      // Navigate to the session URL
      navigate(`/session/${dbSessionId}/images`, { replace: true });

      // Expand root folders by default
      setExpandedFolders(new Set());
    } catch (error: any) {
      console.error('Failed to create branch:', error);
      setInitError(error.message || 'Failed to create branch');
    } finally {
      setIsInitializing(false);
    }
  };

  // Fetch file tree from GitHub when imageSession is active
  const { data: treeData, isLoading: isLoadingTree } = useQuery({
    queryKey: ['github-tree', imageSession?.owner, imageSession?.repo, imageSession?.branch],
    queryFn: () => githubApi.getTree(
      imageSession!.owner,
      imageSession!.repo,
      imageSession!.branch
    ),
    enabled: !!imageSession,
  });

  // Transform and filter the file tree based on editor mode
  const fileTree = useMemo(() => {
    if (!treeData?.data?.tree) return [];
    return transformGitHubTreeForImages(treeData.data.tree, editorMode);
  }, [treeData, editorMode]);

  // Count files by type for display
  const fileCounts = useMemo(() => {
    if (!treeData?.data?.tree) return { image: 0, spritesheet: 0, animation: 0 };

    const counts = { image: 0, spritesheet: 0, animation: 0 };
    for (const item of treeData.data.tree) {
      if (item.type === 'blob') {
        const fileType = getImageFileType(item.path.split('/').pop() || '');
        if (fileType) {
          counts[fileType]++;
        }
      }
    }
    return counts;
  }, [treeData]);

  // Load image when a file is selected
  // Uses storage-worker to fetch files directly from the session tarball
  const loadImage = useCallback(async (path: string) => {
    if (!imageSession) return;

    setIsLoadingImage(true);
    setImageUrl(null);

    try {
      // Build the session path: owner/repo/branch
      const sessionPath = `${imageSession.owner}/${imageSession.repo}/${imageSession.branch}`;

      // Get the raw file URL from storage-worker
      const fileUrl = storageWorkerApi.getFileUrl(sessionPath, path);
      setImageUrl(fileUrl);
    } catch (error) {
      console.error('Failed to load image:', error);
    } finally {
      setIsLoadingImage(false);
    }
  }, [imageSession]);

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
      // Select the directory for preview
      setSelectedDirectory({ path: node.path, name: node.name });
      setSelectedFile(null);
      setImageUrl(null);
      setViewMode('preview');
    } else {
      setSelectedFile({ path: node.path, name: node.name, fileType: node.fileType });
      setSelectedDirectory(null);
      setViewMode('preview');

      // Load the image if it's an image file
      if (node.fileType === 'image') {
        // Set loading state immediately to avoid flash of placeholder
        setIsLoadingImage(true);
        setImageUrl(null);
        loadImage(node.path);
      } else {
        setImageUrl(null);
      }
    }
  };

  // Helper to count files in a directory
  const countFilesInDirectory = useCallback((dirPath: string): { images: number; spritesheets: number; animations: number; folders: number } => {
    const counts = { images: 0, spritesheets: 0, animations: 0, folders: 0 };
    if (!treeData?.data?.tree) return counts;

    for (const item of treeData.data.tree) {
      // Check if item is directly inside this directory
      if (item.path.startsWith(dirPath + '/')) {
        const relativePath = item.path.slice(dirPath.length + 1);
        // Only count direct children (no more slashes in relative path)
        if (!relativePath.includes('/')) {
          if (item.type === 'tree') {
            counts.folders++;
          } else if (item.type === 'blob') {
            const fileType = getImageFileType(item.path.split('/').pop() || '');
            if (fileType === 'image') counts.images++;
            else if (fileType === 'spritesheet') counts.spritesheets++;
            else if (fileType === 'animation') counts.animations++;
          }
        }
      }
    }
    return counts;
  }, [treeData]);

  // Generate unique filename for new image
  const generateNewImageFilename = useCallback((basePath: string, extension: string): string => {
    if (!treeData?.data?.tree) return `image.${extension}`;

    const existingFiles = new Set<string>();
    const prefix = basePath ? `${basePath}/` : '';

    for (const item of treeData.data.tree) {
      if (item.type === 'blob' && item.path.startsWith(prefix)) {
        const relativePath = item.path.slice(prefix.length);
        if (!relativePath.includes('/')) {
          existingFiles.add(relativePath.toLowerCase());
        }
      }
    }

    // Try image.ext first
    if (!existingFiles.has(`image.${extension}`)) {
      return `image.${extension}`;
    }

    // Try image-1.ext, image-2.ext, etc.
    let counter = 1;
    while (existingFiles.has(`image-${counter}.${extension}`)) {
      counter++;
    }
    return `image-${counter}.${extension}`;
  }, [treeData]);

  // Open new image modal
  const openNewImageModal = useCallback((targetPath?: string) => {
    const basePath = targetPath || selectedDirectory?.path || '';
    const filename = generateNewImageFilename(basePath, imagePrefs.extension);
    setNewImageFilename(filename);
    setShowNewImageModal(true);
  }, [selectedDirectory, imagePrefs.extension, generateNewImageFilename]);

  // Handle creating new image
  const handleCreateNewImage = useCallback(async () => {
    if (!imageSession || !newImageFilename || isCreatingImage) return;

    setIsCreatingImage(true);

    const basePath = selectedDirectory?.path || '';
    const fullPath = basePath ? `${basePath}/${newImageFilename}` : newImageFilename;

    // Create a blank canvas with the specified dimensions
    const canvas = document.createElement('canvas');
    canvas.width = imagePrefs.width;
    canvas.height = imagePrefs.height;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Fill with transparent (for PNG) or white (for other formats)
      const ext = newImageFilename.split('.').pop()?.toLowerCase();
      if (ext === 'png' || ext === 'gif' || ext === 'webp') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    // Convert to base64
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    const ext = newImageFilename.split('.').pop()?.toLowerCase() || 'png';
    const mimeType = mimeTypes[ext] || 'image/png';

    // Get base64 data (remove the data:image/xxx;base64, prefix)
    const dataUrl = canvas.toDataURL(mimeType);
    const base64Content = dataUrl.split(',')[1];

    try {
      // Create file in GitHub
      await githubApi.updateFile(
        imageSession.owner,
        imageSession.repo,
        fullPath,
        {
          content: base64Content,
          branch: imageSession.branch,
          message: `Create new image: ${newImageFilename}`,
        }
      );

      // Close modal
      setShowNewImageModal(false);

      // Refresh the file tree
      await queryClient.invalidateQueries({ queryKey: ['github-tree'] });

      // Select the new file
      setSelectedFile({
        path: fullPath,
        name: newImageFilename,
        fileType: 'image',
      });
      setSelectedDirectory(null);

      // Expand parent folders to show the new file
      if (basePath) {
        const pathParts = basePath.split('/');
        const newExpanded = new Set(expandedFolders);
        for (let i = 1; i <= pathParts.length; i++) {
          newExpanded.add(pathParts.slice(0, i).join('/'));
        }
        setExpandedFolders(newExpanded);
      }

      // Load the new image for preview
      // Set loading state immediately to avoid flash of placeholder
      setIsLoadingImage(true);
      setImageUrl(null);
      loadImage(fullPath);

    } catch (error) {
      console.error('Failed to create image:', error);
      // Could add error toast here
    } finally {
      setIsCreatingImage(false);
    }
  }, [imageSession, newImageFilename, selectedDirectory, imagePrefs, queryClient, expandedFolders, loadImage, isCreatingImage]);

  // Close resolution picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (resolutionPickerRef.current && !resolutionPickerRef.current.contains(event.target as Node)) {
        setShowResolutionPicker(false);
      }
    };

    if (showResolutionPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showResolutionPicker]);

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
                {node.fileType === 'spritesheet' ? 'sheet' : node.fileType === 'animation' ? 'anim' : ''}
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
        <span className="text-sm font-semibold uppercase tracking-wide">Image Explorer</span>
        <div className="flex gap-1">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['github-tree'] })}
            className="p-1 hover:bg-base-200 rounded"
            title="Refresh"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* Branch info */}
      {imageSession && (
        <div className="px-3 py-2 border-b border-base-300 bg-base-200">
          <div className="text-xs text-base-content/70">Branch</div>
          <div className="text-sm font-medium text-primary truncate" title={imageSession.branch || ''}>
            {imageSession.branch || 'No branch'}
          </div>
        </div>
      )}

      {/* Editor Mode Tabs with counts */}
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
            <span className="flex-1">Images</span>
            <span className="badge badge-sm badge-ghost">{fileCounts.image}</span>
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
            <span className="flex-1">Sprite Sheets</span>
            <span className="badge badge-sm badge-ghost">{fileCounts.spritesheet}</span>
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
            <span className="flex-1">Animations</span>
            <span className="badge badge-sm badge-ghost">{fileCounts.animation}</span>
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
            ) : fileTree.length > 0 ? (
              renderFileTree(fileTree)
            ) : (
              <div className="px-3 py-4 text-sm text-base-content/70 text-center">
                <svg className="w-8 h-8 mx-auto mb-2 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
                <p>No {editorMode === 'image' ? 'images' : editorMode === 'spritesheet' ? 'sprite sheets' : 'animations'} found</p>
                <p className="text-xs mt-1">
                  {editorMode === 'image'
                    ? 'Looking for: .png, .jpg, .gif, .webp, .svg'
                    : editorMode === 'spritesheet'
                    ? 'Looking for: .spritesheet.json, .atlas.json'
                    : 'Looking for: .animation.json, .anim.json'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Button - at bottom */}
      <div className="p-3 border-t border-base-300 mt-auto">
        <button
          onClick={() => openNewImageModal()}
          className="btn btn-sm btn-primary w-full gap-2"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          New {editorMode === 'image' ? 'Image' : editorMode === 'spritesheet' ? 'Sprite Sheet' : 'Animation'}
        </button>
      </div>
    </div>
  );

  // Preview Content (when file is selected but not editing)
  const PreviewContent = () => (
    <div className="flex-1 flex flex-col">
      {/* Preview Header */}
      <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{selectedFile?.fileType === 'spritesheet' ? '🎞️' : selectedFile?.fileType === 'animation' ? '🎬' : '🖼️'}</span>
          <span className="font-medium text-sm">{selectedFile?.name}</span>
          <span className="text-xs text-base-content/50">{selectedFile?.path}</span>
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
      <div className="flex-1 flex items-center justify-center bg-base-200 p-8 overflow-auto">
        <div className="bg-white rounded-lg shadow-lg p-4 max-w-full max-h-full">
          <div
            className="flex items-center justify-center rounded relative min-w-[256px] min-h-[256px]"
            style={{
              backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
            }}
          >
            {isLoadingImage ? (
              <div className="flex flex-col items-center gap-2">
                <span className="loading loading-spinner loading-lg"></span>
                <span className="text-sm text-base-content/50">Loading image...</span>
              </div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={selectedFile?.name}
                className="max-w-full max-h-[60vh] object-contain"
                style={{ imageRendering: 'pixelated' }}
              />
            ) : selectedFile?.fileType === 'spritesheet' || selectedFile?.fileType === 'animation' ? (
              <div className="flex flex-col items-center gap-2 p-8">
                <span className="text-6xl">{selectedFile?.fileType === 'spritesheet' ? '🎞️' : '🎬'}</span>
                <span className="text-sm text-base-content/70">
                  {selectedFile?.fileType === 'spritesheet' ? 'Sprite Sheet Definition' : 'Animation Definition'}
                </span>
                <span className="text-xs text-base-content/50">{selectedFile?.name}</span>
              </div>
            ) : (
              <span className="text-8xl">🖼️</span>
            )}
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
        <p className="text-sm">Select an image or directory from the sidebar</p>
        <button
          onClick={() => openNewImageModal()}
          className="btn btn-primary btn-sm mt-4 gap-2"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          Create New Image
        </button>
      </div>
    </div>
  );

  // Directory Preview Content (when directory is selected)
  const DirectoryPreviewContent = () => {
    if (!selectedDirectory) return null;

    const dirCounts = countFilesInDirectory(selectedDirectory.path);
    const totalItems = dirCounts.images + dirCounts.spritesheets + dirCounts.animations + dirCounts.folders;

    return (
      <div className="flex-1 flex flex-col">
        {/* Directory Header */}
        <div className="bg-base-100 border-b border-base-300 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            <span className="font-medium text-sm">{selectedDirectory.name}</span>
            <span className="text-xs text-base-content/50">/{selectedDirectory.path}</span>
          </div>
          <button
            onClick={() => openNewImageModal(selectedDirectory.path)}
            className="btn btn-primary btn-sm gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            New Image
          </button>
        </div>

        {/* Directory Content */}
        <div className="flex-1 flex items-center justify-center bg-base-200 p-8">
          <div className="bg-base-100 rounded-lg shadow-lg p-8 max-w-md w-full">
            {/* Large folder icon */}
            <div className="text-center mb-6">
              <svg className="w-24 h-24 mx-auto text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              <h2 className="text-xl font-semibold mt-4">{selectedDirectory.name}</h2>
              <p className="text-sm text-base-content/60 mt-1">{selectedDirectory.path}</p>
            </div>

            {/* Directory stats */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-base-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-primary">{dirCounts.images}</div>
                <div className="text-xs text-base-content/60">Images</div>
              </div>
              <div className="bg-base-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-secondary">{dirCounts.folders}</div>
                <div className="text-xs text-base-content/60">Folders</div>
              </div>
              <div className="bg-base-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-accent">{dirCounts.spritesheets}</div>
                <div className="text-xs text-base-content/60">Sprite Sheets</div>
              </div>
              <div className="bg-base-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-info">{dirCounts.animations}</div>
                <div className="text-xs text-base-content/60">Animations</div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <button
                onClick={() => openNewImageModal(selectedDirectory.path)}
                className="btn btn-primary w-full gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                </svg>
                Create New Image Here
              </button>
              {totalItems === 0 && (
                <p className="text-center text-sm text-base-content/50 mt-4">
                  This folder is empty. Create your first image!
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

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
    // Directory selected - show directory info
    if (selectedDirectory && !selectedFile) {
      const dirCounts = countFilesInDirectory(selectedDirectory.path);
      return (
        <div className="w-64 bg-base-100 border-l border-base-300 p-4 flex-shrink-0">
          <div className="text-sm font-semibold mb-4">Directory Info</div>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-base-content/60">Name</span>
              <span className="font-medium">{selectedDirectory.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Path</span>
              <span className="text-xs truncate max-w-[120px]" title={selectedDirectory.path}>
                /{selectedDirectory.path}
              </span>
            </div>
            <div className="divider my-2"></div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Images</span>
              <span className="badge badge-sm">{dirCounts.images}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Folders</span>
              <span className="badge badge-sm">{dirCounts.folders}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Spritesheets</span>
              <span className="badge badge-sm">{dirCounts.spritesheets}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-base-content/60">Animations</span>
              <span className="badge badge-sm">{dirCounts.animations}</span>
            </div>
          </div>
          <div className="divider my-4"></div>
          <div className="space-y-2">
            <button
              onClick={() => openNewImageModal(selectedDirectory.path)}
              className="btn btn-primary btn-sm w-full gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              New Image
            </button>
          </div>
        </div>
      );
    }

    // No file selected - show tips
    if (!selectedFile) {
      return (
        <div className="w-64 bg-base-100 border-l border-base-300 p-4 flex-shrink-0">
          <div className="text-sm font-semibold mb-4">Quick Start</div>
          <div className="space-y-3 text-sm text-base-content/70">
            <div className="flex items-start gap-2">
              <span className="text-primary">1.</span>
              <span>Select a folder or image from the sidebar</span>
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
          <div className="divider my-4"></div>
          <button
            onClick={() => openNewImageModal()}
            className="btn btn-primary btn-sm w-full gap-2"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            New Image
          </button>
        </div>
      );
    }

    // Preview mode - show file info
    if (viewMode === 'preview') {
      const ext = selectedFile.name.split('.').pop()?.toUpperCase() || '';
      return (
        <div className="w-64 bg-base-100 border-l border-base-300 overflow-y-auto flex-shrink-0">
          <div className="p-4 space-y-4">
            {/* File Info */}
            <div>
              <div className="font-semibold text-base-content mb-3">File Info</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-base-content/60">Name</span>
                  <span className="truncate ml-2 max-w-[140px]" title={selectedFile.name}>{selectedFile.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Path</span>
                  <span className="truncate ml-2 max-w-[140px] text-xs" title={selectedFile.path}>{selectedFile.path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Type</span>
                  <span className="badge badge-sm">
                    {selectedFile.fileType === 'spritesheet' ? 'Sprite Sheet' : selectedFile.fileType === 'animation' ? 'Animation' : 'Image'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-base-content/60">Format</span>
                  <span>{ext}</span>
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
    // Show directory preview if a directory is selected
    if (selectedDirectory && !selectedFile) {
      return <DirectoryPreviewContent />;
    }
    // Show empty state if nothing is selected
    if (!selectedFile) {
      return <EmptyContent />;
    }
    // Show preview or editor based on mode
    if (viewMode === 'preview') {
      return <PreviewContent />;
    }
    return <EditorContent />;
  };

  // Repository Selector View
  const RepoSelector = () => {
    // If we're auto-initializing from quick-setup, show a dedicated loading state
    if (preSelectedSettings?.repositoryUrl && (isLoadingRepos || isInitializing)) {
      return (
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-4 text-lg text-base-content">Setting up your image workspace...</p>
            <p className="mt-2 text-sm text-base-content/70">Creating a new branch for your changes</p>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-base-content mb-2">Start Image Session</h1>
          <p className="text-base-content/70">
            Select a repository to browse and edit images. A new branch will be created for your changes:
            <code className="ml-2 px-2 py-1 bg-base-200 rounded text-sm">
              webedt/started-from-images-{'{id}'}
            </code>
          </p>
        </div>

        {initError && (
          <div className="alert alert-error mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{initError}</span>
            <button onClick={() => setInitError(null)} className="btn btn-sm btn-ghost">Dismiss</button>
          </div>
        )}

        {isLoadingRepos && (
          <div className="text-center py-12">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-2 text-base-content/70">Loading repositories...</p>
          </div>
        )}

        {reposError && (
          <div className="alert alert-error">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              {reposError instanceof Error ? reposError.message : 'Failed to load repositories'}
              {String(reposError).includes('GitHub not connected') && (
                <span className="ml-2">
                  Please <a href="/settings" className="link link-primary">connect your GitHub account</a> first.
                </span>
              )}
            </span>
          </div>
        )}

        {!isLoadingRepos && !reposError && repos.length === 0 && (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-12 w-12 text-base-content/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-base-content">No repositories</h3>
            <p className="mt-1 text-sm text-base-content/70">
              No repositories found. Make sure your GitHub account is connected.
            </p>
          </div>
        )}

        {!isLoadingRepos && !reposError && repos.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {repos.map((repo) => (
              <div
                key={repo.id}
                onClick={() => !isInitializing && initializeImageSession(repo)}
                className={`p-4 bg-base-100 border border-base-300 rounded-lg hover:border-primary hover:shadow-md cursor-pointer transition-all ${
                  isInitializing ? 'opacity-50 cursor-wait' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-primary truncate">{repo.fullName}</span>
                      {repo.private && (
                        <span className="badge badge-xs badge-outline">Private</span>
                      )}
                    </div>
                    {repo.description && (
                      <p className="mt-1 text-sm text-base-content/70 line-clamp-2">
                        {repo.description}
                      </p>
                    )}
                    <div className="mt-2 text-xs text-base-content/50">
                      Default branch: {repo.defaultBranch}
                    </div>
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    {isInitializing ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      <svg
                        className="w-5 h-5 text-base-content/40"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Determine what content to show based on state
  const getMainView = () => {
    // Show loading state when fetching existing session
    if (sessionId && isLoadingExistingSession) {
      return (
        <div className="flex items-center justify-center h-[calc(100vh-112px)]">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-2 text-base-content/70">Loading session...</p>
          </div>
        </div>
      );
    }

    // If no session ID and no active image session, show repo selector
    if (!sessionId && !imageSession) {
      return <RepoSelector />;
    }

    // If we have an image session, show the editor
    if (imageSession) {
      return (
        <div className="h-full flex bg-base-300">
          <LeftSidebar />
          <MainContent />
          <RightSidebar />
        </div>
      );
    }

    // Fallback - show repo selector
    return <RepoSelector />;
  };

  // New Image Modal Component
  const NewImageModal = () => {
    if (!showNewImageModal) return null;

    const aspectTabs: AspectRatioTab[] = ['1:1', '4:3', '16:9', '3:2', 'custom'];
    const extensions: ImageExtension[] = ['png', 'jpg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

    const handlePresetClick = (width: number, height: number) => {
      imagePrefs.setDimensions(width, height);
    };

    const updateFilenameExtension = (newExt: string) => {
      const baseName = newImageFilename.replace(/\.[^/.]+$/, '');
      setNewImageFilename(`${baseName}.${newExt}`);
      imagePrefs.setExtension(newExt as ImageExtension);
    };

    const currentPresets = RESOLUTION_PRESETS[imagePrefs.aspectRatioTab] || [];

    return (
      <div className="modal modal-open">
        <div className="modal-box max-w-xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-lg">Create New Image</h3>
            <button
              onClick={() => setShowNewImageModal(false)}
              className="btn btn-sm btn-circle btn-ghost"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>

          {/* File Name */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text font-medium">File Name</span>
              {selectedDirectory && (
                <span className="label-text-alt text-base-content/50">
                  in /{selectedDirectory.path}
                </span>
              )}
            </label>
            <input
              type="text"
              value={newImageFilename}
              onChange={(e) => setNewImageFilename(e.target.value)}
              className="input input-bordered w-full"
              placeholder="image.png"
            />
          </div>

          {/* File Type */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text font-medium">File Type</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {extensions.map((ext) => (
                <button
                  key={ext}
                  onClick={() => updateFilenameExtension(ext)}
                  className={`btn btn-sm ${
                    imagePrefs.extension === ext ? 'btn-primary' : 'btn-outline'
                  }`}
                >
                  .{ext}
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio Tabs */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text font-medium">Aspect Ratio</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {aspectTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => imagePrefs.setAspectRatioTab(tab)}
                  className={`btn btn-sm ${imagePrefs.aspectRatioTab === tab ? 'btn-primary' : 'btn-outline'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {/* Dimensions */}
          <div className="form-control mb-4">
            <label className="label">
              <span className="label-text font-medium">Dimensions</span>
              <span className="label-text-alt text-base-content/50">
                {imagePrefs.width} x {imagePrefs.height} px
              </span>
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={imagePrefs.width}
                onChange={(e) => imagePrefs.setWidth(parseInt(e.target.value) || 1)}
                className="input input-bordered w-full"
                min="1"
                max="16384"
              />
              <span className="text-base-content/50">x</span>
              <input
                type="number"
                value={imagePrefs.height}
                onChange={(e) => imagePrefs.setHeight(parseInt(e.target.value) || 1)}
                className="input input-bordered w-full"
                min="1"
                max="16384"
              />
              {/* Resolution Presets Bubble */}
              <div className="relative" ref={resolutionPickerRef}>
                <button
                  onClick={() => setShowResolutionPicker(!showResolutionPicker)}
                  className="btn btn-square btn-outline"
                  title="Common Resolutions"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  </svg>
                </button>
                {showResolutionPicker && (
                  <div className="absolute right-0 top-full mt-2 z-50 bg-base-100 border border-base-300 rounded-lg shadow-xl p-3 min-w-[200px]">
                    <div className="text-xs font-semibold text-base-content/50 mb-2 uppercase tracking-wide">
                      {imagePrefs.aspectRatioTab} Presets
                    </div>
                    {currentPresets.length > 0 ? (
                      <div className="grid grid-cols-2 gap-1">
                        {currentPresets.map((preset) => (
                          <button
                            key={`${preset.width}x${preset.height}`}
                            onClick={() => {
                              handlePresetClick(preset.width, preset.height);
                              setShowResolutionPicker(false);
                            }}
                            className={`btn btn-xs ${
                              imagePrefs.width === preset.width && imagePrefs.height === preset.height
                                ? 'btn-primary'
                                : 'btn-ghost'
                            }`}
                          >
                            {preset.width}x{preset.height}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-base-content/50 text-center py-2">
                        Enter custom dimensions
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Resolution Presets (for current aspect ratio) */}
          {currentPresets.length > 0 && (
            <div className="mb-4">
              <div className="flex flex-wrap gap-1">
                {currentPresets.slice(0, 6).map((preset) => (
                  <button
                    key={`quick-${preset.width}x${preset.height}`}
                    onClick={() => handlePresetClick(preset.width, preset.height)}
                    className={`badge badge-lg cursor-pointer hover:badge-primary transition-colors ${
                      imagePrefs.width === preset.width && imagePrefs.height === preset.height
                        ? 'badge-primary'
                        : 'badge-outline'
                    }`}
                  >
                    {preset.width}x{preset.height}
                  </button>
                ))}
                {currentPresets.length > 6 && (
                  <button
                    onClick={() => setShowResolutionPicker(true)}
                    className="badge badge-lg badge-ghost cursor-pointer"
                  >
                    +{currentPresets.length - 6} more
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          <div className="bg-base-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-center">
              <div
                className="bg-base-100 border border-base-300 rounded flex items-center justify-center text-base-content/30"
                style={{
                  width: Math.min(imagePrefs.width / 4, 200),
                  height: Math.min(imagePrefs.height / 4, 200),
                  aspectRatio: `${imagePrefs.width} / ${imagePrefs.height}`,
                  maxWidth: '200px',
                  maxHeight: '150px',
                }}
              >
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                </svg>
              </div>
            </div>
            <div className="text-center text-xs text-base-content/50 mt-2">
              Preview ({imagePrefs.width} x {imagePrefs.height})
            </div>
          </div>

          {/* Actions */}
          <div className="modal-action">
            <button
              onClick={() => setShowNewImageModal(false)}
              className="btn btn-ghost"
              disabled={isCreatingImage}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateNewImage}
              className="btn btn-primary gap-2"
              disabled={isCreatingImage || !newImageFilename.trim()}
            >
              {isCreatingImage ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Creating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                  Create Image
                </>
              )}
            </button>
          </div>
        </div>
        <div className="modal-backdrop" onClick={() => !isCreatingImage && setShowNewImageModal(false)}></div>
      </div>
    );
  };

  return (
    <>
      {getMainView()}
      <NewImageModal />
    </>
  );
}

export default function Images() {
  return (
    <SessionLayout>
      <ImagesContent />
    </SessionLayout>
  );
}
