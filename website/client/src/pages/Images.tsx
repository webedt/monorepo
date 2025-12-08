import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';
import { githubApi, sessionsApi, storageWorkerApi } from '@/lib/api';
import type { GitHubPullRequest } from '@/shared';
import {
  useNewImagePreferencesStore,
  RESOLUTION_PRESETS,
  type AspectRatioTab,
  type ImageExtension,
} from '@/lib/store';

type EditorMode = 'image' | 'spritesheet' | 'animation';
type ViewMode = 'preview' | 'edit';
type DrawingTool = 'select' | 'pencil' | 'brush' | 'fill' | 'eraser' | 'rectangle' | 'circle' | 'line';

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

// Helper to recursively remove empty folders from the tree
const removeEmptyFolders = (nodes: FileNode[]): FileNode[] => {
  return nodes
    .map(node => {
      if (node.type === 'folder' && node.children) {
        // Recursively clean children first
        const cleanedChildren = removeEmptyFolders(node.children);
        return { ...node, children: cleanedChildren };
      }
      return node;
    })
    .filter(node => {
      // Keep files
      if (node.type === 'file') return true;
      // Keep folders that have children
      return node.children && node.children.length > 0;
    });
};

// Transform storage-worker files to our filtered TreeNode format for images
// Storage files have path and type properties
const transformStorageFilesForImages = (
  files: { path: string; size: number; type: 'file' | 'directory' }[],
  filterMode: EditorMode | 'all'
): FileNode[] => {
  const root: FileNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Filter to only include files under workspace/ and strip the prefix
  // Also filter out .git directories and their contents
  const workspaceFiles = files
    .filter(f => f.path.startsWith('workspace/'))
    .filter(f => {
      // Exclude .git folder and anything inside it
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
  const fileTypes = new Map<string, ImageFileType>();
  for (const item of sortedItems) {
    if (item.type === 'file') {
      const fileType = getImageFileType(item.path.split('/').pop() || '');
      if (fileType) {
        fileTypes.set(item.path, fileType);
      }
    }
  }

  // Collect all directory paths
  const allDirectories = new Set<string>();
  for (const item of sortedItems) {
    if (item.type === 'directory') {
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
        if (item.type === 'file') {
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

  // Remove empty folders from the tree
  return removeEmptyFolders(root.children || []);
};

// Props for split view support
interface ImagesContentProps {
  sessionId?: string;
  isEmbedded?: boolean;
}

export function ImagesContent({ sessionId: sessionIdProp, isEmbedded = false }: ImagesContentProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  const sessionId = sessionIdProp ?? sessionIdParam;
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

  // Canvas and drawing state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingLayerRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [currentTool, setCurrentTool] = useState<DrawingTool>('pencil');
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(4);
  const [brushOpacity, setBrushOpacity] = useState(100);
  const [primaryColor, setPrimaryColor] = useState('#000000');
  const [secondaryColor, setSecondaryColor] = useState('#FFFFFF');
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [canvasHistory, setCanvasHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number } | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const [shapeStart, setShapeStart] = useState<{ x: number; y: number } | null>(null);

  // New Image Modal state
  const [showNewImageModal, setShowNewImageModal] = useState(false);
  const [newImageFilename, setNewImageFilename] = useState('image.png');
  const [showResolutionPicker, setShowResolutionPicker] = useState(false);
  const [isCreatingImage, setIsCreatingImage] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const resolutionPickerRef = useRef<HTMLDivElement>(null);

  // Track modified images for commit functionality
  const [modifiedImages, setModifiedImages] = useState<Set<string>>(new Set());
  const [commitStatus, setCommitStatus] = useState<'idle' | 'committing' | 'committed' | 'error'>('idle');

  // PR-related state
  const [prLoading, setPrLoading] = useState<'create' | 'auto' | null>(null);
  const [_prError, setPrError] = useState<string | null>(null);
  const [_prSuccess, setPrSuccess] = useState<string | null>(null);
  const [_autoPrProgress, setAutoPrProgress] = useState<string | null>(null);

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

  // Query to check for existing PR
  const { data: prData, refetch: refetchPr } = useQuery({
    queryKey: ['pr', imageSession?.owner, imageSession?.repo, imageSession?.branch],
    queryFn: async () => {
      if (!imageSession?.owner || !imageSession?.repo || !imageSession?.branch) {
        return null;
      }
      const response = await githubApi.getPulls(
        imageSession.owner,
        imageSession.repo,
        imageSession.branch,
        imageSession.baseBranch || undefined
      );
      return response.data as GitHubPullRequest[];
    },
    enabled: !!imageSession?.owner && !!imageSession?.repo && !!imageSession?.branch,
    refetchOnWindowFocus: false,
  });

  const existingPr = prData?.find((pr: GitHubPullRequest) => pr.state === 'open');
  const mergedPr = prData?.find((pr: GitHubPullRequest) => pr.merged === true);

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
    const branchName = `webedt/image-editor-${randomId}`;

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

  // Fetch file tree from storage-worker when imageSession is active
  // NOTE: Storage-worker uses the database session ID as the storage key
  const { data: treeData, isLoading: isLoadingTree, error: treeError } = useQuery({
    queryKey: ['file-tree', imageSession?.sessionId],
    queryFn: async () => {
      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = imageSession!.sessionId;

      if (!storageSessionId) {
        throw new Error('No session ID available');
      }

      console.log('[Images] Fetching file tree from storage-worker:', storageSessionId);
      const files = await storageWorkerApi.listFiles(storageSessionId);

      if (files && files.length > 0) {
        return { source: 'storage', files };
      }

      // Empty result - session might not have any files yet
      console.log('[Images] Storage-worker returned empty file list');
      return { source: 'storage', files: [] };
    },
    enabled: !!imageSession?.sessionId,
    retry: 1, // Only retry once for faster feedback
  });

  // Transform and filter the file tree based on editor mode (storage-worker only)
  const fileTree = useMemo(() => {
    if (!treeData) return [];
    if (treeData.source === 'storage' && treeData.files) {
      return transformStorageFilesForImages(treeData.files, editorMode);
    }
    return [];
  }, [treeData, editorMode]);

  // Count files by type for display (storage-worker only)
  const fileCounts = useMemo(() => {
    if (!treeData) return { image: 0, spritesheet: 0, animation: 0 };

    const counts = { image: 0, spritesheet: 0, animation: 0 };

    if (treeData.source === 'storage' && treeData.files) {
      // Filter to only count files under workspace/
      const workspaceFiles = treeData.files.filter(
        (f: { path: string; type: string }) => f.path.startsWith('workspace/') && f.type === 'file'
      );
      for (const item of workspaceFiles) {
        const fileName = item.path.split('/').pop() || '';
        const fileType = getImageFileType(fileName);
        if (fileType) {
          counts[fileType]++;
        }
      }
    }

    return counts;
  }, [treeData]);

  // Helper to convert blob to data URL
  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Load image from storage-worker when a file is selected
  // Always converts to data URL to avoid CORS issues with canvas
  const loadImage = useCallback(async (path: string) => {
    if (!imageSession) return;

    setIsLoadingImage(true);
    setImageUrl(null);

    try {
      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = imageSession.sessionId;

      if (!storageSessionId) {
        console.error('[Images] No session ID available');
        return;
      }

      console.log('[loadImage] Fetching from storage-worker:', storageSessionId, `workspace/${path}`);
      const blob = await storageWorkerApi.getFileBlob(storageSessionId, `workspace/${path}`);

      if (blob) {
        console.log('[loadImage] Got blob, size:', blob.size, 'type:', blob.type);
        const dataUrl = await blobToDataUrl(blob);
        console.log('[loadImage] Converted to dataUrl, length:', dataUrl.length);
        setImageUrl(dataUrl);
      } else {
        console.error('[Images] Image not found in storage:', path);
      }
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
      // Check if we're clicking on the same file that's already selected
      const isSameFile = selectedFile?.path === node.path;

      setSelectedFile({ path: node.path, name: node.name, fileType: node.fileType });
      setSelectedDirectory(null);
      setViewMode('preview');

      // Load the image if it's an image file AND it's not the same file we already have loaded
      if (node.fileType === 'image') {
        if (!isSameFile) {
          // Set loading state immediately to avoid flash of placeholder
          setIsLoadingImage(true);
          setImageUrl(null);
          loadImage(node.path);
        }
        // If it's the same file, keep the existing imageUrl
      } else {
        setImageUrl(null);
      }
    }
  };

  // Helper to count files in a directory
  const countFilesInDirectory = useCallback((dirPath: string): { images: number; spritesheets: number; animations: number; folders: number } => {
    const counts = { images: 0, spritesheets: 0, animations: 0, folders: 0 };
    if (!treeData?.files) return counts;

    // Files in storage have workspace/ prefix, so we need to account for that
    const workspacePrefix = 'workspace/';
    const fullDirPath = workspacePrefix + dirPath;

    for (const item of treeData.files) {
      // Check if item is directly inside this directory
      if (item.path.startsWith(fullDirPath + '/')) {
        const relativePath = item.path.slice(fullDirPath.length + 1);
        // Only count direct children (no more slashes in relative path)
        if (!relativePath.includes('/')) {
          if (item.type === 'directory') {
            counts.folders++;
          } else if (item.type === 'file') {
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
    if (!treeData?.files) return `image.${extension}`;

    const existingFiles = new Set<string>();
    // Files in storage have workspace/ prefix
    const workspacePrefix = 'workspace/';
    const prefix = basePath ? `${workspacePrefix}${basePath}/` : workspacePrefix;

    for (const item of treeData.files) {
      if (item.type === 'file' && item.path.startsWith(prefix)) {
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
      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = imageSession.sessionId;
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }
      const storagePath = `workspace/${fullPath}`;

      // Convert base64 to Blob for storage-worker
      const byteCharacters = atob(base64Content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      // Create file in storage-worker
      const success = await storageWorkerApi.writeFile(storageSessionId, storagePath, blob);
      if (!success) {
        throw new Error('Failed to create image in storage');
      }

      // Close modal
      setShowNewImageModal(false);

      // Refresh the file tree (use session-specific query key to avoid affecting other components in split view)
      await queryClient.invalidateQueries({ queryKey: ['file-tree', imageSession?.sessionId] });

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

  // Handle saving the current image
  const handleSaveImage = useCallback(async () => {
    if (!imageSession || !selectedFile || !canvasRef.current || isSavingImage) return;

    setIsSavingImage(true);

    try {
      const canvas = canvasRef.current;
      const drawingCanvas = drawingLayerRef.current;
      const ctx = canvas.getContext('2d');
      const drawingCtx = drawingCanvas?.getContext('2d');

      if (!ctx) {
        console.error('Failed to get canvas context');
        return;
      }

      // Merge drawing layer onto base canvas if it exists
      if (drawingCanvas && drawingCtx) {
        ctx.drawImage(drawingCanvas, 0, 0);
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      }

      // Determine MIME type from file extension
      const ext = selectedFile.name.split('.').pop()?.toLowerCase() || 'png';
      const mimeTypes: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
      };
      const mimeType = mimeTypes[ext] || 'image/png';

      // Convert canvas to data URL and extract base64 content
      const dataUrl = canvas.toDataURL(mimeType);
      const base64Content = dataUrl.split(',')[1];

      // Convert base64 to Blob for storage-worker
      const byteCharacters = atob(base64Content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });

      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = imageSession.sessionId;
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }
      const storagePath = `workspace/${selectedFile.path}`;

      console.log('[Save] Saving to storage-worker...', {
        storageSessionId,
        storagePath,
        blobSize: blob.size
      });

      // Save to storage-worker only
      const storageResult = await storageWorkerApi.writeFile(storageSessionId, storagePath, blob);

      if (!storageResult) {
        throw new Error('Failed to save image to storage');
      }

      console.log('[Save] Storage-worker result:', storageResult);

      // Update the imageUrl with the saved data URL so the canvas state is preserved
      // This prevents the image from disappearing after save
      setImageUrl(dataUrl);

      // Update history with the merged state
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const newHistory = canvasHistory.slice(0, historyIndex + 1);
      newHistory.push(imageData);
      if (newHistory.length > 50) {
        newHistory.shift();
      }
      setCanvasHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

      // Clear selection
      setSelection(null);

      // Mark image as modified (uncommitted change)
      setModifiedImages(prev => new Set(prev).add(selectedFile.path));

      console.log('Image saved successfully');
    } catch (error) {
      console.error('Failed to save image:', error);
      // Could add error toast here
    } finally {
      setIsSavingImage(false);
    }
  }, [imageSession, selectedFile, isSavingImage, canvasHistory, historyIndex]);

  // Mark all modified images as committed (changes are synced when creating PR)
  const commitChanges = useCallback(async () => {
    if (!imageSession || modifiedImages.size === 0) return;

    setCommitStatus('committing');

    try {
      // Log the commit action
      const modifiedFilesList = Array.from(modifiedImages);
      console.log(`Marking ${modifiedFilesList.length} image(s) as committed:`, modifiedFilesList);

      // Clear modified images list (they're already saved to storage-worker)
      setModifiedImages(new Set());
      setCommitStatus('committed');

      // Reset status after a short delay
      setTimeout(() => {
        setCommitStatus(prev => prev === 'committed' ? 'idle' : prev);
      }, 2000);

      console.log('Changes marked as committed');
    } catch (error) {
      console.error('Failed to commit changes:', error);
      setCommitStatus('error');
    }
  }, [imageSession, modifiedImages]);

  // PR Handler Functions
  const handleCreatePR = async () => {
    if (!imageSession?.owner || !imageSession?.repo || !imageSession?.branch || !imageSession?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('create');
    setPrError(null);
    setPrSuccess(null);

    try {
      const response = await githubApi.createPull(
        imageSession.owner,
        imageSession.repo,
        {
          title: `Image changes from ${imageSession.branch}`,
          head: imageSession.branch,
          base: imageSession.baseBranch,
        }
      );
      setPrSuccess(`PR #${response.data.number} created successfully!`);
      refetchPr();
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to create PR';
      setPrError(errorMsg);
    } finally {
      setPrLoading(null);
    }
  };

  const handleViewPR = () => {
    if (existingPr?.htmlUrl) {
      window.open(existingPr.htmlUrl, '_blank');
    }
  };

  const handleAutoPR = async () => {
    if (!imageSession?.owner || !imageSession?.repo || !imageSession?.branch || !imageSession?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('auto');
    setPrError(null);
    setPrSuccess(null);
    setAutoPrProgress('Starting Auto PR...');

    try {
      const response = await githubApi.autoPR(
        imageSession.owner,
        imageSession.repo,
        imageSession.branch,
        {
          base: imageSession.baseBranch,
          title: `Image changes from ${imageSession.branch}`,
          sessionId: imageSession.sessionId,
        }
      );

      const results = response.data;
      setPrSuccess(`Auto PR completed! PR #${results.pr?.number} merged successfully.`);
      setAutoPrProgress(null);
      refetchPr();

      // After successful auto PR, redirect to sessions list
      setTimeout(() => {
        navigate('/sessions');
      }, 2000);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to complete Auto PR';

      if (errorMsg.includes('conflict')) {
        setPrError('Merge conflict detected. Please resolve conflicts manually.');
      } else if (errorMsg.includes('Timeout')) {
        setPrError(errorMsg);
      } else {
        setPrError(errorMsg);
      }

      setAutoPrProgress(null);
      refetchPr();
    } finally {
      setPrLoading(null);
    }
  };

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

  // Initialize canvas when entering edit mode with an image
  useEffect(() => {
    if (viewMode !== 'edit' || !imageUrl) return;

    console.log('[Canvas] Starting image load, imageUrl length:', imageUrl.length, 'starts with data:', imageUrl.startsWith('data:'));

    // Use a small timeout to ensure canvas refs are mounted after view mode switch
    const timeoutId = setTimeout(() => {
      const canvas = canvasRef.current;
      const drawingCanvas = drawingLayerRef.current;

      if (!canvas || !drawingCanvas) {
        console.warn('[Canvas] Canvas refs not ready yet');
        return;
      }

      console.log('[Canvas] Canvas refs ready, creating Image object');

      const ctx = canvas.getContext('2d');
      const drawingCtx = drawingCanvas.getContext('2d');

      if (!ctx || !drawingCtx) return;

      const img = new Image();

      // Only set crossOrigin for non-data URLs to avoid CORS issues
      // Data URLs don't need CORS and setting it can cause issues
      if (!imageUrl.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }

      img.onload = () => {
        console.log('[Canvas] Image loaded successfully:', img.width, 'x', img.height);
        // Set canvas dimensions to match image
        canvas.width = img.width;
        canvas.height = img.height;
        drawingCanvas.width = img.width;
        drawingCanvas.height = img.height;

        // Draw image on base canvas
        ctx.drawImage(img, 0, 0);
        console.log('[Canvas] Drew image to canvas');

        // Clear drawing layer
        drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

        // Initialize history with current state
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Calculate auto-fit zoom level if image is larger than container
        let fitZoom = 100;
        if (canvasContainerRef.current) {
          const containerRect = canvasContainerRef.current.getBoundingClientRect();
          // Account for padding and the white card around the canvas
          const availableWidth = containerRect.width - 80;
          const availableHeight = containerRect.height - 80;

          // Calculate zoom needed to fit image in viewport
          const scaleX = availableWidth / img.width;
          const scaleY = availableHeight / img.height;
          const fitScale = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100%

          // Use exact percentage for better fit (round to 1 decimal place)
          fitZoom = Math.round(fitScale * 1000) / 10;
          // Ensure minimum zoom of 10%
          fitZoom = Math.max(10, Math.min(fitZoom, 100));
        }

        // Batch all state updates together to minimize re-renders
        // Use a microtask to ensure canvas drawing completes first
        queueMicrotask(() => {
          setCanvasDimensions({ width: img.width, height: img.height });
          setCanvasHistory([imageData]);
          setHistoryIndex(0);
          setSelection(null);
          setCanvasZoom(fitZoom);

          // Re-draw after state updates to ensure canvas isn't cleared by re-render
          requestAnimationFrame(() => {
            if (canvasRef.current) {
              const ctx2 = canvasRef.current.getContext('2d');
              if (ctx2 && canvasRef.current.width === img.width) {
                ctx2.putImageData(imageData, 0, 0);
                console.log('[Canvas] Re-drew image after state update');
              }
            }
          });
        });
      };

      img.onerror = (e) => {
        console.error('[Canvas] Failed to load image onto canvas:', e, 'imageUrl:', imageUrl.substring(0, 100));
        // Try loading without crossOrigin as fallback
        if (img.crossOrigin) {
          console.log('Retrying without crossOrigin...');
          const retryImg = new Image();
          retryImg.onload = () => {
            canvas.width = retryImg.width;
            canvas.height = retryImg.height;
            drawingCanvas.width = retryImg.width;
            drawingCanvas.height = retryImg.height;
            setCanvasDimensions({ width: retryImg.width, height: retryImg.height });
            ctx.drawImage(retryImg, 0, 0);
            drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            setCanvasHistory([imageData]);
            setHistoryIndex(0);
            setSelection(null);

            // Auto-fit zoom on retry success
            if (canvasContainerRef.current) {
              const containerRect = canvasContainerRef.current.getBoundingClientRect();
              const availableWidth = containerRect.width - 80;
              const availableHeight = containerRect.height - 80;
              const scaleX = availableWidth / retryImg.width;
              const scaleY = availableHeight / retryImg.height;
              const fitScale = Math.min(scaleX, scaleY, 1);
              const fitZoom = Math.round(fitScale * 1000) / 10;
              setCanvasZoom(Math.max(10, Math.min(fitZoom, 100)));
            }
          };
          retryImg.onerror = () => {
            console.error('Failed to load image even without crossOrigin');
          };
          retryImg.src = imageUrl;
        }
      };

      img.src = imageUrl;
    }, 50); // Small delay to ensure canvas is mounted

    return () => clearTimeout(timeoutId);
  }, [viewMode, imageUrl]);

  // Track if we're in the middle of saving to prevent restore from interfering
  const isSavingRef = useRef(false);

  // Store event handlers in refs so canvas doesn't need to be recreated when handlers change
  const handleCanvasMouseDownRef = useRef<(e: React.MouseEvent<HTMLCanvasElement>) => void>(() => {});
  const handleCanvasMouseMoveRef = useRef<(e: React.MouseEvent<HTMLCanvasElement>) => void>(() => {});
  const handleCanvasMouseUpRef = useRef<() => void>(() => {});
  const handleCanvasMouseLeaveRef = useRef<() => void>(() => {});

  // Restore canvas from history after re-renders (since EditorContent is recreated each render)
  useEffect(() => {
    if (viewMode !== 'edit') return;
    if (canvasHistory.length === 0 || historyIndex < 0) return;
    if (isSavingRef.current) return; // Don't restore while saving

    // Small delay to ensure canvas is mounted after re-render
    const timeoutId = setTimeout(() => {
      const canvas = canvasRef.current;
      const drawingCanvas = drawingLayerRef.current;
      if (!canvas || !drawingCanvas) return;

      const currentImageData = canvasHistory[historyIndex];

      // Set canvas dimensions if needed
      if (canvas.width !== currentImageData.width || canvas.height !== currentImageData.height) {
        canvas.width = currentImageData.width;
        canvas.height = currentImageData.height;
        drawingCanvas.width = currentImageData.width;
        drawingCanvas.height = currentImageData.height;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(currentImageData, 0, 0);
        console.log('[Canvas] Restored from history after render');
      }
    }, 10);

    return () => clearTimeout(timeoutId);
  }, [viewMode, canvasHistory, historyIndex, canvasDimensions]);

  // Save canvas state to history
  const saveToHistory = useCallback(() => {
    const canvas = canvasRef.current;
    const drawingCanvas = drawingLayerRef.current;
    if (!canvas || !drawingCanvas) return;

    const ctx = canvas.getContext('2d');
    const drawingCtx = drawingCanvas.getContext('2d');
    if (!ctx || !drawingCtx) return;

    // Mark that we're saving to prevent restore from interfering
    isSavingRef.current = true;

    // Merge drawing layer onto main canvas
    ctx.drawImage(drawingCanvas, 0, 0);
    // Clear drawing layer
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

    // Save combined state to history
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Remove any future history if we're not at the end
    const newHistory = canvasHistory.slice(0, historyIndex + 1);
    newHistory.push(imageData);

    // Limit history size
    if (newHistory.length > 50) {
      newHistory.shift();
    }

    setCanvasHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);

    // Allow restore again after state updates complete
    requestAnimationFrame(() => {
      isSavingRef.current = false;
    });
  }, [canvasHistory, historyIndex]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const prevIndex = historyIndex - 1;
      ctx.putImageData(canvasHistory[prevIndex], 0, 0);
      setHistoryIndex(prevIndex);
    }
  }, [historyIndex, canvasHistory]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (historyIndex < canvasHistory.length - 1) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const nextIndex = historyIndex + 1;
      ctx.putImageData(canvasHistory[nextIndex], 0, 0);
      setHistoryIndex(nextIndex);
    }
  }, [historyIndex, canvasHistory]);

  // Get mouse position relative to canvas
  const getCanvasPosition = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Use canvasRef for dimensions since it's the source of truth
    const baseCanvas = canvasRef.current;
    const targetCanvas = e.currentTarget;
    const rect = targetCanvas.getBoundingClientRect();

    // Use base canvas dimensions for scaling (they should match, but be safe)
    const canvasWidth = baseCanvas?.width || targetCanvas.width;
    const canvasHeight = baseCanvas?.height || targetCanvas.height;

    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY)
    };
  }, []);

  // Draw line between two points
  const drawLine = useCallback((ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, []);

  // Flood fill algorithm
  const floodFill = useCallback((startX: number, startY: number, fillColor: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Convert fill color to RGBA
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.fillStyle = fillColor;
    tempCtx.fillRect(0, 0, 1, 1);
    const fillRgba = tempCtx.getImageData(0, 0, 1, 1).data;

    const targetX = Math.floor(startX);
    const targetY = Math.floor(startY);
    const targetIndex = (targetY * canvas.width + targetX) * 4;
    const targetColor = [data[targetIndex], data[targetIndex + 1], data[targetIndex + 2], data[targetIndex + 3]];

    // Don't fill if clicking on the same color
    if (targetColor[0] === fillRgba[0] && targetColor[1] === fillRgba[1] && targetColor[2] === fillRgba[2]) {
      return;
    }

    const stack: [number, number][] = [[targetX, targetY]];
    const visited = new Set<string>();

    const matchesTarget = (index: number) => {
      return Math.abs(data[index] - targetColor[0]) < 10 &&
             Math.abs(data[index + 1] - targetColor[1]) < 10 &&
             Math.abs(data[index + 2] - targetColor[2]) < 10 &&
             Math.abs(data[index + 3] - targetColor[3]) < 10;
    };

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;

      const index = (y * canvas.width + x) * 4;
      if (!matchesTarget(index)) continue;

      visited.add(key);

      data[index] = fillRgba[0];
      data[index + 1] = fillRgba[1];
      data[index + 2] = fillRgba[2];
      data[index + 3] = 255;

      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    ctx.putImageData(imageData, 0, 0);
    saveToHistory();
  }, [saveToHistory]);

  // Handle mouse down on canvas
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPosition(e);
    const drawingCanvas = drawingLayerRef.current;
    const baseCanvas = canvasRef.current;

    console.log('[Draw] MouseDown at', pos, 'tool:', currentTool);
    console.log('[Draw] Base canvas size:', baseCanvas?.width, 'x', baseCanvas?.height);
    console.log('[Draw] Drawing canvas size:', drawingCanvas?.width, 'x', drawingCanvas?.height);

    if (!drawingCanvas || !baseCanvas) return;

    // Ensure drawing canvas has same dimensions as base canvas
    if (drawingCanvas.width !== baseCanvas.width || drawingCanvas.height !== baseCanvas.height) {
      console.log('[Draw] Fixing drawing canvas dimensions');
      drawingCanvas.width = baseCanvas.width;
      drawingCanvas.height = baseCanvas.height;
    }

    const ctx = drawingCanvas.getContext('2d');
    if (!ctx) return;

    if (currentTool === 'select') {
      setIsSelecting(true);
      selectionStartRef.current = pos;
      setSelection(null);
      return;
    }

    if (currentTool === 'fill') {
      floodFill(pos.x, pos.y, primaryColor);
      return;
    }

    if (currentTool === 'rectangle' || currentTool === 'circle' || currentTool === 'line') {
      setShapeStart(pos);
      setIsDrawing(true);
      return;
    }

    setIsDrawing(true);
    lastPointRef.current = pos;

    // Set up drawing context
    ctx.strokeStyle = currentTool === 'eraser' ? 'rgba(255,255,255,1)' : primaryColor;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = currentTool === 'eraser' ? 1 : brushOpacity / 100;

    if (currentTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    // Draw initial point
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = primaryColor;
    ctx.fill();
  }, [currentTool, primaryColor, brushSize, brushOpacity, getCanvasPosition, floodFill]);

  // Keep refs updated with latest handlers
  handleCanvasMouseDownRef.current = handleCanvasMouseDown;

  // Handle mouse move on canvas
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getCanvasPosition(e);

    if (isSelecting && selectionStartRef.current) {
      const start = selectionStartRef.current;
      setSelection({
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        width: Math.abs(pos.x - start.x),
        height: Math.abs(pos.y - start.y)
      });
      return;
    }

    if (!isDrawing) return;

    const drawingCanvas = drawingLayerRef.current;
    if (!drawingCanvas) return;
    const ctx = drawingCanvas.getContext('2d');
    if (!ctx) return;

    // Handle shape tools
    if (shapeStart && (currentTool === 'rectangle' || currentTool === 'circle' || currentTool === 'line')) {
      // Clear and redraw the shape preview
      ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = brushSize;
      ctx.globalAlpha = brushOpacity / 100;

      if (currentTool === 'rectangle') {
        ctx.strokeRect(
          shapeStart.x,
          shapeStart.y,
          pos.x - shapeStart.x,
          pos.y - shapeStart.y
        );
      } else if (currentTool === 'circle') {
        const radiusX = Math.abs(pos.x - shapeStart.x) / 2;
        const radiusY = Math.abs(pos.y - shapeStart.y) / 2;
        const centerX = shapeStart.x + (pos.x - shapeStart.x) / 2;
        const centerY = shapeStart.y + (pos.y - shapeStart.y) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (currentTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(shapeStart.x, shapeStart.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
      return;
    }

    // Handle freehand drawing
    if (lastPointRef.current) {
      drawLine(ctx, lastPointRef.current, pos);
    }
    lastPointRef.current = pos;
  }, [isDrawing, isSelecting, currentTool, primaryColor, brushSize, brushOpacity, getCanvasPosition, drawLine, shapeStart]);

  // Keep refs updated with latest handlers
  handleCanvasMouseMoveRef.current = handleCanvasMouseMove;

  // Handle mouse up on canvas
  const handleCanvasMouseUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      selectionStartRef.current = null;
      return;
    }

    if (isDrawing) {
      setIsDrawing(false);
      lastPointRef.current = null;
      setShapeStart(null);

      // Reset composite operation
      const drawingCanvas = drawingLayerRef.current;
      if (drawingCanvas) {
        const ctx = drawingCanvas.getContext('2d');
        if (ctx) {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
        }
      }

      saveToHistory();
    }
  }, [isDrawing, isSelecting, saveToHistory]);

  // Keep refs updated with latest handlers
  handleCanvasMouseUpRef.current = handleCanvasMouseUp;

  // Handle mouse leave on canvas
  const handleCanvasMouseLeave = useCallback(() => {
    if (isDrawing) {
      handleCanvasMouseUp();
    }
    if (isSelecting) {
      setIsSelecting(false);
      selectionStartRef.current = null;
    }
  }, [isDrawing, isSelecting, handleCanvasMouseUp]);

  // Keep refs updated with latest handlers
  handleCanvasMouseLeaveRef.current = handleCanvasMouseLeave;

  // Swap primary and secondary colors
  const swapColors = useCallback(() => {
    const temp = primaryColor;
    setPrimaryColor(secondaryColor);
    setSecondaryColor(temp);
  }, [primaryColor, secondaryColor]);

  // Render file tree recursively
  const renderFileTree = (nodes: FileNode[], level = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const paddingLeft = level * 16 + 8;

      if (node.type === 'file') {
        const isSelected = selectedFile?.path === node.path;
        const isModified = modifiedImages.has(node.path);
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
            {isModified && (
              <span className="w-2 h-2 rounded-full bg-warning flex-shrink-0" title="Modified" />
            )}
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
            onClick={() => queryClient.invalidateQueries({ queryKey: ['file-tree', imageSession?.sessionId] })}
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
            ) : treeError ? (
              <div className="px-3 py-4 text-sm text-center">
                <div className="text-error mb-2">⚠️ Failed to load files</div>
                <div className="text-base-content/70 text-xs">
                  {treeError.message?.toLowerCase().includes('session not found') || treeError.message?.includes('session_not_found')
                    ? 'Session not found in storage. The AI may still be processing files.'
                    : treeError.message || 'Unknown error'}
                </div>
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
    const colorPalette = [
      '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
      '#880000', '#008800', '#000088', '#888800', '#880088', '#008888', '#888888', '#444444',
      '#FF8800', '#88FF00', '#0088FF', '#FF0088', '#8800FF', '#00FF88', '#FFCC00', '#CC00FF',
      '#FF4444', '#44FF44', '#4444FF', '#FFFF44', '#FF44FF', '#44FFFF', '#AAAAAA', '#666666'
    ];

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
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer"
                    title="Pick custom color"
                  />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-8 h-8 rounded border-2 border-base-content cursor-pointer hover:scale-105 transition-transform"
                    style={{ backgroundColor: primaryColor }}
                    title={`Primary: ${primaryColor}`}
                  ></div>
                  <div
                    className="w-8 h-8 rounded border border-base-300 cursor-pointer hover:scale-105 transition-transform"
                    style={{ backgroundColor: secondaryColor }}
                    title={`Secondary: ${secondaryColor}`}
                  ></div>
                  <button onClick={swapColors} className="btn btn-xs btn-ghost ml-auto">Swap</button>
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {colorPalette.map((color) => (
                    <button
                      key={color}
                      onClick={() => setPrimaryColor(color)}
                      onContextMenu={(e) => { e.preventDefault(); setSecondaryColor(color); }}
                      className={`w-5 h-5 rounded border hover:scale-110 transition-transform ${
                        primaryColor === color ? 'border-2 border-base-content' : 'border-base-300'
                      }`}
                      style={{ backgroundColor: color }}
                      title={`${color} (right-click for secondary)`}
                    />
                  ))}
                </div>
              </div>

              {/* Brush */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3">Brush</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Size: {brushSize}px</label>
                    <input
                      type="range"
                      min="1"
                      max="64"
                      value={brushSize}
                      onChange={(e) => setBrushSize(parseInt(e.target.value))}
                      className="range range-xs range-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-base-content/70 mb-1 block">Opacity: {brushOpacity}%</label>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={brushOpacity}
                      onChange={(e) => setBrushOpacity(parseInt(e.target.value))}
                      className="range range-xs range-primary"
                    />
                  </div>
                </div>
              </div>

              {/* Current Tool Info */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3">Current Tool</div>
                <div className="bg-base-200 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="capitalize font-medium">{currentTool}</span>
                  </div>
                  <div className="text-xs text-base-content/60 mt-1">
                    {currentTool === 'select' && 'Click and drag to select a region'}
                    {currentTool === 'pencil' && 'Click and drag to draw lines'}
                    {currentTool === 'brush' && 'Click and drag to paint with soft edges'}
                    {currentTool === 'fill' && 'Click to fill an area with color'}
                    {currentTool === 'eraser' && 'Click and drag to erase'}
                    {currentTool === 'rectangle' && 'Click and drag to draw a rectangle'}
                    {currentTool === 'circle' && 'Click and drag to draw an ellipse'}
                    {currentTool === 'line' && 'Click and drag to draw a line'}
                  </div>
                </div>
              </div>

              {/* Selection Info */}
              {selection && (
                <div className="pt-4 border-t border-base-300">
                  <div className="font-semibold text-base-content mb-3 flex items-center justify-between">
                    Selection
                    <button onClick={() => setSelection(null)} className="btn btn-xs btn-ghost text-error">Clear</button>
                  </div>
                  <div className="text-xs text-base-content/70 space-y-1">
                    <div>Position: {Math.round(selection.x)}, {Math.round(selection.y)}</div>
                    <div>Size: {Math.round(selection.width)} x {Math.round(selection.height)}</div>
                  </div>
                </div>
              )}

              {/* History Info */}
              <div className="pt-4 border-t border-base-300">
                <div className="font-semibold text-base-content mb-3">History</div>
                <div className="text-xs text-base-content/70">
                  <div>Step {historyIndex + 1} of {canvasHistory.length}</div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleUndo}
                      disabled={historyIndex <= 0}
                      className="btn btn-xs btn-outline flex-1"
                    >
                      Undo
                    </button>
                    <button
                      onClick={handleRedo}
                      disabled={historyIndex >= canvasHistory.length - 1}
                      className="btn btn-xs btn-outline flex-1"
                    >
                      Redo
                    </button>
                  </div>
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

  // Memoized editor content to prevent canvas from being recreated on re-renders
  // This is critical - without useMemo, every state change recreates the canvas elements
  const editorContent = useMemo(() => {
    // Calculate display dimensions based on zoom
    const displayWidth = canvasDimensions ? (canvasDimensions.width * canvasZoom / 100) : 384;
    const displayHeight = canvasDimensions ? (canvasDimensions.height * canvasZoom / 100) : 384;

    return (
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
          {canvasDimensions && (
            <div className="text-xs text-base-content/50">
              {canvasDimensions.width} x {canvasDimensions.height}
            </div>
          )}
          <div className="flex-1 flex gap-1 ml-4">
            {/* Drawing Tools */}
            <button onClick={() => setCurrentTool('select')} className={`btn btn-xs btn-square ${currentTool === 'select' ? 'btn-primary' : 'btn-ghost'}`} title="Select (S)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h2v2H3V3zm4 0h2v2H7V3zm4 0h2v2h-2V3zm4 0h2v2h-2V3zm4 0h2v2h-2V3zm0 4h2v2h-2V7zM3 7h2v2H3V7zm0 4h2v2H3v-2zm0 4h2v2H3v-2zm0 4h2v2H3v-2zm4 0h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2zm0-4h2v2h-2v-2zm0-4h2v2h-2v-2z"/></svg>
            </button>
            <button onClick={() => setCurrentTool('pencil')} className={`btn btn-xs btn-square ${currentTool === 'pencil' ? 'btn-primary' : 'btn-ghost'}`} title="Pencil (P)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>
            <button onClick={() => setCurrentTool('brush')} className={`btn btn-xs btn-square ${currentTool === 'brush' ? 'btn-primary' : 'btn-ghost'}`} title="Brush (B)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34c-.39-.39-1.02-.39-1.41 0L9 12.25 11.75 15l8.96-8.96c.39-.39.39-1.02 0-1.41z"/></svg>
            </button>
            <button onClick={() => setCurrentTool('fill')} className={`btn btn-xs btn-square ${currentTool === 'fill' ? 'btn-primary' : 'btn-ghost'}`} title="Fill (G)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16.56 8.94L7.62 0 6.21 1.41l2.38 2.38-5.15 5.15c-.59.59-.59 1.54 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10L10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5c0 1.1.9 2 2 2s2-.9 2-2c0-1.33-2-3.5-2-3.5z"/></svg>
            </button>
            <button onClick={() => setCurrentTool('eraser')} className={`btn btn-xs btn-square ${currentTool === 'eraser' ? 'btn-primary' : 'btn-ghost'}`} title="Eraser (E)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.008 4.008 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-6.36-6.36-3.54 3.53c-.78.79-.78 2.05 0 2.83z"/></svg>
            </button>
            <div className="divider divider-horizontal mx-1"></div>
            <button onClick={() => setCurrentTool('rectangle')} className={`btn btn-xs btn-square ${currentTool === 'rectangle' ? 'btn-primary' : 'btn-ghost'}`} title="Rectangle (R)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" strokeWidth="2"/></svg>
            </button>
            <button onClick={() => setCurrentTool('circle')} className={`btn btn-xs btn-square ${currentTool === 'circle' ? 'btn-primary' : 'btn-ghost'}`} title="Circle (C)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth="2"/></svg>
            </button>
            <button onClick={() => setCurrentTool('line')} className={`btn btn-xs btn-square ${currentTool === 'line' ? 'btn-primary' : 'btn-ghost'}`} title="Line (L)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="4" y1="20" x2="20" y2="4" strokeWidth="2"/></svg>
            </button>
            <div className="divider divider-horizontal mx-1"></div>
            <button onClick={handleUndo} disabled={historyIndex <= 0} className="btn btn-xs btn-square btn-ghost" title="Undo (Ctrl+Z)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
            </button>
            <button onClick={handleRedo} disabled={historyIndex >= canvasHistory.length - 1} className="btn btn-xs btn-square btn-ghost" title="Redo (Ctrl+Y)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
            </button>
          </div>
          <button
            onClick={handleSaveImage}
            disabled={isSavingImage || !selectedFile || !imageSession}
            className="btn btn-sm btn-primary gap-2"
          >
            {isSavingImage ? (
              <span className="loading loading-spinner loading-xs"></span>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>
            )}
            {isSavingImage ? 'Saving...' : 'Save'}
          </button>
          <button className="btn btn-sm btn-outline gap-2">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M19 12v7H5v-7H3v7c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zm-6 .67l2.59-2.58L17 11.5l-5 5-5-5 1.41-1.41L11 12.67V3h2z"/></svg>
            Export
          </button>

          {/* Modified files count and Commit button */}
          <div className="flex items-center gap-2 pl-2 border-l border-base-300 ml-2">
            {modifiedImages.size > 0 && (
              <div className="badge badge-warning badge-sm" title={`${modifiedImages.size} image(s) with uncommitted changes`}>
                {modifiedImages.size} modified
              </div>
            )}

            <button
              onClick={commitChanges}
              disabled={modifiedImages.size === 0 || commitStatus === 'committing'}
              className="btn btn-sm btn-secondary gap-1"
              title="Commit changes"
            >
              {commitStatus === 'committing' ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Committing...
                </>
              ) : commitStatus === 'committed' ? (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Committed!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Commit
                </>
              )}
            </button>
          </div>
        </div>

        {/* Canvas Area */}
        <div ref={canvasContainerRef} className="flex-1 flex items-center justify-center bg-base-200 p-4 min-h-0 overflow-auto relative">
          {/* Zoom controls - positioned at top-right of canvas area */}
          <div className="absolute top-2 right-2 z-10 bg-base-100 px-3 py-1 rounded-lg shadow text-sm text-base-content/70 flex items-center gap-2">
            <button
              onClick={() => {
                // Calculate fit zoom
                if (canvasContainerRef.current && canvasDimensions) {
                  const containerRect = canvasContainerRef.current.getBoundingClientRect();
                  const availableWidth = containerRect.width - 80;
                  const availableHeight = containerRect.height - 80;
                  const scaleX = availableWidth / canvasDimensions.width;
                  const scaleY = availableHeight / canvasDimensions.height;
                  const fitScale = Math.min(scaleX, scaleY, 1);
                  const fitZoom = Math.round(fitScale * 1000) / 10;
                  setCanvasZoom(Math.max(10, Math.min(fitZoom, 100)));
                }
              }}
              className="btn btn-xs btn-ghost"
              title="Fit to screen"
            >
              Fit
            </button>
            <button
              onClick={() => setCanvasZoom(100)}
              className="btn btn-xs btn-ghost"
              title="Reset to 100%"
            >
              1:1
            </button>
            <div className="w-px h-4 bg-base-300"></div>
            <button
              onClick={() => setCanvasZoom(Math.max(10, canvasZoom - 10))}
              className="btn btn-xs btn-ghost btn-circle"
              disabled={canvasZoom <= 10}
            >
              -
            </button>
            <span className="min-w-[48px] text-center">{Math.round(canvasZoom * 10) / 10}%</span>
            <button
              onClick={() => setCanvasZoom(Math.min(400, canvasZoom + 10))}
              className="btn btn-xs btn-ghost btn-circle"
              disabled={canvasZoom >= 400}
            >
              +
            </button>
          </div>

          <div className="relative">
            <div className="bg-white rounded shadow-lg p-4">
              {/* Checkered background container */}
              <div
                className="relative"
                style={{
                  width: displayWidth,
                  height: displayHeight,
                  backgroundImage: 'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
                  backgroundSize: '16px 16px',
                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px'
                }}
              >
                {/* Loading state */}
                {isLoadingImage && (
                  <div className="absolute inset-0 flex items-center justify-center bg-base-200/50 z-20">
                    <div className="flex flex-col items-center gap-2">
                      <span className="loading loading-spinner loading-lg"></span>
                      <span className="text-sm text-base-content/70">Loading image...</span>
                    </div>
                  </div>
                )}

                {/* Base canvas (image layer) */}
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0"
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    imageRendering: 'pixelated'
                  }}
                />

                {/* Drawing layer canvas */}
                <canvas
                  ref={drawingLayerRef}
                  className="absolute inset-0"
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    imageRendering: 'pixelated',
                    cursor: currentTool === 'select' ? 'crosshair' :
                            currentTool === 'fill' ? 'cell' :
                            'crosshair'
                  }}
                  onMouseDown={(e) => handleCanvasMouseDownRef.current(e)}
                  onMouseMove={(e) => handleCanvasMouseMoveRef.current(e)}
                  onMouseUp={() => handleCanvasMouseUpRef.current()}
                  onMouseLeave={() => handleCanvasMouseLeaveRef.current()}
                />

                {/* Selection overlay */}
                {selection && (
                  <div
                    className="absolute pointer-events-none border-2 border-dashed border-primary bg-primary/10"
                    style={{
                      left: selection.x * canvasZoom / 100,
                      top: selection.y * canvasZoom / 100,
                      width: selection.width * canvasZoom / 100,
                      height: selection.height * canvasZoom / 100,
                      animation: 'marching-ants 0.5s linear infinite'
                    }}
                  >
                    {/* Selection handles */}
                    <div className="absolute -left-1 -top-1 w-2 h-2 bg-primary border border-white"></div>
                    <div className="absolute -right-1 -top-1 w-2 h-2 bg-primary border border-white"></div>
                    <div className="absolute -left-1 -bottom-1 w-2 h-2 bg-primary border border-white"></div>
                    <div className="absolute -right-1 -bottom-1 w-2 h-2 bg-primary border border-white"></div>
                  </div>
                )}

                {/* Empty state when no image */}
                {!imageUrl && !isLoadingImage && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center text-base-content/50">
                      <svg className="w-16 h-16 mx-auto mb-2 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                      </svg>
                      <p className="text-sm">No image loaded</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Current tool indicator */}
            <div className="absolute top-2 left-2 bg-base-100 px-2 py-1 rounded shadow text-xs text-base-content/70 flex items-center gap-1">
              <span className="capitalize">{currentTool}</span>
              {currentTool !== 'select' && currentTool !== 'fill' && (
                <span className="text-base-content/50">• {brushSize}px</span>
              )}
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
  // Only recreate when these specific values change - NOT isDrawing or other transient state
  // Event handlers are accessed via refs so they don't need to be in dependencies
  }, [canvasDimensions, canvasZoom, selectedFile?.name, currentTool, brushSize, selection, imageUrl, isLoadingImage, aiPrompt, isGenerating, handleAiSubmit, handleUndo, handleRedo, historyIndex, canvasHistory.length, setCurrentTool]);

  // Main content based on state
  const renderMainContent = () => {
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
    // Use the memoized editor content
    return editorContent;
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
          <h1 className="text-3xl font-bold text-base-content mb-2">New Image Session</h1>
          <p className="text-base-content/70">
            Select a repository to browse and edit images. A new branch will be created for your changes:
            <code className="ml-2 px-2 py-1 bg-base-200 rounded text-sm">
              webedt/image-editor-{'{id}'}
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
          {renderMainContent()}
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

  // Create PR actions for the top bar (similar to Code.tsx)
  const prActions = imageSession && imageSession.branch && imageSession.baseBranch && (
    <>
      {/* View PR button - show only if PR is open */}
      {existingPr && (
        <button
          onClick={handleViewPR}
          className="btn btn-xs btn-info"
          title={`View open PR #${existingPr.number}`}
        >
          View PR #{existingPr.number}
        </button>
      )}

      {/* PR Merged button - show when PR was already merged */}
      {!existingPr && mergedPr && (
        <button
          onClick={() => window.open(mergedPr.htmlUrl, '_blank')}
          className="btn btn-xs btn-success"
          title={`PR #${mergedPr.number} was merged`}
        >
          PR #{mergedPr.number} Merged
        </button>
      )}

      {/* Create PR button - show if no open PR exists and not merged */}
      {!existingPr && !mergedPr && (
        <button
          onClick={handleCreatePR}
          className="btn btn-xs btn-primary"
          disabled={prLoading !== null}
          title="Create a pull request"
        >
          {prLoading === 'create' ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            'Create PR'
          )}
        </button>
      )}

      {/* Auto PR button - show even if PR exists (backend reuses it), hide when PR already merged */}
      {!mergedPr && (
        <button
          onClick={handleAutoPR}
          className="btn btn-xs btn-accent"
          disabled={prLoading !== null}
          title="Create PR, merge base branch, and merge PR in one click"
        >
          {prLoading === 'auto' ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            'Auto PR'
          )}
        </button>
      )}
    </>
  );

  // Construct the repository URL for SessionLayout
  const selectedRepoUrl = imageSession ? `https://github.com/${imageSession.owner}/${imageSession.repo}.git` : undefined;

  // Create a session-like object for SessionLayout if we have an imageSession
  const sessionForLayout = imageSession && existingSessionData?.data ? existingSessionData.data : undefined;

  const content = (
    <>
      {getMainView()}
      <NewImageModal />
    </>
  );

  // When embedded in split view, render without SessionLayout wrapper
  if (isEmbedded) {
    return content;
  }

  // Normal rendering with SessionLayout
  return (
    <SessionLayout
      selectedRepo={selectedRepoUrl}
      baseBranch={imageSession?.baseBranch}
      branch={imageSession?.branch}
      isLocked={!!imageSession}
      prActions={prActions}
      session={sessionForLayout}
    >
      {content}
    </SessionLayout>
  );
}

interface ImagesProps {
  isEmbedded?: boolean;
}

export default function Images({ isEmbedded: isEmbeddedProp = false }: ImagesProps) {
  // Check if we're embedded via context (from split view) or prop
  const { isEmbedded: isEmbeddedContext } = useEmbedded();
  const isEmbedded = isEmbeddedProp || isEmbeddedContext;

  return <ImagesContent isEmbedded={isEmbedded} />;
}
