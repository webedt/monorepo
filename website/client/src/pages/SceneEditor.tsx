import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';
import { githubApi, sessionsApi, storageWorkerApi } from '@/lib/api';
import { useSceneEditor } from '@/hooks/useSceneEditor';
import { SceneCanvas, SceneToolbar, SceneHierarchy, ScenePropertyPanel } from '@/components/editor/scene';
import type { SceneFile } from '@/types/scene';

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

  // Get pre-selected settings from navigation state
  const preSelectedSettings = (location.state as { preSelectedSettings?: PreSelectedSettings } | null)?.preSelectedSettings;
  const hasInitializedFromPreSelected = useRef(false);

  // Scene session state
  const [sceneSession, setSceneSession] = useState<SceneSession | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  // UI state
  const [showHierarchy, setShowHierarchy] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [sceneName, setSceneName] = useState('Untitled Scene');

  // Scene editor hook
  const editor = useSceneEditor();

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
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
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
    } catch (error: any) {
      console.error('Failed to create branch:', error);
      setInitError(error.message || 'Failed to create branch');
    } finally {
      setIsInitializing(false);
    }
  };

  // Save scene to storage
  const handleSaveScene = useCallback(async () => {
    if (!sceneSession?.sessionId) {
      setShowSaveModal(true);
      return;
    }

    const sceneFile: SceneFile = {
      version: '1.0',
      scene: editor.scene,
    };

    const filename = `${sceneName.toLowerCase().replace(/\s+/g, '-')}.scene.json`;
    const content = JSON.stringify(sceneFile, null, 2);

    try {
      await storageWorkerApi.writeFile(sceneSession.sessionId, `workspace/scenes/${filename}`, content);
      console.log('[SceneEditor] Scene saved:', filename);
      setShowSaveModal(false);
    } catch (error) {
      console.error('[SceneEditor] Failed to save scene:', error);
    }
  }, [sceneSession, editor.scene, sceneName]);

  // Load scene from file
  const handleLoadScene = useCallback((json: string) => {
    const success = editor.importSceneJson(json);
    if (success) {
      setShowLoadModal(false);
    }
  }, [editor]);

  // Keyboard shortcuts for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveScene();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveScene]);

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

  // Repo selection when no session
  if (!sceneSession && !sessionId) {
    return (
      <div className="h-full flex items-center justify-center bg-base-200">
        <div className="max-w-md w-full p-6 bg-base-100 rounded-lg shadow-lg">
          <h2 className="text-xl font-bold mb-4">Scene Editor</h2>
          <p className="text-base-content/70 mb-6">
            Select a repository to start editing scenes, or continue without a repository for local editing.
          </p>

          {isLoadingRepos ? (
            <div className="text-center py-4">
              <span className="loading loading-spinner"></span>
            </div>
          ) : repos.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-base-content/50 mb-4">No repositories found. Connect your GitHub account or start local editing.</p>
              <button
                onClick={() => setSceneSession({ owner: '', repo: '', branch: '', baseBranch: '' })}
                className="btn btn-primary"
              >
                Start Local Editing
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {repos.slice(0, 5).map((repo) => (
                <button
                  key={repo.id}
                  onClick={() => initializeSceneSession(repo)}
                  disabled={isInitializing}
                  className="w-full text-left p-3 rounded-lg hover:bg-base-200 transition-colors border border-base-300"
                >
                  <div className="font-medium">{repo.name}</div>
                  <div className="text-xs text-base-content/50">{repo.fullName}</div>
                </button>
              ))}
              <div className="pt-4 border-t border-base-300 mt-4">
                <button
                  onClick={() => setSceneSession({ owner: '', repo: '', branch: '', baseBranch: '' })}
                  className="btn btn-ghost btn-sm w-full"
                >
                  Or start without a repository
                </button>
              </div>
            </div>
          )}

          {initError && (
            <div className="mt-4 p-3 bg-error/10 text-error rounded-lg text-sm">
              {initError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-base-300">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-base-100 border-b border-base-300">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">Scene Editor</h1>
          {sceneSession?.sessionId && (
            <span className="text-xs text-base-content/50">
              {sceneSession.owner}/{sceneSession.repo}
            </span>
          )}
          {editor.isDirty && (
            <span className="badge badge-warning badge-sm">Unsaved</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHierarchy(!showHierarchy)}
            className={`btn btn-sm ${showHierarchy ? 'btn-primary' : 'btn-ghost'}`}
            title="Toggle Hierarchy"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => setShowProperties(!showProperties)}
            className={`btn btn-sm ${showProperties ? 'btn-primary' : 'btn-ghost'}`}
            title="Toggle Properties"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Toolbar */}
        <SceneToolbar
          tool={editor.tool}
          viewport={editor.viewport}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          isDirty={editor.isDirty}
          onToolChange={editor.setTool}
          onUndo={editor.undo}
          onRedo={editor.redo}
          onZoomChange={editor.setZoom}
          onResetViewport={editor.resetViewport}
          onFitToContent={editor.fitToContent}
          onToggleGrid={editor.toggleGrid}
          onToggleSnap={editor.toggleSnapToGrid}
          onSave={handleSaveScene}
          onLoad={() => setShowLoadModal(true)}
          onNewScene={() => editor.newScene()}
        />

        {/* Hierarchy Panel */}
        {showHierarchy && (
          <div className="w-64 bg-base-100 border-r border-base-300 flex flex-col">
            <SceneHierarchy
              scene={editor.scene}
              selection={editor.selection}
              onSelectObject={editor.selectObject}
              onSetParent={editor.setObjectParent}
              onRemoveObject={editor.removeObject}
              onDuplicateObject={editor.duplicateObject}
              onUpdateObject={editor.updateObject}
            />
          </div>
        )}

        {/* Canvas Area */}
        <SceneCanvas
          scene={editor.scene}
          viewport={editor.viewport}
          selection={editor.selection}
          tool={editor.tool}
          onSelectObject={editor.selectObject}
          onDeselectAll={editor.deselectAll}
          onUpdateTransform={editor.updateObjectTransform}
          onSetHovered={editor.setHoveredObject}
          onAddRectangle={editor.addRectangle}
          onAddCircle={editor.addCircle}
          onAddText={editor.addText}
          onSetPan={editor.setPan}
          onSetZoom={editor.setZoom}
        />

        {/* Properties Panel */}
        {showProperties && (
          <div className="w-72 bg-base-100 border-l border-base-300">
            <ScenePropertyPanel
              scene={editor.scene}
              selectedIds={editor.selection.selectedIds}
              onUpdateObject={editor.updateObject}
              onUpdateTransform={editor.updateObjectTransform}
              onUpdateSceneViewport={editor.updateSceneViewport}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 bg-base-100 border-t border-base-300 text-xs text-base-content/70">
        <div className="flex items-center gap-4">
          <span>Scene: {editor.scene.viewport.width} × {editor.scene.viewport.height}</span>
          <span>Objects: {Object.keys(editor.scene.objects).length}</span>
          <span>Zoom: {editor.viewport.zoom}%</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Tool: {editor.tool}</span>
          {editor.selection.selectedIds.length > 0 && (
            <span>Selected: {editor.selection.selectedIds.length}</span>
          )}
        </div>
      </div>

      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Save Scene</h2>
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Scene Name</label>
              <input
                type="text"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
                className="input input-bordered w-full"
                placeholder="Enter scene name"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowSaveModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveScene}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Load Scene</h2>
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">Paste Scene JSON</label>
              <textarea
                className="textarea textarea-bordered w-full h-48 font-mono text-xs"
                placeholder='{"version": "1.0", "scene": {...}}'
                onChange={(e) => {
                  if (e.target.value) {
                    handleLoadScene(e.target.value);
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setShowLoadModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
