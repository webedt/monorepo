import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { sessionsApi, githubApi } from '@/lib/api';
import { useAuthStore, useSessionLastPageStore } from '@/lib/store';
import ChatInput, { type ImageAttachment } from '@/components/ChatInput';
import type { ChatSession, GitHubRepository } from '@webedt/shared';
import { truncateSessionName } from '@/lib/utils';

// Helper to get the session URL with last visited page
function getSessionUrl(sessionId: string, getLastPage: (id: string) => string): string {
  const lastPage = getLastPage(sessionId);
  // For 'chat', we can use just the session id (defaults to chat)
  // For other pages, append the page name
  if (lastPage === 'chat') {
    return `/session/${sessionId}`;
  }
  return `/session/${sessionId}/${lastPage}`;
}

export default function Sessions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { getLastPage } = useSessionLastPageStore();

  // Session editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Chat input state
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');

  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    refetchInterval: (query) => {
      // Poll every 3 seconds if there are any running sessions
      const sessions = query.state.data?.data?.sessions || [];
      const hasRunning = sessions.some((s: ChatSession) => s.status === 'running');
      return hasRunning ? 3000 : false;
    },
  });

  const sessions: ChatSession[] = data?.data?.sessions || [];

  // Load repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: !!user?.githubAccessToken,
  });

  const repositories: GitHubRepository[] = reposData?.data || [];

  // Load last selected repo from localStorage when repositories are loaded (only once)
  const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
  useEffect(() => {
    if (repositories.length > 0 && !hasLoadedFromStorage) {
      const lastSelectedRepo = localStorage.getItem('lastSelectedRepo');
      if (lastSelectedRepo) {
        // Verify the repo still exists in the list
        const repoExists = repositories.some(repo => repo.cloneUrl === lastSelectedRepo);
        if (repoExists) {
          setSelectedRepo(lastSelectedRepo);
        }
      }
      setHasLoadedFromStorage(true);
    }
  }, [repositories, hasLoadedFromStorage]);

  // Save selected repo to localStorage whenever it changes (including clearing)
  useEffect(() => {
    if (hasLoadedFromStorage) {
      if (selectedRepo) {
        localStorage.setItem('lastSelectedRepo', selectedRepo);
      } else {
        localStorage.removeItem('lastSelectedRepo');
      }
    }
  }, [selectedRepo, hasLoadedFromStorage]);

  const updateMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      sessionsApi.update(id, { userRequest: title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setEditingId(null);
      setEditTitle('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sessionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSelectedIds([]);
    },
  });

  const deleteBulkMutation = useMutation({
    mutationFn: (ids: string[]) => sessionsApi.deleteBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setSelectedIds([]);
    },
  });


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if ((!input.trim() && images.length === 0) || !user?.claudeAuth) return;

    // Build userRequest - either string or content blocks
    let userRequestParam: string | any[];

    if (images.length > 0) {
      // Create content blocks for multimodal request
      const contentBlocks: any[] = [];

      // Add text block if there's text
      if (input.trim()) {
        contentBlocks.push({
          type: 'text',
          text: input.trim(),
        });
      }

      // Add image blocks
      images.forEach((image) => {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: image.mediaType,
            data: image.data,
          },
        });
      });

      userRequestParam = contentBlocks;
    } else {
      userRequestParam = input.trim();
    }

    // Navigate to Chat with execute params - let Chat create the session and handle streaming
    navigate('/session/new', {
      state: {
        startStream: true,
        streamParams: {
          userRequest: userRequestParam,
          github: (selectedRepo && baseBranch) ? {
            repoUrl: selectedRepo,
            branch: baseBranch,
          } : undefined,
          autoCommit: true,
        }
      }
    });

    setInput('');
    setImages([]);
  };

  const handleEdit = (session: ChatSession) => {
    setEditingId(session.id);
    setEditTitle(session.userRequest);
  };

  const handleSaveEdit = (id: string) => {
    if (editTitle.trim()) {
      updateMutation.mutate({ id, title: editTitle.trim() });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  // Bulk selection handlers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === sessions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sessions.map((s) => s.id));
    }
  };

  const handleBulkDelete = () => {
    deleteBulkMutation.mutate(selectedIds);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">My Sessions</h1>
          <p className="text-sm text-base-content/70">
            Quick start below, or view and manage all my sessions
          </p>
        </div>

        {/* Quick start chat input */}
        <ChatInput
          input={input}
          setInput={setInput}
          images={images}
          setImages={setImages}
          onSubmit={handleSubmit}
          isExecuting={false}
          selectedRepo={selectedRepo}
          setSelectedRepo={setSelectedRepo}
          baseBranch={baseBranch}
          setBaseBranch={setBaseBranch}
          repositories={repositories}
          isLoadingRepos={isLoadingRepos}
          isLocked={false}
          user={user}
          centered={false}
          ignoreGlobalExecution={true}
        />
      </div>

      {isLoading && (
        <div className="text-center py-12">
          <span className="loading loading-spinner loading-lg text-primary"></span>
          <p className="mt-2 text-base-content/70">Loading sessions...</p>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>{error instanceof Error ? error.message : 'Failed to load sessions'}</span>
        </div>
      )}

      {!isLoading && !error && sessions.length === 0 && (
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
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-base-content">No sessions</h3>
          <p className="mt-1 text-sm text-base-content/70">
            Get started by using the quick start chat above.
          </p>
          <button
            onClick={() => navigate('/trash')}
            className="btn btn-ghost btn-sm mt-4"
            title="View deleted sessions"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            View Trash
          </button>
        </div>
      )}

      {!isLoading && !error && sessions.length > 0 && (
        <>
          {/* Bulk actions bar */}
          {selectedIds.length > 0 && (
            <div className="bg-primary/10 border border-primary rounded-md px-4 py-3 mb-4 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <span className="text-sm font-medium">
                  {selectedIds.length} session{selectedIds.length !== 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={() => setSelectedIds([])}
                  className="btn btn-ghost btn-xs"
                >
                  Clear selection
                </button>
              </div>
              <button
                onClick={handleBulkDelete}
                className="btn btn-error btn-sm"
              >
                Delete selected
              </button>
            </div>
          )}

          <div className="bg-base-100 shadow overflow-hidden sm:rounded-md">
            {/* Select all header */}
            <div className="px-4 py-3 border-b border-base-300 bg-base-200/50">
              <div className="flex items-center justify-between">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={sessions.length > 0 && selectedIds.length === sessions.length}
                    onChange={handleSelectAll}
                  />
                  <span className="text-sm font-medium">
                    Select all ({sessions.length})
                  </span>
                </label>
                <button
                  onClick={() => navigate('/trash')}
                  className="btn btn-ghost btn-sm"
                  title="View deleted sessions"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Trash
                </button>
              </div>
            </div>

            <ul className="divide-y divide-base-300">
              {sessions.map((session) => (
                <li key={session.id}>
                  <div className="px-4 py-4 sm:px-6 hover:bg-base-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selectedIds.includes(session.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleToggleSelect(session.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="flex-1 min-w-0">
                      {editingId === session.id ? (
                        <div className="flex items-center space-x-2">
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="flex-1 input input-bordered input-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(session.id);
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                          />
                          <button
                            onClick={() => handleSaveEdit(session.id)}
                            className="btn btn-success btn-xs"
                            disabled={updateMutation.isPending}
                          >
                            Save
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="btn btn-ghost btn-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <Link to={getSessionUrl(session.id, getLastPage)}>
                          <p className="text-sm font-medium text-primary truncate" title={session.userRequest}>
                            {truncateSessionName(session.userRequest, 80)}
                          </p>
                          <p className="mt-1 text-sm text-base-content/70">
                            {session.repositoryUrl || 'No repository'}
                          </p>
                        </Link>
                      )}
                    </div>
                    <div className="ml-4 flex-shrink-0 flex items-center space-x-4">
                      <div className="flex items-center gap-2">
                        {session.status === 'running' && (
                          <span className="loading loading-spinner loading-xs text-info"></span>
                        )}
                        <span
                          className={`badge ${
                            session.status === 'completed'
                              ? 'badge-success'
                              : session.status === 'running'
                              ? 'badge-info'
                              : session.status === 'error'
                              ? 'badge-error'
                              : 'badge-ghost'
                          }`}
                        >
                          {session.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-base-content/70">
                          {new Date(session.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-base-content/60">
                          {new Date(session.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                      {editingId !== session.id && (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleEdit(session);
                            }}
                            className="btn btn-ghost btn-xs btn-circle"
                            title="Edit session title"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-5 w-5"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleDelete(session.id);
                            }}
                            className="btn btn-ghost btn-xs btn-circle text-error"
                            title="Delete session"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-5 w-5"
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
                      )}
                    </div>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
