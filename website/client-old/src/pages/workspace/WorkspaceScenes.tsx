import { useState, useCallback, useMemo } from 'react';
import { useWorkspaceParams } from '@/hooks/useWorkspaceParams';
import { useGitHubFiles, TreeNode } from '@/hooks/useGitHubFiles';
import WorkspaceLayout from '@/components/workspace/WorkspaceLayout';
import { SyntaxHighlightedEditor } from '@/components/SyntaxHighlightedEditor';

// Scene folders to look for
const SCENE_FOLDERS = ['scenes', 'scene', 'levels', 'level'];

// Helper to check if a file is a scene file
const isSceneFile = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase();
  const folder = path.split('/')[0]?.toLowerCase();

  // Check if it's a .scene file
  if (ext === 'scene') return true;

  // Check if it's a JSON file in a scenes folder
  if (ext === 'json' && SCENE_FOLDERS.some(f => folder === f)) return true;

  // Check if filename contains 'scene'
  const filename = path.split('/').pop()?.toLowerCase() || '';
  if (ext === 'json' && filename.includes('scene')) return true;

  return false;
};

// Helper to collect all scene files from tree
const collectSceneFiles = (nodes: TreeNode[], result: TreeNode[] = []): TreeNode[] => {
  for (const node of nodes) {
    if (node.type === 'file' && isSceneFile(node.path)) {
      result.push(node);
    } else if (node.type === 'folder') {
      collectSceneFiles(node.children, result);
    }
  }
  return result;
};

// Also collect all JSON files as potential scenes
const collectJsonFiles = (nodes: TreeNode[], result: TreeNode[] = []): TreeNode[] => {
  for (const node of nodes) {
    if (node.type === 'file' && node.path.endsWith('.json')) {
      result.push(node);
    } else if (node.type === 'folder') {
      collectJsonFiles(node.children, result);
    }
  }
  return result;
};

/**
 * Workspace Scenes Editor - Live workspace mode for managing scene files.
 * Uses GitHub API directly for file operations.
 */
export default function WorkspaceScenes() {
  const workspace = useWorkspaceParams();
  const [selectedScene, setSelectedScene] = useState<string | null>(null);
  const [sceneContent, setSceneContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [sceneSha, setSceneSha] = useState<string>('');
  const [isLoadingScene, setIsLoadingScene] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showAllJson, setShowAllJson] = useState(false);

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

  // Collect scene files from the tree
  const sceneFiles = useMemo(() => {
    if (showAllJson) {
      return collectJsonFiles(tree);
    }
    return collectSceneFiles(tree);
  }, [tree, showAllJson]);

  const handleSelectScene = useCallback(async (path: string) => {
    if (!workspace) return;

    setSelectedScene(path);
    setIsLoadingScene(true);
    setHasChanges(false);

    try {
      const result = await getFileContent(path);
      if (result) {
        // Try to format JSON for better readability
        try {
          const parsed = JSON.parse(result.content);
          const formatted = JSON.stringify(parsed, null, 2);
          setSceneContent(formatted);
          setOriginalContent(formatted);
        } catch {
          // Not valid JSON, use as-is
          setSceneContent(result.content);
          setOriginalContent(result.content);
        }
        setSceneSha(result.sha);
      } else {
        setSceneContent('');
        setOriginalContent('');
        setSceneSha('');
      }
    } catch (error) {
      console.error('Failed to load scene:', error);
      setSceneContent('// Failed to load scene');
      setOriginalContent('');
      setSceneSha('');
    } finally {
      setIsLoadingScene(false);
    }
  }, [workspace, getFileContent]);

  const handleContentChange = useCallback((value: string, _selectionStart: number, _selectionEnd: number) => {
    setSceneContent(value);
    setHasChanges(value !== originalContent);
  }, [originalContent]);

  const handleSave = useCallback(async () => {
    if (!selectedScene || !hasChanges) return;

    try {
      // Validate JSON before saving
      try {
        JSON.parse(sceneContent);
      } catch {
        alert('Invalid JSON. Please fix syntax errors before saving.');
        return;
      }

      const base64Content = btoa(unescape(encodeURIComponent(sceneContent)));
      await updateFile({
        path: selectedScene,
        content: base64Content,
        sha: sceneSha,
        message: `Update ${selectedScene}`,
      });
      setOriginalContent(sceneContent);
      setHasChanges(false);
      refetchTree();
    } catch (error) {
      console.error('Failed to save scene:', error);
    }
  }, [selectedScene, sceneContent, sceneSha, hasChanges, updateFile, refetchTree]);

  if (!workspace) {
    return null;
  }

  return (
    <WorkspaceLayout>
      <div className="flex h-full">
        {/* Scene List Sidebar */}
        <div className="w-64 border-r border-base-300 bg-base-100 flex flex-col">
          <div className="p-2 border-b border-base-300">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Scenes</span>
              <button
                onClick={() => refetchTree()}
                className="btn btn-ghost btn-xs"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={showAllJson}
                onChange={(e) => setShowAllJson(e.target.checked)}
                className="checkbox checkbox-xs"
              />
              <span>Show all JSON files</span>
            </label>
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
            ) : sceneFiles.length === 0 ? (
              <div className="p-4 text-center text-base-content/60 text-sm">
                <svg className="w-12 h-12 mx-auto mb-2 text-base-content/30" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                </svg>
                {showAllJson ? 'No JSON files found' : 'No scene files found'}
                <p className="text-xs mt-1">
                  {!showAllJson && 'Try enabling "Show all JSON files"'}
                </p>
              </div>
            ) : (
              <div className="py-1">
                {sceneFiles.map((file) => {
                  const filename = file.path.split('/').pop() || file.path;
                  const folder = file.path.replace(filename, '').replace(/\/$/, '') || '';
                  const isSelected = selectedScene === file.path;

                  return (
                    <button
                      key={file.path}
                      onClick={() => handleSelectScene(file.path)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-base-200 transition-colors ${
                        isSelected ? 'bg-primary/10 text-primary' : ''
                      }`}
                    >
                      <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                      </svg>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{filename}</p>
                        {folder && (
                          <p className="text-xs text-base-content/50 truncate">{folder}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedScene ? (
            <>
              {/* Scene Header */}
              <div className="h-10 px-4 flex items-center justify-between border-b border-base-300 bg-base-100">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                  </svg>
                  <span className="text-sm truncate">{selectedScene}</span>
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
                {isLoadingScene ? (
                  <div className="flex items-center justify-center h-full">
                    <span className="loading loading-spinner loading-md"></span>
                  </div>
                ) : (
                  <SyntaxHighlightedEditor
                    content={sceneContent}
                    filename={selectedScene}
                    onChange={handleContentChange}
                    className="h-full"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-base-200">
              <div className="text-center">
                <svg className="w-16 h-16 mx-auto text-base-content/30 mb-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
                </svg>
                <p className="text-base-content/60">Select a scene to edit</p>
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
