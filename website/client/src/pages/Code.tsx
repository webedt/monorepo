import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import SyntaxHighlightedEditor from '@/components/SyntaxHighlightedEditor';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import { githubApi, sessionsApi, storageWorkerApi } from '@/lib/api';
import { useEditorSessionStore } from '@/lib/store';
import type { GitHubPullRequest } from '@/shared';

// Debounce utility
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

// Track pending changes per file
interface PendingChange {
  content: string;
  originalContent: string;
  sha?: string;
  deleted?: boolean;  // Track if file is marked for deletion
}

// File operation state for modals
interface FileOperationState {
  type: 'rename' | 'delete' | 'create' | null;
  itemType: 'file' | 'folder' | null;
  path: string;  // For create, this is the parent folder path (empty string for root)
  name: string;
}

interface PreSelectedSettings {
  repositoryUrl?: string;
  baseBranch?: string;
}

type FileNode = {
  name: string;
  path: string;
  type: 'file';
  icon: string;
};

type FolderNode = {
  name: string;
  path: string;
  type: 'folder';
  children: TreeNode[];
};

type TreeNode = FileNode | FolderNode;

// Tab type for the editor
interface EditorTab {
  path: string;
  name: string;
  isPreview: boolean; // Preview tabs are shown in italics and replaced by next preview
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

interface CodeSession {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
  sessionId?: string; // Database session ID for tracking
}

// Helper to check if a file is an image based on extension
const isImageFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff', 'tif'];
  return imageExtensions.includes(ext || '');
};

// Helper to check if a file is an audio file based on extension
const isAudioFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const audioExtensions = ['wav', 'mp3', 'ogg', 'aac', 'flac', 'm4a', 'webm', 'aiff', 'aif'];
  return audioExtensions.includes(ext || '');
};

// Helper to check if a file is a markdown file based on extension
const isMarkdownFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ['md', 'mdx', 'markdown'].includes(ext || '');
};

// Helper to get file icon based on extension
const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    js: '🟨',
    jsx: '⚛️',
    ts: '🔷',
    tsx: '⚛️',
    css: '🎨',
    scss: '🎨',
    sass: '🎨',
    less: '🎨',
    html: '🌐',
    htm: '🌐',
    json: '📦',
    md: '📝',
    mdx: '📝',
    py: '🐍',
    rb: '💎',
    go: '🔵',
    rs: '🦀',
    java: '☕',
    kt: '🟣',
    swift: '🍎',
    c: '🔵',
    cpp: '🔵',
    h: '🔵',
    hpp: '🔵',
    cs: '🟣',
    php: '🐘',
    vue: '💚',
    svelte: '🔶',
    yaml: '📋',
    yml: '📋',
    toml: '📋',
    xml: '📋',
    svg: '🖼️',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    webp: '🖼️',
    ico: '🖼️',
    sh: '💻',
    bash: '💻',
    zsh: '💻',
    fish: '💻',
    sql: '🗃️',
    graphql: '💠',
    gql: '💠',
    dockerfile: '🐳',
    gitignore: '📁',
    env: '🔐',
    lock: '🔒',
  };
  return iconMap[ext || ''] || '📄';
};

// Transform storage-worker file list to our TreeNode format
const transformStorageFiles = (files: { path: string; size: number; type: 'file' | 'directory' }[], repoName?: string): TreeNode[] => {
  const root: FolderNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Build the prefix to strip: workspace/ and optionally the repo name folder
  // This removes the duplicate root folder when the repo folder matches the repo name
  const prefixToStrip = repoName ? `workspace/${repoName}/` : 'workspace/';
  const altPrefixToStrip = 'workspace/'; // Fallback for files not under repo folder

  // Filter out non-workspace files (like .session-metadata.json, .stream-events.jsonl)
  // and extract paths from workspace/<repo>/ prefix
  const workspaceFiles = files
    .filter(f => f.path.startsWith('workspace/') && !f.path.includes('.session-metadata') && !f.path.includes('.stream-events'))
    .map(f => {
      // Try to strip the full prefix (workspace/repoName/)
      // If that doesn't match, fall back to just stripping workspace/
      let newPath = f.path;
      if (repoName && f.path.startsWith(prefixToStrip)) {
        newPath = f.path.replace(prefixToStrip, '');
      } else if (f.path.startsWith(altPrefixToStrip)) {
        // For files directly under workspace/ or with different structure
        newPath = f.path.replace(altPrefixToStrip, '');
        // Also strip the repo name if it's the first path segment
        if (repoName && newPath.startsWith(repoName + '/')) {
          newPath = newPath.replace(repoName + '/', '');
        } else if (repoName && newPath === repoName) {
          newPath = ''; // The repo folder itself becomes empty
        }
      }
      return { ...f, path: newPath };
    })
    .filter(f => f.path && f.path !== ''); // Remove empty paths

  // Sort items: directories first, then alphabetically
  const sortedFiles = [...workspaceFiles].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sortedFiles) {
    const pathParts = item.path.split('/').filter(p => p); // Filter empty parts
    if (pathParts.length === 0) continue;

    let currentLevel = root;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const currentPath = pathParts.slice(0, i + 1).join('/');
      const isLastPart = i === pathParts.length - 1;

      if (isLastPart) {
        if (item.type === 'file') {
          // It's a file
          currentLevel.children.push({
            name: part,
            path: currentPath,
            type: 'file',
            icon: getFileIcon(part),
          });
        } else {
          // It's a directory - only add if not already exists
          const existing = currentLevel.children.find(
            c => c.type === 'folder' && c.name === part
          );
          if (!existing) {
            currentLevel.children.push({
              name: part,
              path: currentPath,
              type: 'folder',
              children: [],
            });
          }
        }
      } else {
        // Navigate to or create intermediate folder
        let folder = currentLevel.children.find(
          c => c.type === 'folder' && c.name === part
        ) as FolderNode | undefined;

        if (!folder) {
          folder = { name: part, path: currentPath, type: 'folder', children: [] };
          currentLevel.children.push(folder);
        }
        currentLevel = folder;
      }
    }
  }

  return root.children;
};


// Props for split view support
interface CodeProps {
  sessionId?: string;
  /** When true, renders without SessionLayout wrapper (for split view) */
  isEmbedded?: boolean;
}

export default function Code({ sessionId: sessionIdProp, isEmbedded = false }: CodeProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  const sessionId = sessionIdProp ?? sessionIdParam;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Editor session state persistence
  const { saveEditorState, getEditorState } = useEditorSessionStore();
  const hasRestoredState = useRef(false);

  // Get pre-selected settings from navigation state (from QuickSessionSetup)
  const preSelectedSettings = (location.state as { preSelectedSettings?: PreSelectedSettings } | null)?.preSelectedSettings;
  const hasInitializedFromPreSelected = useRef(false);

  // Code session state
  const [codeSession, setCodeSession] = useState<CodeSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isFromExistingSession, setIsFromExistingSession] = useState(false);

  // PR-related state
  const [prLoading, setPrLoading] = useState<'create' | 'auto' | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSuccess, setPrSuccess] = useState<string | null>(null);
  const [autoPrProgress, setAutoPrProgress] = useState<string | null>(null);

  // File explorer state
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // File selection state for multi-select
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);

  // Image preview state
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // Audio preview state
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Markdown preview mode state
  const [isMarkdownPreviewMode, setIsMarkdownPreviewMode] = useState(false);

  // Track pending click for single/double click distinction
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Editor state - tracking changes and save status
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [commitStatus, setCommitStatus] = useState<'idle' | 'committing' | 'committed' | 'error'>('idle');
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editHistory, setEditHistory] = useState<Map<string, string[]>>(new Map());
  const [historyIndex, setHistoryIndex] = useState<Map<string, number>>(new Map());

  // File operation state for rename/delete modals
  const [fileOperation, setFileOperation] = useState<FileOperationState>({
    type: null,
    itemType: null,
    path: '',
    name: '',
  });
  const [newName, setNewName] = useState('');
  const [isOperating, setIsOperating] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  // Fetch existing session if sessionId is provided
  const { data: existingSessionData, isLoading: isLoadingExistingSession } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => sessionsApi.get(sessionId!),
    enabled: !!sessionId,
  });

  // Set code session from existing session data
  useEffect(() => {
    if (existingSessionData?.data) {
      const session = existingSessionData.data;
      // Only set if we have the required fields
      if (session.repositoryOwner && session.repositoryName && session.branch) {
        setCodeSession({
          owner: session.repositoryOwner,
          repo: session.repositoryName,
          branch: session.branch,
          baseBranch: session.baseBranch || 'main',
          sessionId: session.id, // Include the session ID for message logging
        });
        setIsFromExistingSession(true);
      }
    }
  }, [existingSessionData]);

  // Fetch user's GitHub repos (only when no existing session, needed for quick-setup auto-init)
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['github-repos'],
    queryFn: githubApi.getRepos,
    enabled: !sessionId && !!preSelectedSettings?.repositoryUrl, // Only fetch repos for quick-setup flow
  });

  const repos: GitHubRepo[] = reposData?.data || [];

  // Auto-initialize from pre-selected settings (from QuickSessionSetup)
  useEffect(() => {
    // Only run once when we have pre-selected settings and repos are loaded
    if (
      preSelectedSettings?.repositoryUrl &&
      repos.length > 0 &&
      !hasInitializedFromPreSelected.current &&
      !codeSession &&
      !sessionId
    ) {
      hasInitializedFromPreSelected.current = true;

      // Find the matching repo
      const matchingRepo = repos.find(r => r.cloneUrl === preSelectedSettings.repositoryUrl);
      if (matchingRepo) {
        // Initialize with the pre-selected repo and branch
        initializeCodeSessionFromQuickSetup(matchingRepo, preSelectedSettings.baseBranch);
      }
    }
  }, [preSelectedSettings, repos, codeSession, sessionId]);

  // Fetch file tree from storage-worker only
  // NOTE: Storage-worker uses the database session ID as the storage key
  const { data: storageFiles, isLoading: isLoadingTree, error: treeError } = useQuery({
    queryKey: ['file-tree', codeSession?.sessionId],
    queryFn: async () => {
      const storageSessionId = codeSession?.sessionId;

      if (!storageSessionId) {
        console.warn('[Code] Query ran without session ID - returning empty');
        return [];
      }

      console.log('[Code] Fetching file tree from storage-worker:', storageSessionId);

      try {
        const files = await storageWorkerApi.listFiles(storageSessionId);
        console.log('[Code] Found files in storage-worker:', files.length);
        // Debug: log sample paths to diagnose filtering issues
        if (files.length > 0) {
          console.log('[Code] Sample file paths:', files.slice(0, 5).map(f => f.path));
        }
        return files;
      } catch (storageError) {
        console.error('[Code] Failed to fetch from storage-worker:', storageError);
        return [];
      }
    },
    enabled: !!codeSession?.sessionId,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });

  // Transform the files into our TreeNode format
  const fileTree = useMemo(() => {
    if (!storageFiles || storageFiles.length === 0) return [];
    const tree = transformStorageFiles(storageFiles, codeSession?.repo);
    console.log('[Code] Transformed file tree:', tree.length, 'root items');
    return tree;
  }, [storageFiles, codeSession?.repo]);

  // Query to check for existing PR (for code sessions)
  const { data: prData, refetch: refetchPr } = useQuery({
    queryKey: ['pr', codeSession?.owner, codeSession?.repo, codeSession?.branch],
    queryFn: async () => {
      if (!codeSession?.owner || !codeSession?.repo || !codeSession?.branch) {
        return null;
      }
      const response = await githubApi.getPulls(
        codeSession.owner,
        codeSession.repo,
        codeSession.branch,
        codeSession.baseBranch || undefined
      );
      return response.data as GitHubPullRequest[];
    },
    enabled: !!codeSession?.owner && !!codeSession?.repo && !!codeSession?.branch,
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

  // Initialize Code session from QuickSessionSetup (with pre-selected repo and branch)
  const initializeCodeSessionFromQuickSetup = async (repo: GitHubRepo, selectedBranch?: string) => {
    setIsInitializing(true);
    setInitError(null);

    const [owner, repoName] = repo.fullName.split('/');
    const baseBranch = selectedBranch || repo.defaultBranch;

    // Generate random ID for branch
    const randomId = Math.random().toString(36).substring(2, 10);
    const branchName = `webedt/started-from-code-${randomId}`;

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
        title: `Code: ${owner}/${repoName}`,
        repositoryUrl: repo.cloneUrl,
        repositoryOwner: owner,
        repositoryName: repoName,
        baseBranch,
        branch: branchName,
      });

      const dbSessionId = sessionResponse.data.sessionId;

      // Note: Server already creates an initial user message when creating the code session
      // No need to log a duplicate session start event here

      setCodeSession({
        owner,
        repo: repoName,
        branch: branchName,
        baseBranch,
        sessionId: dbSessionId,
      });
      setIsFromExistingSession(false);

      // Navigate to the session URL
      navigate(`/session/${dbSessionId}/code`, { replace: true });

      // Expand root folders by default
      setExpandedFolders(new Set());
    } catch (error: any) {
      console.error('Failed to create branch:', error);
      setInitError(error.message || 'Failed to create branch');
    } finally {
      setIsInitializing(false);
    }
  };

  // Load file content from storage-worker or GitHub API when a file is selected
  const loadFileContent = useCallback(async (path: string) => {
    if (!codeSession) return;

    // Clear previous media URLs when loading a new file
    setImageUrl(null);
    setAudioUrl(null);

    // Reset markdown preview mode when switching files
    setIsMarkdownPreviewMode(false);

    // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
    const storageSessionId = codeSession.sessionId;
    const repoName = codeSession.repo;

    if (!storageSessionId) {
      setFileContent(`// Error: No session ID available`);
      return;
    }

    // Build the full storage path including repo name
    const storagePath = repoName ? `workspace/${repoName}/${path}` : `workspace/${path}`;

    // Check if this is an image file
    if (isImageFile(path)) {
      setIsLoadingFile(true);
      setFileContent(null); // Clear text content for images
      try {
        const blob = await storageWorkerApi.getFileBlob(storageSessionId, storagePath);
        if (blob) {
          const url = URL.createObjectURL(blob);
          setImageUrl(url);
        } else {
          console.error(`[Code] Image not found: ${path}`);
          setFileContent(`// Error: Image not found in storage`);
        }
      } catch (error: any) {
        console.error('Failed to load image:', error);
        setFileContent(`// Error loading image: ${error.message}`);
      } finally {
        setIsLoadingFile(false);
      }
      return;
    }

    // Check if this is an audio file
    if (isAudioFile(path)) {
      setIsLoadingFile(true);
      setFileContent(null); // Clear text content for audio
      try {
        const blob = await storageWorkerApi.getFileBlob(storageSessionId, storagePath);
        if (blob) {
          const url = URL.createObjectURL(blob);
          setAudioUrl(url);
        } else {
          console.error(`[Code] Audio file not found: ${path}`);
          setFileContent(`// Error: Audio file not found in storage`);
        }
      } catch (error: any) {
        console.error('Failed to load audio:', error);
        setFileContent(`// Error loading audio: ${error.message}`);
      } finally {
        setIsLoadingFile(false);
      }
      return;
    }

    // Check if we have pending changes for this file - use those instead of fetching
    const existingChange = pendingChanges.get(path);
    if (existingChange) {
      setFileContent(existingChange.content);
      return;
    }

    setIsLoadingFile(true);
    try {
      console.log('[Code] Fetching file from storage-worker:', path);
      const content = await storageWorkerApi.getFileText(storageSessionId, storagePath);

      if (content === null) {
        // File not found
        console.error(`[Code] File not found: ${path}`);
        setFileContent(`// Error: File not found`);
      } else {
        setFileContent(content);

        // Initialize edit history for this file
        setEditHistory(prev => {
          const next = new Map(prev);
          if (!next.has(path)) {
            next.set(path, [content]);
          }
          return next;
        });
        setHistoryIndex(prev => {
          const next = new Map(prev);
          if (!next.has(path)) {
            next.set(path, 0);
          }
          return next;
        });

        // Store the original content for later comparison (no sha needed for storage-worker)
        setPendingChanges(prev => {
          const next = new Map(prev);
          next.set(path, { content, originalContent: content });
          return next;
        });
      }
    } catch (error: any) {
      console.error('Failed to load file:', error);
      setFileContent(`// Error loading file: ${error.message}`);
    } finally {
      setIsLoadingFile(false);
    }
  }, [codeSession, pendingChanges]);

  // Cleanup object URLs for images when component unmounts or image changes
  useEffect(() => {
    return () => {
      // Revoke any blob URL to prevent memory leaks
      if (imageUrl && imageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  // Cleanup object URLs for audio when component unmounts or audio changes
  useEffect(() => {
    return () => {
      // Revoke any blob URL to prevent memory leaks
      if (audioUrl && audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // Restore editor state (tabs, active tab, expanded folders, pending changes) from localStorage
  useEffect(() => {
    if (sessionId && !hasRestoredState.current) {
      const savedState = getEditorState(sessionId);
      if (savedState) {
        hasRestoredState.current = true;
        setTabs(savedState.tabs);
        setActiveTabPath(savedState.activeTabPath);
        setExpandedFolders(new Set(savedState.expandedFolders));

        // Restore pending changes (convert object back to Map)
        if (savedState.pendingChanges) {
          const restoredChanges = new Map<string, PendingChange>();
          Object.entries(savedState.pendingChanges).forEach(([key, value]) => {
            restoredChanges.set(key, value);
          });
          setPendingChanges(restoredChanges);
        }
      }
    }
  }, [sessionId, getEditorState]);

  // Load active tab content when code session becomes available (after state restoration)
  useEffect(() => {
    if (codeSession && activeTabPath && hasRestoredState.current) {
      // Check if we have pending changes for this file - use those instead of fetching
      const existingChange = pendingChanges.get(activeTabPath);
      if (existingChange) {
        setFileContent(existingChange.content);
      } else {
        loadFileContent(activeTabPath);
      }
    }
    // Only run when codeSession becomes available, not on every activeTabPath change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeSession]);

  // Save editor state whenever tabs, activeTabPath, expandedFolders, or pendingChanges change
  useEffect(() => {
    if (sessionId && (tabs.length > 0 || activeTabPath || expandedFolders.size > 0 || pendingChanges.size > 0)) {
      saveEditorState(sessionId, tabs, activeTabPath, expandedFolders, pendingChanges);
    }
  }, [sessionId, tabs, activeTabPath, expandedFolders, pendingChanges, saveEditorState]);

  // Open file as preview tab (single-click behavior)
  const openAsPreview = (path: string, name: string) => {
    // If the file is already open, just switch to it
    const existingTab = tabs.find(tab => tab.path === path);
    if (existingTab) {
      setActiveTabPath(path);
      loadFileContent(path);
      return;
    }

    // Replace existing preview tab with new preview, or add new preview tab
    setTabs(prevTabs => {
      const nonPreviewTabs = prevTabs.filter(tab => !tab.isPreview);
      return [...nonPreviewTabs, { path, name, isPreview: true }];
    });
    setActiveTabPath(path);
    loadFileContent(path);
  };

  // Open file as permanent tab (double-click behavior)
  const openAsPermanent = (path: string, name: string) => {
    // Check if already open as a tab
    const existingTab = tabs.find(tab => tab.path === path);

    if (existingTab) {
      // If it's a preview tab, convert it to permanent
      if (existingTab.isPreview) {
        setTabs(prevTabs =>
          prevTabs.map(tab =>
            tab.path === path ? { ...tab, isPreview: false } : tab
          )
        );
      }
    } else {
      // Close any preview tab and add this as a permanent tab
      setTabs(prevTabs => {
        const nonPreviewTabs = prevTabs.filter(tab => !tab.isPreview);
        return [...nonPreviewTabs, { path, name, isPreview: false }];
      });
    }

    setActiveTabPath(path);
    loadFileContent(path);
  };

  // Handle click on file - uses timeout to distinguish single vs double click
  // Also handles file selection for multi-select (ctrl+click, shift+click)
  const handleFileClick = (path: string, name: string, event: React.MouseEvent) => {
    // Handle selection (ctrl+click, shift+click, or regular click)
    handleFileSelect(path, name, event);

    // Clear any pending single-click action
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    // Don't open file on ctrl/cmd+click or shift+click (only select)
    const isModifierClick = event.ctrlKey || event.metaKey || event.shiftKey;
    if (isModifierClick) {
      return;
    }

    // Delay single-click action to allow double-click to cancel it
    clickTimeoutRef.current = setTimeout(() => {
      openAsPreview(path, name);
      clickTimeoutRef.current = null;
    }, 200); // 200ms delay to detect double-click
  };

  // Handle double-click on file - cancels pending single-click and opens permanently
  const handleFileDoubleClick = (path: string, name: string) => {
    // Cancel the pending single-click action
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }

    openAsPermanent(path, name);
  };

  // Handle tab click - switch to that tab
  const handleTabClick = (path: string) => {
    setActiveTabPath(path);
    loadFileContent(path);
  };

  // Handle tab close
  const handleTabClose = (path: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent tab click from firing

    setTabs(prevTabs => {
      const newTabs = prevTabs.filter(tab => tab.path !== path);

      // If we're closing the active tab, switch to another tab
      if (activeTabPath === path) {
        if (newTabs.length > 0) {
          // Find the closest tab to switch to
          const closedIndex = prevTabs.findIndex(tab => tab.path === path);
          const newActiveIndex = Math.min(closedIndex, newTabs.length - 1);
          setActiveTabPath(newTabs[newActiveIndex].path);
          loadFileContent(newTabs[newActiveIndex].path);
        } else {
          setActiveTabPath(null);
          setFileContent(null);
          setImageUrl(null); // Clear image preview when closing last tab
          setAudioUrl(null); // Clear audio preview when closing last tab
        }
      }

      return newTabs;
    });
  };

  // Convert preview tab to permanent (e.g., when user starts editing)
  const pinTab = (path: string) => {
    setTabs(prevTabs =>
      prevTabs.map(tab =>
        tab.path === path ? { ...tab, isPreview: false } : tab
      )
    );
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

  // Helper to get all visible file paths in order (for shift-select range)
  const getVisibleFilePaths = useCallback((nodes: TreeNode[]): string[] => {
    const paths: string[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file') {
          paths.push(node.path);
        } else {
          // Folder - only recurse if expanded
          if (expandedFolders.has(node.path)) {
            traverse(node.children);
          }
        }
      }
    };
    traverse(nodes);
    return paths;
  }, [expandedFolders]);

  // Handle file selection with multi-select support (ctrl+click, shift+click)
  const handleFileSelect = useCallback((path: string, _name: string, event: React.MouseEvent) => {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    const isShift = event.shiftKey;

    if (isShift && lastSelectedPath) {
      // Shift+click: select range from last selected to current
      const visiblePaths = getVisibleFilePaths(fileTree);
      const lastIndex = visiblePaths.indexOf(lastSelectedPath);
      const currentIndex = visiblePaths.indexOf(path);

      if (lastIndex !== -1 && currentIndex !== -1) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangePaths = visiblePaths.slice(start, end + 1);

        setSelectedFiles(prev => {
          const next = new Set(prev);
          // Add all files in range to selection
          rangePaths.forEach(p => next.add(p));
          return next;
        });
      }
    } else if (isCtrlOrCmd) {
      // Ctrl/Cmd+click: toggle selection of clicked file
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      setLastSelectedPath(path);
    } else {
      // Regular click: select only this file (clear others)
      setSelectedFiles(new Set([path]));
      setLastSelectedPath(path);
    }
  }, [lastSelectedPath, getVisibleFilePaths, fileTree]);

  // Helper to log file operations as chat messages (saved to database like chat messages)
  // This creates proper messages that appear in the Chat view exactly like AI responses
  const logCodeMessage = useCallback(async (message: string, type: 'user' | 'assistant' | 'system' = 'system') => {
    if (!codeSession?.sessionId) return;
    try {
      // Save as a proper chat message (like AI chat responses)
      await sessionsApi.createMessage(codeSession.sessionId, type, message);
    } catch (error) {
      console.error('Failed to log code message:', error);
    }
  }, [codeSession?.sessionId]);

  // Refs to hold latest values for use in debounced callback
  const pendingChangesRef = useRef(pendingChanges);
  const codeSessionRef = useRef(codeSession);
  const editHistoryRef = useRef(editHistory);
  const historyIndexRef = useRef(historyIndex);

  // Keep refs updated
  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges]);

  useEffect(() => {
    codeSessionRef.current = codeSession;
  }, [codeSession]);

  useEffect(() => {
    editHistoryRef.current = editHistory;
  }, [editHistory]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  // Save a single file to storage-worker
  const saveFile = useCallback(async (path: string, content: string, _sha?: string) => {
    const session = codeSessionRef.current;
    if (!session || !session.sessionId) return null;

    try {
      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = session.sessionId;
      const repoName = session.repo;
      // Build the full storage path including repo name
      const storagePath = repoName ? `workspace/${repoName}/${path}` : `workspace/${path}`;

      console.log(`[Code] Saving file to storage-worker:`, { storageSessionId, storagePath });

      const success = await storageWorkerApi.writeFile(storageSessionId, storagePath, content);
      if (!success) {
        throw new Error('Failed to write file to storage');
      }

      return null; // No SHA needed for storage-worker
    } catch (error: any) {
      console.error(`Failed to save file ${path}:`, error);
      throw error;
    }
  }, []);

  // Auto-save function (debounced) - saves file to storage-worker
  const performAutoSave = useCallback(async (path: string, content: string) => {
    const session = codeSessionRef.current;
    if (!session) return;

    const changes = pendingChangesRef.current;
    const change = changes.get(path);
    if (!change) return; // No change record found

    // Check if content actually changed from original
    if (content === change.originalContent) return; // No actual changes

    setSaveStatus('saving');
    setLastSaveError(null);

    try {
      const newSha = await saveFile(path, content, change.sha);

      // Update the pending change with new SHA
      setPendingChanges(prev => {
        const next = new Map(prev);
        const existing = next.get(path);
        if (existing) {
          next.set(path, { ...existing, sha: newSha || existing.sha });
        }
        return next;
      });

      // Add to edit history for undo - only save snapshots on successful saves
      const currentHistory = editHistoryRef.current.get(path) || [];
      const currentIndex = historyIndexRef.current.get(path) ?? -1;

      // Only add if content is different from the last saved snapshot
      const lastSnapshot = currentHistory[currentIndex];
      if (lastSnapshot !== content) {
        setEditHistory(prev => {
          const next = new Map(prev);
          const history = next.get(path) || [];
          // Truncate any forward history if we've undone, then add new snapshot
          const newHistory = [...history.slice(0, currentIndex + 1), content];
          // Keep max 50 save snapshots
          if (newHistory.length > 50) {
            newHistory.shift();
          }
          next.set(path, newHistory);
          return next;
        });

        setHistoryIndex(prev => {
          const next = new Map(prev);
          const history = editHistoryRef.current.get(path) || [];
          next.set(path, Math.min(currentIndex + 1, history.length));
          return next;
        });
      }

      // Log the save to chat history
      await logCodeMessage(`📝 Saved: \`${path}\``, 'system');

      setSaveStatus('saved');

      // Reset to idle after a moment
      setTimeout(() => {
        setSaveStatus(prev => prev === 'saved' ? 'idle' : prev);
      }, 2000);
    } catch (error: any) {
      setSaveStatus('error');
      setLastSaveError(error.message || 'Failed to save');
    }
  }, [saveFile, logCodeMessage]);

  // Keep a ref to the latest performAutoSave so debounced function always calls current version
  const performAutoSaveRef = useRef(performAutoSave);
  useEffect(() => {
    performAutoSaveRef.current = performAutoSave;
  }, [performAutoSave]);

  // Create debounced auto-save - stable reference that won't be recreated
  const debouncedSave = useMemo(
    () => debounce((path: string, content: string) => {
      performAutoSaveRef.current(path, content);
    }, 1500),
    [] // Empty deps - created once, always calls latest performAutoSave via ref
  );

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedSave.cancel();
    };
  }, [debouncedSave]);

  // Track cursor position for restoration after re-render
  const cursorPositionRef = useRef<{ start: number; end: number } | null>(null);

  // Restore cursor position after content update
  useEffect(() => {
    if (cursorPositionRef.current && textareaRef.current) {
      const { start, end } = cursorPositionRef.current;
      textareaRef.current.setSelectionRange(start, end);
      cursorPositionRef.current = null;
    }
  }, [fileContent]);

  // Handle content change in editor
  const handleContentChange = useCallback((newContent: string, cursorStart?: number, cursorEnd?: number) => {
    if (!activeTabPath) return;

    // Save cursor position before state update
    if (cursorStart !== undefined && cursorEnd !== undefined) {
      cursorPositionRef.current = { start: cursorStart, end: cursorEnd };
    } else if (textareaRef.current) {
      cursorPositionRef.current = {
        start: textareaRef.current.selectionStart,
        end: textareaRef.current.selectionEnd
      };
    }

    // Update file content immediately for responsive editing
    setFileContent(newContent);

    // Update pending changes
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(activeTabPath);
      if (existing) {
        next.set(activeTabPath, { ...existing, content: newContent });
      } else {
        next.set(activeTabPath, { content: newContent, originalContent: newContent });
      }
      return next;
    });

    // Pin the tab when editing starts
    const tab = tabs.find(t => t.path === activeTabPath);
    if (tab?.isPreview) {
      pinTab(activeTabPath);
    }

    // Trigger debounced auto-save
    debouncedSave(activeTabPath, newContent);
  }, [activeTabPath, debouncedSave, tabs, pinTab]);

  // Undo function
  const handleUndo = useCallback(() => {
    if (!activeTabPath) return;

    const history = editHistory.get(activeTabPath);
    const currentIndex = historyIndex.get(activeTabPath) || 0;

    if (!history || currentIndex <= 0) return;

    const newIndex = currentIndex - 1;
    const previousContent = history[newIndex];

    setHistoryIndex(prev => {
      const next = new Map(prev);
      next.set(activeTabPath, newIndex);
      return next;
    });

    setFileContent(previousContent);

    // Update pending changes
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(activeTabPath);
      if (existing) {
        next.set(activeTabPath, { ...existing, content: previousContent });
      }
      return next;
    });

    // Trigger auto-save for the undone content
    debouncedSave(activeTabPath, previousContent);
  }, [activeTabPath, editHistory, historyIndex, debouncedSave]);

  // Redo function
  const handleRedo = useCallback(() => {
    if (!activeTabPath) return;

    const history = editHistory.get(activeTabPath);
    const currentIndex = historyIndex.get(activeTabPath) || 0;

    if (!history || currentIndex >= history.length - 1) return;

    const newIndex = currentIndex + 1;
    const nextContent = history[newIndex];

    setHistoryIndex(prev => {
      const next = new Map(prev);
      next.set(activeTabPath, newIndex);
      return next;
    });

    setFileContent(nextContent);

    // Update pending changes
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(activeTabPath);
      if (existing) {
        next.set(activeTabPath, { ...existing, content: nextContent });
      }
      return next;
    });

    // Trigger auto-save for the redone content
    debouncedSave(activeTabPath, nextContent);
  }, [activeTabPath, editHistory, historyIndex, debouncedSave]);

  // Commit all pending changes to GitHub
  const commitChanges = useCallback(async () => {
    if (!codeSession) return;

    // Get list of modified files with their content
    const modifiedFiles: Array<{ path: string; content: string }> = [];
    // Get list of deleted files
    const deletedFiles: Array<{ path: string }> = [];

    pendingChanges.forEach((change, path) => {
      if (change.deleted) {
        // File is marked for deletion
        deletedFiles.push({ path });
      } else if (change.content !== change.originalContent) {
        // File content has changed
        modifiedFiles.push({ path, content: change.content });
      }
    });

    if (modifiedFiles.length === 0 && deletedFiles.length === 0) {
      // No changes to commit
      return;
    }

    setCommitStatus('committing');

    try {
      // First ensure all pending saves are complete (to storage-worker)
      debouncedSave.cancel();

      // Save any unsaved files first to storage-worker (skip deleted files)
      for (const { path, content } of modifiedFiles) {
        const change = pendingChanges.get(path);
        if (change) {
          await saveFile(path, content, change.sha);
        }
      }

      // Now commit to GitHub
      console.log('[Code] Committing to GitHub:', {
        owner: codeSession.owner,
        repo: codeSession.repo,
        branch: codeSession.branch,
        files: modifiedFiles.map(f => f.path),
        deletions: deletedFiles.map(f => f.path)
      });

      const result = await githubApi.commit(codeSession.owner, codeSession.repo, {
        branch: codeSession.branch,
        files: modifiedFiles.map(f => ({ path: f.path, content: f.content })),
        deletions: deletedFiles.map(f => f.path)
      });

      // Log the commit with the generated message
      const modifiedList = modifiedFiles.map(f => `\`${f.path}\``);
      const deletedList = deletedFiles.map(f => `🗑️ \`${f.path}\``);
      const fileList = [...modifiedList, ...deletedList].join(', ');
      await logCodeMessage(`💾 Committed to GitHub: "${result.data.message}"\nFiles: ${fileList}\nCommit: ${result.data.commitSha.substring(0, 7)}`, 'system');

      console.log('[Code] Commit successful:', result.data);

      // Update pending changes to mark as committed
      setPendingChanges(prev => {
        const next = new Map(prev);
        // Update modified files (new original = current)
        modifiedFiles.forEach(({ path }) => {
          const change = next.get(path);
          if (change) {
            next.set(path, { ...change, originalContent: change.content });
          }
        });
        // Remove deleted files from pending changes (they're now deleted from GitHub)
        deletedFiles.forEach(({ path }) => {
          next.delete(path);
        });
        return next;
      });

      setCommitStatus('committed');

      setTimeout(() => {
        setCommitStatus(prev => prev === 'committed' ? 'idle' : prev);
      }, 2000);
    } catch (error: any) {
      console.error('Failed to commit changes:', error);
      setCommitStatus('error');
      setLastSaveError(error.message || 'Failed to commit');
    }
  }, [codeSession, pendingChanges, debouncedSave, saveFile, logCodeMessage]);

  // Keyboard shortcuts handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S to commit changes
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        commitChanges();
      }

      // Ctrl/Cmd + Z for undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }

      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y for redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commitChanges, handleUndo, handleRedo]);

  // Count total modified files (including deletions)
  const modifiedFilesCount = useMemo(() => {
    let count = 0;
    pendingChanges.forEach((change) => {
      // Count as modified if: content changed OR file is marked for deletion
      if (change.deleted || change.content !== change.originalContent) {
        count++;
      }
    });
    return count;
  }, [pendingChanges]);

  // Open rename modal for file or folder
  const openRenameModal = useCallback((itemType: 'file' | 'folder', path: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFileOperation({ type: 'rename', itemType, path, name });
    setNewName(name);
    setOperationError(null);
  }, []);

  // Open delete confirmation modal for file or folder
  const openDeleteModal = useCallback((itemType: 'file' | 'folder', path: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFileOperation({ type: 'delete', itemType, path, name });
    setOperationError(null);
  }, []);

  // Open create modal for new file or folder
  // parentPath is the folder path where the new item will be created (empty string for root)
  const openCreateModal = useCallback((itemType: 'file' | 'folder', parentPath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFileOperation({ type: 'create', itemType, path: parentPath, name: '' });
    setNewName('');
    setOperationError(null);
  }, []);

  // Close the modal
  const closeModal = useCallback(() => {
    setFileOperation({ type: null, itemType: null, path: '', name: '' });
    setNewName('');
    setOperationError(null);
  }, []);

  // Handle rename operation
  const handleRename = useCallback(async () => {
    if (!codeSession || !newName.trim() || newName === fileOperation.name) {
      closeModal();
      return;
    }

    setIsOperating(true);
    setOperationError(null);

    try {
      // Calculate the new path by replacing the name in the path
      const pathParts = fileOperation.path.split('/');
      pathParts[pathParts.length - 1] = newName.trim();
      const newPath = pathParts.join('/');

      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = codeSession.sessionId;
      const repoName = codeSession.repo;
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }

      // Build the full storage paths including repo name
      const oldStoragePath = repoName ? `workspace/${repoName}/${fileOperation.path}` : `workspace/${fileOperation.path}`;
      const newStoragePath = repoName ? `workspace/${repoName}/${newPath}` : `workspace/${newPath}`;

      if (fileOperation.itemType === 'file') {
        // Rename file in storage-worker: read content, write to new path, delete old
        const content = await storageWorkerApi.getFileText(storageSessionId, oldStoragePath);
        if (content !== null) {
          await storageWorkerApi.writeFile(storageSessionId, newStoragePath, content);
          await storageWorkerApi.deleteFile(storageSessionId, oldStoragePath);
        } else {
          throw new Error('File not found in storage');
        }
      } else {
        // For folders, we need to move all files - this is more complex
        // For now, throw an error as folder rename requires listing all files
        throw new Error('Folder rename is not yet supported in storage-worker mode');
      }

      // Refresh the file tree (use session-specific query key to avoid affecting other Code instances in split view)
      queryClient.invalidateQueries({ queryKey: ['file-tree', codeSession.sessionId] });

      // Log the rename operation as a chat message (persisted to database)
      const itemTypeIcon = fileOperation.itemType === 'file' ? '📄' : '📁';
      const renameMessage = `${itemTypeIcon} Renamed: \`${fileOperation.path}\` → \`${newPath}\``;
      await logCodeMessage(renameMessage, 'system');

      // If the renamed item was open in a tab, update the tab
      if (fileOperation.itemType === 'file' && activeTabPath === fileOperation.path) {
        setActiveTabPath(newPath);
        setTabs(prevTabs =>
          prevTabs.map(tab =>
            tab.path === fileOperation.path
              ? { ...tab, path: newPath, name: newName.trim() }
              : tab
          )
        );
      }

      closeModal();
    } catch (error: any) {
      console.error('Rename error:', error);
      setOperationError(error.message || 'Failed to rename');
    } finally {
      setIsOperating(false);
    }
  }, [codeSession, fileOperation, newName, activeTabPath, closeModal, queryClient, logCodeMessage]);

  // Helper to collect all file paths in a folder from the file tree
  const collectFilesInFolder = useCallback((folderPath: string): string[] => {
    const files: string[] = [];

    const traverseTree = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.type === 'file' && node.path.startsWith(folderPath + '/')) {
          files.push(node.path);
        } else if (node.type === 'folder') {
          traverseTree(node.children);
        }
      }
    };

    if (fileTree) {
      traverseTree(fileTree);
    }

    return files;
  }, [fileTree]);

  // Handle delete operation
  const handleDelete = useCallback(async () => {
    if (!codeSession) {
      closeModal();
      return;
    }

    setIsOperating(true);
    setOperationError(null);

    try {
      // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
      const storageSessionId = codeSession.sessionId;
      const repoName = codeSession.repo;
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }

      // Build the full storage path including repo name
      const storagePath = repoName ? `workspace/${repoName}/${fileOperation.path}` : `workspace/${fileOperation.path}`;

      // Collect files to mark as deleted for the commit
      const filesToDelete: string[] = [];

      if (fileOperation.itemType === 'file') {
        // Delete from local storage
        const success = await storageWorkerApi.deleteFile(storageSessionId, storagePath);
        if (!success) {
          throw new Error('Failed to delete file from storage');
        }
        // Mark single file for deletion
        filesToDelete.push(fileOperation.path);
      } else {
        // For folders, first collect all files in the folder before deleting
        filesToDelete.push(...collectFilesInFolder(fileOperation.path));

        // Delete folder and all its contents from local storage
        const result = await storageWorkerApi.deleteFolder(storageSessionId, storagePath);
        if (!result.success) {
          throw new Error('Failed to delete folder from storage');
        }
      }

      // Mark files as deleted in pendingChanges (so they will be committed)
      setPendingChanges(prev => {
        const next = new Map(prev);
        for (const filePath of filesToDelete) {
          const existing = next.get(filePath);
          if (existing) {
            // Update existing entry to mark as deleted
            next.set(filePath, { ...existing, deleted: true });
          } else {
            // Create new entry marked as deleted
            next.set(filePath, {
              content: '',
              originalContent: '',
              deleted: true
            });
          }
        }
        return next;
      });

      // Refresh the file tree (use session-specific query key to avoid affecting other Code instances in split view)
      queryClient.invalidateQueries({ queryKey: ['file-tree', codeSession.sessionId] });

      // Log the delete operation as a chat message (persisted to database)
      const deleteIcon = fileOperation.itemType === 'file' ? '📄' : '📁';
      const deleteMessage = `🗑️ Marked for deletion ${deleteIcon} ${fileOperation.itemType}: \`${fileOperation.path}\` (click Commit to apply)`;
      await logCodeMessage(deleteMessage, 'system');

      // If the deleted item was open in a tab, close it
      if (fileOperation.itemType === 'file') {
        setTabs(prevTabs => {
          const newTabs = prevTabs.filter(tab => tab.path !== fileOperation.path);
          if (activeTabPath === fileOperation.path) {
            if (newTabs.length > 0) {
              setActiveTabPath(newTabs[0].path);
              loadFileContent(newTabs[0].path);
            } else {
              setActiveTabPath(null);
              setFileContent(null);
            }
          }
          return newTabs;
        });
      } else {
        // For folders, close all tabs that are inside the folder
        setTabs(prevTabs => {
          const newTabs = prevTabs.filter(tab => !tab.path.startsWith(fileOperation.path + '/'));
          if (activeTabPath && activeTabPath.startsWith(fileOperation.path + '/')) {
            if (newTabs.length > 0) {
              setActiveTabPath(newTabs[0].path);
              loadFileContent(newTabs[0].path);
            } else {
              setActiveTabPath(null);
              setFileContent(null);
            }
          }
          return newTabs;
        });
      }

      closeModal();
    } catch (error: any) {
      console.error('Delete error:', error);
      setOperationError(error.message || 'Failed to delete');
    } finally {
      setIsOperating(false);
    }
  }, [codeSession, fileOperation, activeTabPath, closeModal, queryClient, loadFileContent, logCodeMessage, collectFilesInFolder]);

  // Handle create new file or folder
  const handleCreate = useCallback(async () => {
    if (!codeSession || !newName.trim()) {
      closeModal();
      return;
    }

    setIsOperating(true);
    setOperationError(null);

    try {
      const storageSessionId = codeSession.sessionId;
      const repoName = codeSession.repo;
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }

      // Build the new path: parent folder + new name
      const relativePath = fileOperation.path
        ? `${fileOperation.path}/${newName.trim()}`
        : newName.trim();
      const storagePath = repoName
        ? `workspace/${repoName}/${relativePath}`
        : `workspace/${relativePath}`;

      if (fileOperation.itemType === 'file') {
        // Create an empty file
        const success = await storageWorkerApi.writeFile(storageSessionId, storagePath, '');
        if (!success) {
          throw new Error('Failed to create file in storage');
        }

        // Log the create operation
        await logCodeMessage(`📄 Created new file: \`${relativePath}\``, 'system');

        // Refresh the file tree
        queryClient.invalidateQueries({ queryKey: ['file-tree', codeSession.sessionId] });

        // If there's a parent folder, make sure it's expanded
        if (fileOperation.path) {
          setExpandedFolders(prev => new Set([...prev, fileOperation.path]));
        }

        // Open the new file in the editor
        closeModal();
        handleFileDoubleClick(relativePath, newName.trim());
      } else {
        // For folders, create a .gitkeep file to ensure the folder exists
        const gitkeepPath = `${storagePath}/.gitkeep`;
        const success = await storageWorkerApi.writeFile(storageSessionId, gitkeepPath, '');
        if (!success) {
          throw new Error('Failed to create folder in storage');
        }

        // Log the create operation
        await logCodeMessage(`📁 Created new folder: \`${relativePath}\``, 'system');

        // Refresh the file tree
        queryClient.invalidateQueries({ queryKey: ['file-tree', codeSession.sessionId] });

        // Expand the parent folder and the new folder
        setExpandedFolders(prev => {
          const newSet = new Set(prev);
          if (fileOperation.path) {
            newSet.add(fileOperation.path);
          }
          newSet.add(relativePath);
          return newSet;
        });

        closeModal();
      }
    } catch (error: any) {
      console.error('Create error:', error);
      setOperationError(error.message || 'Failed to create');
    } finally {
      setIsOperating(false);
    }
  }, [codeSession, fileOperation, newName, closeModal, queryClient, logCodeMessage, handleFileDoubleClick]);

  // PR Handler Functions
  const handleCreatePR = async () => {
    if (!codeSession?.owner || !codeSession?.repo || !codeSession?.branch || !codeSession?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('create');
    setPrError(null);
    setPrSuccess(null);

    try {
      const response = await githubApi.createPull(
        codeSession.owner,
        codeSession.repo,
        {
          title: `Code changes from ${codeSession.branch}`,
          head: codeSession.branch,
          base: codeSession.baseBranch,
        }
      );
      setPrSuccess(`PR #${response.data.number} created successfully!`);

      // Log PR creation as a chat message (persisted to database)
      await logCodeMessage(`🔀 Created Pull Request #${response.data.number}: ${response.data.htmlUrl}`, 'system');

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
    if (!codeSession?.owner || !codeSession?.repo || !codeSession?.branch || !codeSession?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('auto');
    setPrError(null);
    setPrSuccess(null);
    setAutoPrProgress('Starting Auto PR...');

    try {
      const response = await githubApi.autoPR(
        codeSession.owner,
        codeSession.repo,
        codeSession.branch,
        {
          base: codeSession.baseBranch,
          title: `Code changes from ${codeSession.branch}`,
          sessionId: codeSession.sessionId, // Now we have a session ID
        }
      );

      const results = response.data;
      setPrSuccess(`Auto PR completed! PR #${results.pr?.number} merged successfully.`);
      setAutoPrProgress(null);

      // Log the auto PR completion as a chat message (persisted to database)
      await logCodeMessage(`✅ Auto PR completed! PR #${results.pr?.number} merged into \`${codeSession.baseBranch}\``, 'system');

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

  // Render file tree recursively
  const renderFileTree = (nodes: TreeNode[], level = 0): JSX.Element[] => {
    return nodes.map((node) => {
      const paddingLeft = level * 16 + 8;

      if (node.type === 'file') {
        const isActive = activeTabPath === node.path;
        const isSelected = selectedFiles.has(node.path);
        return (
          <div
            key={node.path}
            onClick={(e) => handleFileClick(node.path, node.name, e)}
            onDoubleClick={() => handleFileDoubleClick(node.path, node.name)}
            className={`group flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
              isSelected ? 'bg-primary/20' : ''
            } ${isActive ? 'bg-base-300' : ''}`}
            style={{ paddingLeft }}
          >
            <span className="text-xs">{node.icon}</span>
            <span className="text-sm truncate flex-1">{node.name}</span>
            {/* Action buttons - visible on hover */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => openRenameModal('file', node.path, node.name, e)}
                className="p-1 hover:bg-base-200 rounded"
                title="Rename file"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button
                onClick={(e) => openDeleteModal('file', node.path, node.name, e)}
                className="p-1 hover:bg-base-200 rounded text-error"
                title="Delete file"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        );
      }

      const isExpanded = expandedFolders.has(node.path);
      return (
        <div key={node.path}>
          <div
            onClick={() => toggleFolder(node.path)}
            className="group flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300"
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
            <span className="text-sm font-medium flex-1">{node.name}</span>
            {/* Action buttons - visible on hover */}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => openCreateModal('file', node.path, e)}
                className="p-1 hover:bg-base-200 rounded"
                title="New file in folder"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </button>
              <button
                onClick={(e) => openCreateModal('folder', node.path, e)}
                className="p-1 hover:bg-base-200 rounded"
                title="New folder in folder"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </button>
              <button
                onClick={(e) => openRenameModal('folder', node.path, node.name, e)}
                className="p-1 hover:bg-base-200 rounded"
                title="Rename folder"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
              <button
                onClick={(e) => openDeleteModal('folder', node.path, node.name, e)}
                className="p-1 hover:bg-base-200 rounded text-error"
                title="Delete folder"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3.5 w-3.5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
          {isExpanded && node.children.length > 0 && renderFileTree(node.children, level + 1)}
        </div>
      );
    });
  };

  // Code Editor JSX (not a component - just JSX to avoid remounting)
  const codeEditorContent = (
    <div className="flex h-full">
      {/* File Explorer Sidebar */}
      <div className="w-64 bg-base-100 border-r border-base-300 overflow-y-auto flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
          <span className="text-sm font-semibold uppercase tracking-wide">Explorer</span>
          <div className="flex gap-0.5">
            <button
              onClick={(e) => openCreateModal('file', '', e)}
              className="p-1 hover:bg-base-200 rounded"
              title="New File"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            <button
              onClick={(e) => openCreateModal('folder', '', e)}
              className="p-1 hover:bg-base-200 rounded"
              title="New Folder"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </button>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['file-tree', codeSession?.sessionId] })}
              className="p-1 hover:bg-base-200 rounded"
              title="Refresh"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

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
              No files found. Run AI to generate files.
            </div>
          )}
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col bg-base-200 min-w-0">
        {/* Tab Bar with Status */}
        <div className="flex items-center bg-base-100 border-b border-base-300">
          <div className="flex-1 flex items-center overflow-x-auto">
            {tabs.length > 0 ? (
              tabs.map((tab) => {
                const isActive = tab.path === activeTabPath;
                const tabChange = pendingChanges.get(tab.path);
                const isModified = tabChange ? tabChange.content !== tabChange.originalContent : false;
                return (
                  <div
                    key={tab.path}
                    onClick={() => handleTabClick(tab.path)}
                    onDoubleClick={() => pinTab(tab.path)}
                    className={`flex items-center gap-2 px-4 py-2 border-r border-base-300 cursor-pointer hover:bg-base-200 flex-shrink-0 ${
                      isActive ? 'bg-base-200' : 'bg-base-100'
                    }`}
                    title={tab.isPreview ? `${tab.path} (Preview - double-click to keep open)` : tab.path}
                  >
                    <span className="text-xs">{getFileIcon(tab.name)}</span>
                    <span className={`text-sm ${tab.isPreview ? 'italic text-base-content/70' : ''}`}>
                      {tab.name}
                    </span>
                    {isModified && (
                      <span className="w-2 h-2 rounded-full bg-warning" title="Modified" />
                    )}
                    <button
                      onClick={(e) => handleTabClose(tab.path, e)}
                      className="ml-1 hover:bg-base-300 rounded p-0.5 opacity-60 hover:opacity-100"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="px-4 py-2 text-sm text-base-content/50">
                Select a file to edit
              </div>
            )}
          </div>

          {/* Save/Commit Status and Actions */}
          <div className="flex items-center gap-2 px-3 border-l border-base-300">
            {/* Save Status */}
            <div className="flex items-center gap-1.5 text-xs">
              {saveStatus === 'saving' && (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  <span className="text-base-content/70">Saving...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <svg className="w-3.5 h-3.5 text-success" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-success">Saved</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <svg className="w-3.5 h-3.5 text-error" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span className="text-error" title={lastSaveError || 'Save failed'}>Error</span>
                </>
              )}
            </div>

            {/* Modified files count */}
            {modifiedFilesCount > 0 && (
              <div className="badge badge-warning badge-sm" title={`${modifiedFilesCount} file(s) with uncommitted changes`}>
                {modifiedFilesCount} modified
              </div>
            )}

            {/* Commit Button */}
            <button
              onClick={commitChanges}
              disabled={modifiedFilesCount === 0 || commitStatus === 'committing'}
              className="btn btn-xs btn-primary gap-1"
              title="Commit changes (Ctrl/Cmd+S)"
            >
              {commitStatus === 'committing' ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Committing...
                </>
              ) : commitStatus === 'committed' ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Committed!
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Commit
                </>
              )}
            </button>
          </div>
        </div>

        {/* Code Editor */}
        <div className="flex-1 overflow-hidden relative">
          {isLoadingFile ? (
            <div className="flex items-center justify-center h-full">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : imageUrl ? (
            /* Image Preview */
            <div className="h-full flex items-center justify-center bg-base-200 p-4 overflow-auto">
              <div className="relative max-w-full max-h-full">
                <img
                  src={imageUrl}
                  alt={activeTabPath || 'Image preview'}
                  className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded-lg shadow-lg"
                  style={{ imageRendering: 'auto' }}
                />
                <div className="absolute bottom-0 left-0 right-0 bg-base-300/80 backdrop-blur-sm text-base-content text-xs p-2 rounded-b-lg text-center">
                  {activeTabPath?.split('/').pop() || 'Image'} (read-only preview)
                </div>
              </div>
            </div>
          ) : audioUrl ? (
            /* Audio Preview */
            <div className="h-full flex items-center justify-center bg-base-200 p-4 overflow-auto">
              <div className="bg-base-300 rounded-lg shadow-lg p-8 max-w-md w-full">
                <div className="text-center mb-6">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <svg className="w-10 h-10 text-primary" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-base-content">
                    {activeTabPath?.split('/').pop() || 'Audio'}
                  </h3>
                  <p className="text-sm text-base-content/60 mt-1">Audio Preview</p>
                </div>
                <audio
                  controls
                  className="w-full"
                  src={audioUrl}
                >
                  Your browser does not support the audio element.
                </audio>
                <p className="text-xs text-base-content/50 text-center mt-4">
                  Read-only preview • Use the Sound editor for advanced editing
                </p>
              </div>
            </div>
          ) : fileContent !== null ? (
            <div className="h-full flex flex-col bg-base-200">
              {/* Markdown Preview Toggle - only show for markdown files */}
              {activeTabPath && isMarkdownFile(activeTabPath) && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-base-300 border-b border-base-content/10">
                  <span className="text-xs text-base-content/60">Mode:</span>
                  <div className="flex gap-1 bg-base-200 rounded-lg p-0.5">
                    <button
                      onClick={() => setIsMarkdownPreviewMode(false)}
                      className={`btn btn-xs ${!isMarkdownPreviewMode ? 'btn-primary' : 'btn-ghost'}`}
                      title="Edit markdown"
                    >
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit
                    </button>
                    <button
                      onClick={() => setIsMarkdownPreviewMode(true)}
                      className={`btn btn-xs ${isMarkdownPreviewMode ? 'btn-primary' : 'btn-ghost'}`}
                      title="Preview markdown"
                    >
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      Preview
                    </button>
                  </div>
                  {isMarkdownPreviewMode && (
                    <span className="text-xs text-base-content/50 ml-2">Double-click to edit</span>
                  )}
                </div>
              )}

              {/* Markdown Preview Mode */}
              {activeTabPath && isMarkdownFile(activeTabPath) && isMarkdownPreviewMode ? (
                <div
                  className="flex-1 overflow-auto p-4 prose prose-sm max-w-none"
                  onDoubleClick={() => setIsMarkdownPreviewMode(false)}
                  title="Double-click to edit"
                >
                  <MarkdownRenderer content={fileContent} className="text-base-content" />
                </div>
              ) : (
                <SyntaxHighlightedEditor
                  content={fileContent}
                  filename={activeTabPath || ''}
                  onChange={handleContentChange}
                  onKeyDown={(e) => {
                    // Handle Tab key for indentation
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const target = e.target as HTMLTextAreaElement;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      const newValue = fileContent.substring(0, start) + '  ' + fileContent.substring(end);
                      handleContentChange(newValue, start + 2, start + 2);
                    }
                  }}
                  className="flex-1"
                />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/50">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
                <p>Select a file from the explorer to edit</p>
                <p className="text-xs mt-2 text-base-content/40">
                  Changes auto-save • Ctrl/Cmd+S to commit • Ctrl/Cmd+Z to undo
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Determine what content to show based on state
  const getMainContent = () => {
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

    // If we have a sessionId but the session doesn't have branch info, show error
    if (sessionId && existingSessionData?.data && !codeSession) {
      const session = existingSessionData.data;
      if (!session.repositoryOwner || !session.repositoryName || !session.branch) {
        return (
          <div className="max-w-2xl mx-auto px-4 py-8">
            <div className="alert alert-warning">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="font-bold">Branch not available</h3>
                <p className="text-sm">This session doesn't have a branch created yet. The branch is created when the AI worker starts processing.</p>
              </div>
            </div>
          </div>
        );
      }
    }

    // If we're auto-initializing from quick-setup, show a dedicated loading state
    if (preSelectedSettings?.repositoryUrl && (isLoadingRepos || isInitializing)) {
      return (
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="text-center">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-4 text-lg text-base-content">Setting up your workspace...</p>
            <p className="mt-2 text-sm text-base-content/70">Creating a new branch for your changes</p>
          </div>
        </div>
      );
    }

    // Show error if quick-setup initialization failed
    if (initError) {
      return (
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="alert alert-error mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{initError}</span>
            <button onClick={() => setInitError(null)} className="btn btn-sm btn-ghost">Dismiss</button>
          </div>
          <div className="text-center">
            <button onClick={() => navigate('/sessions')} className="btn btn-primary">
              Go to Sessions
            </button>
          </div>
        </div>
      );
    }

    // No session - redirect to sessions page
    if (!codeSession) {
      return (
        <div className="flex items-center justify-center h-[calc(100vh-200px)]">
          <div className="text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <h2 className="text-xl font-semibold text-base-content mb-2">No Code Session</h2>
            <p className="text-base-content/70 mb-4">Start a new code session from the Sessions page or Quick Setup.</p>
            <button onClick={() => navigate('/sessions')} className="btn btn-primary">
              Go to Sessions
            </button>
          </div>
        </div>
      );
    }

    // Return the code session view
    return null;
  };

  const mainContent = getMainContent();

  // Create PR actions for the branch line (similar to Chat.tsx)
  const prActions = codeSession && codeSession.branch && codeSession.baseBranch && (
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
  const selectedRepoUrl = codeSession ? `https://github.com/${codeSession.owner}/${codeSession.repo}.git` : undefined;

  // Create a session-like object for SessionLayout if we have a codeSession
  // This enables proper title display in the top bar
  const sessionForLayout = codeSession && existingSessionData?.data ? existingSessionData.data : undefined;

  // The actual content to render (either loading state or editor)
  const content = mainContent || (
    <>
      <div className="h-[calc(100vh-112px)] flex flex-col">
          {/* Session Header */}
          <div className="bg-base-100 border-b border-base-300 px-4 py-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Only show back button if not from an existing session URL */}
                {!isFromExistingSession && (
                  <button
                    onClick={() => {
                      setCodeSession(null);
                      setTabs([]);
                      setActiveTabPath(null);
                      setFileContent(null);
                      setExpandedFolders(new Set());
                      setPendingChanges(new Map());
                    }}
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
                )}
                <div>
                  <h2 className="text-sm font-semibold text-base-content">
                    {codeSession?.owner}/{codeSession?.repo}
                  </h2>
                  <p className="text-xs text-base-content/70">
                    Branch: <span className="text-primary">{codeSession?.branch}</span>
                    <span className="mx-2">•</span>
                    Base: {codeSession?.baseBranch}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`https://github.com/${codeSession?.owner}/${codeSession?.repo}/tree/${codeSession?.branch}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm btn-ghost gap-2"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                  View on GitHub
                </a>
              </div>
            </div>
          </div>

          {/* PR Status Alerts */}
          {(autoPrProgress || prSuccess || prError) && (
            <div className="px-4 py-2 border-b border-base-300 bg-base-100 space-y-2">
              {autoPrProgress && (
                <div className="alert alert-info py-2">
                  <span className="loading loading-spinner loading-sm"></span>
                  <span className="text-sm font-semibold">{autoPrProgress}</span>
                </div>
              )}

              {prSuccess && (
                <div className="alert alert-success py-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span className="text-sm">{prSuccess}</span>
                  <button onClick={() => setPrSuccess(null)} className="btn btn-ghost btn-xs">Dismiss</button>
                </div>
              )}

              {prError && (
                <div className="alert alert-error py-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-5 w-5" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span className="text-sm">{prError}</span>
                  <button onClick={() => setPrError(null)} className="btn btn-ghost btn-xs">Dismiss</button>
                </div>
              )}
            </div>
          )}

          {/* Code Editor */}
          <div className="flex-1 min-h-0">
            {codeEditorContent}
          </div>
        </div>

      {/* Rename Modal */}
      {fileOperation.type === 'rename' && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">
              Rename {fileOperation.itemType === 'folder' ? 'Folder' : 'File'}
            </h3>
            <div className="py-4">
              <label className="label">
                <span className="label-text">New name</span>
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input input-bordered w-full"
                placeholder="Enter new name"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') closeModal();
                }}
              />
              {operationError && (
                <div className="mt-2 text-error text-sm">{operationError}</div>
              )}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={closeModal}
                disabled={isOperating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRename}
                disabled={isOperating || !newName.trim() || newName === fileOperation.name}
              >
                {isOperating ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Renaming...
                  </>
                ) : (
                  'Rename'
                )}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeModal}></div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {fileOperation.type === 'delete' && (
        <div className="modal modal-open">
          <div className="modal-box">
            <form onSubmit={(e) => { e.preventDefault(); handleDelete(); }}>
              <h3 className="font-bold text-lg text-error">
                Delete {fileOperation.itemType === 'folder' ? 'Folder' : 'File'}
              </h3>
              <div className="py-4">
                <p>
                  Are you sure you want to delete{' '}
                  <span className="font-semibold">{fileOperation.name}</span>?
                </p>
                {fileOperation.itemType === 'folder' && (
                  <p className="mt-2 text-warning text-sm">
                    This will delete all files inside the folder.
                  </p>
                )}
                <p className="mt-2 text-base-content/70 text-sm">
                  This action cannot be undone.
                </p>
                {operationError && (
                  <div className="mt-2 text-error text-sm">{operationError}</div>
                )}
              </div>
              <div className="modal-action">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closeModal}
                  disabled={isOperating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-error"
                  disabled={isOperating}
                  autoFocus
                >
                  {isOperating ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Deleting...
                    </>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={closeModal}></div>
        </div>
      )}

      {/* Create New File/Folder Modal */}
      {fileOperation.type === 'create' && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">
              New {fileOperation.itemType === 'folder' ? 'Folder' : 'File'}
            </h3>
            <div className="py-4">
              <label className="label">
                <span className="label-text">
                  {fileOperation.itemType === 'folder' ? 'Folder' : 'File'} name
                </span>
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input input-bordered w-full"
                placeholder={fileOperation.itemType === 'folder' ? 'Enter folder name' : 'Enter file name (e.g., index.ts)'}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) handleCreate();
                  if (e.key === 'Escape') closeModal();
                }}
              />
              {fileOperation.path && (
                <p className="mt-2 text-base-content/70 text-sm">
                  Creating in: <code className="bg-base-200 px-1 rounded">{fileOperation.path}/</code>
                </p>
              )}
              {operationError && (
                <div className="mt-2 text-error text-sm">{operationError}</div>
              )}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-ghost"
                onClick={closeModal}
                disabled={isOperating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={isOperating || !newName.trim()}
              >
                {isOperating ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={closeModal}></div>
        </div>
      )}
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
      baseBranch={codeSession?.baseBranch}
      branch={codeSession?.branch}
      isLocked={!!codeSession}
      prActions={prActions}
      session={sessionForLayout}
    >
      {content}
    </SessionLayout>
  );
}
