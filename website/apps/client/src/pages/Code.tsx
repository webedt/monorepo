import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { githubApi, sessionsApi } from '@/lib/api';

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

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

interface CodeSession {
  owner: string;
  repo: string;
  branch: string;
  baseBranch: string;
}

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

// Transform GitHub tree to our TreeNode format
const transformGitHubTree = (items: GitHubTreeItem[]): TreeNode[] => {
  const root: FolderNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Sort items: directories first, then alphabetically
  const sortedItems = [...items].sort((a, b) => {
    if (a.type === 'tree' && b.type !== 'tree') return -1;
    if (a.type !== 'tree' && b.type === 'tree') return 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sortedItems) {
    const pathParts = item.path.split('/');
    let currentLevel = root;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const currentPath = pathParts.slice(0, i + 1).join('/');
      const isLastPart = i === pathParts.length - 1;

      if (isLastPart) {
        if (item.type === 'blob') {
          // It's a file
          currentLevel.children.push({
            name: part,
            path: currentPath,
            type: 'file',
            icon: getFileIcon(part),
          });
        } else {
          // It's a directory (tree) - only add if not already exists
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

export default function Code() {
  const { sessionId } = useParams<{ sessionId?: string }>();
  const location = useLocation();
  const queryClient = useQueryClient();

  // Get pre-selected settings from navigation state (from QuickSessionSetup)
  const preSelectedSettings = (location.state as { preSelectedSettings?: PreSelectedSettings } | null)?.preSelectedSettings;
  const hasInitializedFromPreSelected = useRef(false);

  // Code session state
  const [codeSession, setCodeSession] = useState<CodeSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isFromExistingSession, setIsFromExistingSession] = useState(false);

  // File explorer state
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

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

  // Fetch file tree when code session is active
  const { data: treeData, isLoading: isLoadingTree } = useQuery({
    queryKey: ['github-tree', codeSession?.owner, codeSession?.repo, codeSession?.branch],
    queryFn: () => githubApi.getTree(codeSession!.owner, codeSession!.repo, codeSession!.branch),
    enabled: !!codeSession,
  });

  // Transform the GitHub tree into our TreeNode format
  const fileTree = useMemo(() => {
    if (!treeData?.data?.tree) return [];
    return transformGitHubTree(treeData.data.tree);
  }, [treeData]);

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
      await createBranchMutation.mutateAsync({
        owner,
        repo: repoName,
        branchName,
        baseBranch,
      });

      setCodeSession({
        owner,
        repo: repoName,
        branch: branchName,
        baseBranch,
      });
      setIsFromExistingSession(false);

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
      await createBranchMutation.mutateAsync({
        owner,
        repo: repoName,
        branchName,
        baseBranch,
      });

      setCodeSession({
        owner,
        repo: repoName,
        branch: branchName,
        baseBranch,
      });
      setIsFromExistingSession(false);

      // Expand root folders by default
      setExpandedFolders(new Set());
    } catch (error: any) {
      console.error('Failed to create branch:', error);
      setInitError(error.message || 'Failed to create branch');
    } finally {
      setIsInitializing(false);
    }
  };

  // Load file content when a file is selected
  const loadFileContent = async (path: string) => {
    if (!codeSession) return;

    setIsLoadingFile(true);
    try {
      const response = await githubApi.getFileContent(
        codeSession.owner,
        codeSession.repo,
        path,
        codeSession.branch
      );
      setFileContent(response.data.content || '');
    } catch (error: any) {
      console.error('Failed to load file:', error);
      setFileContent(`// Error loading file: ${error.message}`);
    } finally {
      setIsLoadingFile(false);
    }
  };

  // Handle single-click on file - opens as preview tab
  const handleFileClick = (path: string, name: string) => {
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

  // Handle double-click on file - opens as permanent tab
  const handleFileDoubleClick = (path: string, name: string) => {
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
            className={`flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300 ${
              isActive ? 'bg-base-300' : ''
            }`}
            style={{ paddingLeft }}
          >
            <span className="text-xs">{node.icon}</span>
            <span className="text-sm truncate">{node.name}</span>
          </div>
        );
      }

      const isExpanded = expandedFolders.has(node.path);
      return (
        <div key={node.path}>
          <div
            onClick={() => toggleFolder(node.path)}
            className="flex items-center gap-2 py-1 px-2 cursor-pointer hover:bg-base-300"
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
            <span className="text-sm font-medium">{node.name}</span>
          </div>
          {isExpanded && node.children.length > 0 && renderFileTree(node.children, level + 1)}
        </div>
      );
    });
  };

  // Code Editor component with real file content
  const CodeEditor = () => (
    <div className="flex h-full">
      {/* File Explorer Sidebar */}
      <div className="w-64 bg-base-100 border-r border-base-300 overflow-y-auto flex-shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
          <span className="text-sm font-semibold uppercase tracking-wide">Explorer</span>
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
        {codeSession && (
          <div className="px-3 py-2 border-b border-base-300 bg-base-200">
            <div className="text-xs text-base-content/70">Branch</div>
            <div className="text-sm font-medium text-primary truncate" title={codeSession.branch}>
              {codeSession.branch}
            </div>
          </div>
        )}

        <div className="py-2">
          {isLoadingTree ? (
            <div className="flex items-center justify-center py-8">
              <span className="loading loading-spinner loading-sm"></span>
            </div>
          ) : fileTree.length > 0 ? (
            renderFileTree(fileTree)
          ) : (
            <div className="px-3 py-4 text-sm text-base-content/70 text-center">
              No files found
            </div>
          )}
        </div>
      </div>

      {/* Code Editor Area */}
      <div className="flex-1 flex flex-col bg-base-200 min-w-0">
        {/* Tab Bar */}
        <div className="flex items-center bg-base-100 border-b border-base-300 overflow-x-auto">
          {tabs.length > 0 ? (
            tabs.map((tab) => {
              const isActive = tab.path === activeTabPath;
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
              Select a file to view
            </div>
          )}
        </div>

        {/* Code Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingFile ? (
            <div className="flex items-center justify-center h-full">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : fileContent !== null ? (
            <div className="p-4 font-mono text-sm">
              {fileContent.split('\n').map((line, i) => (
                <div key={i} className="flex">
                  <span className="text-base-content/40 select-none w-12 text-right pr-4 flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-base-content whitespace-pre">
                    {line.length === 0 ? '\u00A0' : line}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-base-content/50">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                </svg>
                <p>Select a file from the explorer to view its contents</p>
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

  // Code Session View with header
  const CodeSessionView = () => {
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

    return (
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
                  {codeSession.owner}/{codeSession.repo}
                </h2>
                <p className="text-xs text-base-content/70">
                  Branch: <span className="text-primary">{codeSession.branch}</span>
                  <span className="mx-2">•</span>
                  Base: {codeSession.baseBranch}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://github.com/${codeSession.owner}/${codeSession.repo}/tree/${codeSession.branch}`}
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

        {/* Code Editor */}
        <div className="flex-1 min-h-0">
          <CodeEditor />
        </div>
      </div>
    );
  };

  // Always use SessionLayout to show status bar
  return (
    <SessionLayout>
      <CodeSessionView />
    </SessionLayout>
  );
}
