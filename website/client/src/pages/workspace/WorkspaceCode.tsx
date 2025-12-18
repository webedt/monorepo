import { useState, useCallback } from 'react';
import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import { useGitHubFiles, TreeNode, FolderNode } from '@/hooks/useGitHubFiles';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';
import { SyntaxHighlightedEditor } from '@/components/SyntaxHighlightedEditor';

// Helper to get file icon based on extension
const getFileIcon = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const iconMap: Record<string, string> = {
    js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
    css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
    html: '🌐', htm: '🌐', json: '📦',
    md: '📝', mdx: '📝',
    py: '🐍', rb: '💎', go: '🔵', rs: '🦀',
    java: '☕', kt: '🟣', swift: '🍎',
    c: '🔵', cpp: '🔵', h: '🔵', hpp: '🔵', cs: '🟣',
    php: '🐘', vue: '💚', svelte: '🔶',
    yaml: '📋', yml: '📋', toml: '📋', xml: '📋',
    svg: '🖼️', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', ico: '🖼️',
    sh: '💻', bash: '💻', zsh: '💻', fish: '💻',
    sql: '🗃️', graphql: '💠', gql: '💠',
    dockerfile: '🐳', gitignore: '📁', env: '🔐', lock: '🔒',
  };
  return iconMap[ext || ''] || '📄';
};

interface FileTreeItemProps {
  node: TreeNode;
  depth: number;
  expandedFolders: Set<string>;
  selectedFile: string | null;
  onToggleFolder: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function FileTreeItem({
  node,
  depth,
  expandedFolders,
  selectedFile,
  onToggleFolder,
  onSelectFile,
}: FileTreeItemProps) {
  const isFolder = node.type === 'folder';
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedFile === node.path;

  return (
    <div>
      <button
        onClick={() => isFolder ? onToggleFolder(node.path) : onSelectFile(node.path)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 text-sm text-left hover:bg-base-200 transition-colors ${
          isSelected ? 'bg-primary/10 text-primary' : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isFolder ? (
          <>
            <span className="text-base-content/60">
              {isExpanded ? '📂' : '📁'}
            </span>
            <span className="truncate">{node.name}</span>
          </>
        ) : (
          <>
            <span>{getFileIcon(node.name)}</span>
            <span className="truncate">{node.name}</span>
          </>
        )}
      </button>
      {isFolder && isExpanded && (
        <div>
          {(node as FolderNode).children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              selectedFile={selectedFile}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Workspace Code Editor - Live workspace mode for editing code files.
 * Uses GitHub API directly for file operations.
 */
export default function WorkspaceCode() {
  const workspace = useWorkspaceParams();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [fileSha, setFileSha] = useState<string>('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const { owner, repo, branch } = workspace || { owner: '', repo: '', branch: '' };

  const {
    tree,
    isLoadingTree,
    treeError,
    refetchTree,
    getFileContent,
    updateFile,
    isUpdating,
  } = useGitHubFiles({
    owner,
    repo,
    branch,
    enabled: !!workspace,
  });

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectFile = useCallback(async (path: string) => {
    if (!workspace) return;

    setSelectedFile(path);
    setIsLoadingFile(true);
    setHasChanges(false);

    try {
      const result = await getFileContent(path);
      if (result) {
        setFileContent(result.content);
        setOriginalContent(result.content);
        setFileSha(result.sha);
      } else {
        setFileContent('');
        setOriginalContent('');
        setFileSha('');
      }
    } catch (error) {
      console.error('Failed to load file:', error);
      setFileContent('// Failed to load file');
      setOriginalContent('');
      setFileSha('');
    } finally {
      setIsLoadingFile(false);
    }
  }, [workspace, getFileContent]);

  const handleContentChange = useCallback((value: string, _selectionStart: number, _selectionEnd: number) => {
    setFileContent(value);
    setHasChanges(value !== originalContent);
  }, [originalContent]);

  const handleSave = useCallback(async () => {
    if (!selectedFile || !hasChanges) return;

    try {
      // Encode content to base64
      const base64Content = btoa(unescape(encodeURIComponent(fileContent)));
      await updateFile({
        path: selectedFile,
        content: base64Content,
        sha: fileSha,
        message: `Update ${selectedFile}`,
      });
      setOriginalContent(fileContent);
      setHasChanges(false);
      // Refetch tree to get new SHA
      refetchTree();
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [selectedFile, fileContent, fileSha, hasChanges, updateFile, refetchTree]);

  if (!workspace) {
    return null;
  }

  return (
    <WorkspaceLayout>
      <div className="flex h-full">
        {/* File Tree Sidebar */}
        <div className="w-64 border-r border-base-300 bg-base-100 flex flex-col">
          <div className="p-2 border-b border-base-300 flex items-center justify-between">
            <span className="text-sm font-medium">Files</span>
            <button
              onClick={() => refetchTree()}
              className="btn btn-ghost btn-xs"
              title="Refresh"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoadingTree ? (
              <div className="flex items-center justify-center py-8">
                <span className="loading loading-spinner loading-sm"></span>
              </div>
            ) : treeError ? (
              <div className="p-4 text-center text-error text-sm">
                Failed to load files
              </div>
            ) : tree.length === 0 ? (
              <div className="p-4 text-center text-base-content/60 text-sm">
                No files found
              </div>
            ) : (
              <div className="py-1">
                {tree.map((node) => (
                  <FileTreeItem
                    key={node.path}
                    node={node}
                    depth={0}
                    expandedFolders={expandedFolders}
                    selectedFile={selectedFile}
                    onToggleFolder={handleToggleFolder}
                    onSelectFile={handleSelectFile}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedFile ? (
            <>
              {/* File Header */}
              <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
                <div className="flex items-center gap-2 min-w-0">
                  <span>{getFileIcon(selectedFile)}</span>
                  <span className="text-sm truncate">{selectedFile}</span>
                  {hasChanges && (
                    <span className="badge badge-warning badge-xs">Modified</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || isUpdating}
                    className="btn btn-primary btn-xs"
                  >
                    {isUpdating ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>
              {/* Editor */}
              <div className="flex-1 overflow-hidden">
                {isLoadingFile ? (
                  <div className="flex items-center justify-center h-full">
                    <span className="loading loading-spinner loading-md"></span>
                  </div>
                ) : (
                  <SyntaxHighlightedEditor
                    content={fileContent}
                    filename={selectedFile}
                    onChange={handleContentChange}
                    className="h-full"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-base-200">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto text-base-content/30 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
                </svg>
                <p className="text-base-content/60">Select a file to edit</p>
                <p className="text-sm text-base-content/40 mt-1">
                  {owner}/{repo} @ {branch}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceLayout>
  );
}
