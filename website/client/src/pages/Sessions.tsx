import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { sessionsApi, githubApi } from '@/lib/api';
import { useAuthStore, useSessionLastPageStore, useRecentReposStore, type SessionPageName } from '@/lib/store';
import ChatInput, { type ImageAttachment } from '@/components/ChatInput';
import type { ChatSession, GitHubRepository } from '@/shared';
import { truncateSessionName } from '@/lib/utils';
import { useSessionListUpdates } from '@/hooks/useSessionListUpdates';

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

// Helper to get icon for a page type
function getPageIcon(page: SessionPageName): React.ReactNode {
  const iconClass = "w-4 h-4 text-base-content/60";
  switch (page) {
    case 'chat':
      return <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>;
    case 'code':
      return <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>;
    case 'images':
      return <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/></svg>;
    case 'sound':
      return <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/></svg>;
    case 'scene-editor':
      return <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/></svg>;
    case 'preview':
      return <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>;
    default:
      return <svg className={iconClass} fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>;
  }
}

export default function Sessions() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { getLastPage } = useSessionLastPageStore();
  const { addRecentRepo } = useRecentReposStore();

  // Session editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Chat input state
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');

  // Use standard query for sessions (API doesn't support pagination yet)
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
  });

  // Subscribe to real-time session updates via SSE (replaces polling)
  useSessionListUpdates();

  const allSessions: ChatSession[] = data?.data?.sessions || [];

  // Filter sessions based on search query
  const sessions = useMemo(() => {
    if (!searchQuery.trim()) {
      return allSessions;
    }
    const query = searchQuery.toLowerCase();
    return allSessions.filter((session) => {
      // Search in user request (title)
      if (session.userRequest?.toLowerCase().includes(query)) {
        return true;
      }
      // Search in repository URL
      if (session.repositoryUrl?.toLowerCase().includes(query)) {
        return true;
      }
      // Search in branch name
      if (session.branch?.toLowerCase().includes(query)) {
        return true;
      }
      // Search in status
      if (session.status?.toLowerCase().includes(query)) {
        return true;
      }
      return false;
    });
  }, [allSessions, searchQuery]);

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
  // Also add to recent repos when a repo is selected
  useEffect(() => {
    if (hasLoadedFromStorage) {
      if (selectedRepo) {
        localStorage.setItem('lastSelectedRepo', selectedRepo);
        addRecentRepo(selectedRepo);
      } else {
        localStorage.removeItem('lastSelectedRepo');
      }
    }
  }, [selectedRepo, hasLoadedFromStorage, addRecentRepo]);

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
    onMutate: async (id: string) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['sessions'] });

      // Snapshot the previous value
      const previousSessions = queryClient.getQueryData(['sessions']);

      // Optimistically remove the session from the list
      queryClient.setQueryData(['sessions'], (old: any) => {
        if (!old?.data?.sessions) return old;
        return {
          ...old,
          data: {
            ...old.data,
            sessions: old.data.sessions.filter((s: ChatSession) => s.id !== id),
          },
        };
      });

      // Return context with the previous value
      return { previousSessions };
    },
    onError: (_err, _id, context) => {
      // Roll back to previous state on error
      if (context?.previousSessions) {
        queryClient.setQueryData(['sessions'], context.previousSessions);
      }
    },
    onSuccess: (_data, id) => {
      setSelectedIds((prev) => prev.filter((i) => i !== id));
    },
    onSettled: () => {
      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  const deleteBulkMutation = useMutation({
    mutationFn: (ids: string[]) => sessionsApi.deleteBulk(ids),
    onMutate: async (ids: string[]) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['sessions'] });

      // Snapshot the previous value
      const previousSessions = queryClient.getQueryData(['sessions']);

      // Optimistically remove the sessions from the list
      queryClient.setQueryData(['sessions'], (old: any) => {
        if (!old?.data?.sessions) return old;
        return {
          ...old,
          data: {
            ...old.data,
            sessions: old.data.sessions.filter((s: ChatSession) => !ids.includes(s.id)),
          },
        };
      });

      // Return context with the previous value
      return { previousSessions };
    },
    onError: (_err, _ids, context) => {
      // Roll back to previous state on error
      if (context?.previousSessions) {
        queryClient.setQueryData(['sessions'], context.previousSessions);
      }
    },
    onSuccess: () => {
      setSelectedIds([]);
    },
    onSettled: () => {
      // Refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  // Sync sessions from Anthropic API and sync events for all non-trashed sessions
  const syncMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Sync sessions from Anthropic
      const syncResult = await sessionsApi.sync({ activeOnly: true });

      // Step 2: Get all non-trashed sessions and sync their events
      const activeSessions = allSessions.filter((s) => !s.deletedAt);

      if (activeSessions.length > 0) {
        console.log(`[Sync] Syncing events for ${activeSessions.length} session(s)`);
        // Sync events in parallel
        const eventSyncPromises = activeSessions.map((session) =>
          sessionsApi.syncEvents(session.id).catch((err) => {
            console.warn(`[Sync] Failed to sync events for session ${session.id}:`, err);
            return null; // Don't fail the whole sync if one session fails
          })
        );
        await Promise.all(eventSyncPromises);
      }

      return syncResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      const result = data?.data;
      if (result?.imported > 0) {
        console.log(`[Sync] Imported ${result.imported} session(s) from Anthropic`);
      }
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

        {/* Search bar */}
        <div className="max-w-md mx-auto mb-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-base-content/50"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search sessions by title, repository, branch, or status..."
              className="input input-bordered w-full pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                <svg
                  className="h-5 w-5 text-base-content/50 hover:text-base-content"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-sm text-base-content/70 mt-2 text-center">
              Found {sessions.length} session{sessions.length !== 1 ? 's' : ''} matching "{searchQuery}"
            </p>
          )}
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
                disabled={deleteBulkMutation.isPending}
              >
                {deleteBulkMutation.isPending ? (
                  <>
                    <span className="loading loading-spinner loading-xs"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete selected'
                )}
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
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => syncMutation.mutate()}
                    className="btn btn-ghost btn-sm"
                    title="Sync sessions from Anthropic"
                    disabled={syncMutation.isPending}
                  >
                    {syncMutation.isPending ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                      </svg>
                    )}
                    Sync
                  </button>
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
                        <Link to={getSessionUrl(session.id, getLastPage)} className="flex items-start gap-2">
                          <span className="flex-shrink-0 mt-0.5" title={`Last page: ${getLastPage(session.id)}`}>
                            {getPageIcon(getLastPage(session.id) as SessionPageName)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-primary truncate" title={session.userRequest}>
                              {truncateSessionName(session.userRequest, 80)}
                            </p>
                            <p className="mt-1 text-sm text-base-content/70">
                              {session.repositoryUrl || 'No repository'}
                            </p>
                          </div>
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
