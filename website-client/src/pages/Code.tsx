import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
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
}

// File operation state for modals
interface FileOperationState {
  type: 'rename' | 'delete' | null;
  itemType: 'file' | 'folder' | null;
  path: string;
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
const transformStorageFiles = (files: { path: string; size: number; type: 'file' | 'directory' }[]): TreeNode[] => {
  const root: FolderNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Filter out non-workspace files (like .session-metadata.json, .stream-events.jsonl)
  // and extract paths from workspace/ prefix
  const workspaceFiles = files
    .filter(f => f.path.startsWith('workspace/') && !f.path.includes('.session-metadata') && !f.path.includes('.stream-events'))
    .map(f => ({
      ...f,
      path: f.path.replace(/^workspace\//, ''), // Remove workspace/ prefix
    }))
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

  // Image preview state
  const [imageUrl, setImageUrl] = useState<string | null>(null);

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

  // Fetch user's GitHub repos (only when no existing session)
  const { data: reposData, isLoading: isLoadingRepos, error: reposError } = useQuery({
    queryKey: ['github-repos'],
    queryFn: githubApi.getRepos,
    enabled: !sessionId, // Only fetch repos if not viewing an existing session
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
    const tree = transformStorageFiles(storageFiles);
    console.log('[Code] Transformed file tree:', tree.length, 'root items');
    return tree;
  }, [storageFiles]);

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

  // Initialize Code session when repo is selected (from RepoSelector)
  const initializeCodeSession = async (repo: GitHubRepo) => {
    setIsInitializing(true);
    setInitError(null);

    const [owner, repoName] = repo.fullName.split('/');
    const baseBranch = repo.defaultBranch;

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

    // Clear previous image URL when loading a new file
    setImageUrl(null);

    // Use the database session ID as the storage key (this is what the AI worker uses when uploading)
    const storageSessionId = codeSession.sessionId;

    if (!storageSessionId) {
      setFileContent(`// Error: No session ID available`);
      return;
    }

    // Check if this is an image file
    if (isImageFile(path)) {
      setIsLoadingFile(true);
      setFileContent(null); // Clear text content for images
      try {
        const blob = await storageWorkerApi.getFileBlob(storageSessionId, `workspace/${path}`);
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

    // Check if we have pending changes for this file - use those instead of fetching
    const existingChange = pendingChanges.get(path);
    if (existingChange) {
      setFileContent(existingChange.content);
      return;
    }

    setIsLoadingFile(true);
    try {
      console.log('[Code] Fetching file from storage-worker:', path);
      const content = await storageWorkerApi.getFileText(storageSessionId, `workspace/${path}`);

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
  const handleFileClick = (path: string, name: string) => {
    // Clear any pending single-click action
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
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
      const storagePath = `workspace/${path}`;

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

  // Commit all pending changes (creates a commit message in the log)
  const commitChanges = useCallback(async () => {
    if (!codeSession) return;

    // Get list of modified files
    const modifiedFiles: string[] = [];
    pendingChanges.forEach((change, path) => {
      if (change.content !== change.originalContent) {
        modifiedFiles.push(path);
      }
    });

    if (modifiedFiles.length === 0) {
      // No changes to commit
      return;
    }

    setCommitStatus('committing');

    try {
      // First ensure all pending saves are complete
      debouncedSave.cancel();

      // Save any unsaved files first
      for (const path of modifiedFiles) {
        const change = pendingChanges.get(path);
        if (change) {
          await saveFile(path, change.content, change.sha);
        }
      }

      // Log the commit
      const fileList = modifiedFiles.map(f => `\`${f}\``).join(', ');
      await logCodeMessage(`💾 Committed changes to ${modifiedFiles.length} file(s): ${fileList}`, 'system');

      // Update pending changes to mark as committed (new original = current)
      setPendingChanges(prev => {
        const next = new Map(prev);
        modifiedFiles.forEach(path => {
          const change = next.get(path);
          if (change) {
            next.set(path, { ...change, originalContent: change.content });
          }
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

  // Count total modified files
  const modifiedFilesCount = useMemo(() => {
    let count = 0;
    pendingChanges.forEach((change) => {
      if (change.content !== change.originalContent) {
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
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }

      if (fileOperation.itemType === 'file') {
        // Rename file in storage-worker: read content, write to new path, delete old
        const content = await storageWorkerApi.getFileText(storageSessionId, `workspace/${fileOperation.path}`);
        if (content !== null) {
          await storageWorkerApi.writeFile(storageSessionId, `workspace/${newPath}`, content);
          await storageWorkerApi.deleteFile(storageSessionId, `workspace/${fileOperation.path}`);
        } else {
          throw new Error('File not found in storage');
        }
      } else {
        // For folders, we need to move all files - this is more complex
        // For now, throw an error as folder rename requires listing all files
        throw new Error('Folder rename is not yet supported in storage-worker mode');
      }

      // Refresh the file tree
      queryClient.invalidateQueries({ queryKey: ['file-tree'] });

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
      if (!storageSessionId) {
        throw new Error('No session ID available for storage operations');
      }

      if (fileOperation.itemType === 'file') {
        const success = await storageWorkerApi.deleteFile(storageSessionId, `workspace/${fileOperation.path}`);
        if (!success) {
          throw new Error('Failed to delete file from storage');
        }
      } else {
        // For folders, we need to delete all files - this is more complex
        // For now, throw an error as folder delete requires listing all files
        throw new Error('Folder delete is not yet supported in storage-worker mode');
      }

      // Refresh the file tree
      queryClient.invalidateQueries({ queryKey: ['file-tree'] });

      // Log the delete operation as a chat message (persisted to database)
      const deleteIcon = fileOperation.itemType === 'file' ? '📄' : '📁';
      const deleteMessage = `🗑️ Deleted ${deleteIcon} ${fileOperation.itemType}: \`${fileOperation.path}\``;
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
  }, [codeSession, fileOperation, activeTabPath, closeModal, queryClient, loadFileContent, logCodeMessage]);

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
        return (
          <div
            key={node.path}
            onClick={() => handleFileClick(node.path, node.name)}
            onDoubleClick={() => handleFileDoubleClick(node.path, node.name)}
            className={`group flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
              isActive ? 'bg-base-300' : ''
            }`}
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

  // Line count for the editor (memoized to avoid recalculating on every render)
  const lineCount = useMemo(() => {
    if (!fileContent) return 0;
    return fileContent.split('\n').length;
  }, [fileContent]);

  // Code Editor JSX (not a component - just JSX to avoid remounting)
  const codeEditorContent = (
    <div className="flex h-full">
      {/* File Explorer Sidebar */}
      <div className="w-64 bg-base-100 border-r border-base-300 overflow-y-auto flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
          <span className="text-sm font-semibold uppercase tracking-wide">Explorer</span>
          <div className="flex gap-1">
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['file-tree'] })}
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
          ) : fileContent !== null ? (
            <div className="h-full flex flex-col">
              <div className="flex-1 flex min-h-0">
                {/* Line Numbers - using a single pre element for better performance */}
                <pre className="bg-base-300/50 text-base-content/40 font-mono text-sm py-4 pr-2 pl-3 select-none overflow-hidden flex-shrink-0 text-right leading-6 m-0">
                  {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
                </pre>

                {/* Text Editor */}
                <textarea
                  ref={textareaRef}
                  value={fileContent}
                  onChange={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    handleContentChange(target.value, target.selectionStart, target.selectionEnd);
                  }}
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
                  className="flex-1 bg-base-200 text-base-content font-mono text-sm p-4 resize-none focus:outline-none leading-6 overflow-auto border-none"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  style={{
                    tabSize: 2,
                    MozTabSize: 2,
                  }}
                />
              </div>
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

  // Repository Selector View
  const RepoSelector = () => {
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

    return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-base-content mb-2">Start Code Session</h1>
        <p className="text-base-content/70">
          Select a repository to start editing. A new branch will be created for your changes:
          <code className="ml-2 px-2 py-1 bg-base-200 rounded text-sm">
            webedt/started-from-code-{'{id}'}
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
              onClick={() => !isInitializing && initializeCodeSession(repo)}
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

    if (!codeSession) {
      return <RepoSelector />;
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
