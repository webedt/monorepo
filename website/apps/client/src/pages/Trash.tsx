import { useState, useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { sessionsApi } from '@/lib/api';
import type { ChatSession } from '@webedt/shared';
import { truncateSessionName } from '@/lib/utils';

export default function Trash() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedDeletedIds, setSelectedDeletedIds] = useState<string[]>([]);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Infinite query for deleted sessions
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['sessions', 'deleted'],
    queryFn: ({ pageParam = 0 }) => sessionsApi.listDeleted({ limit: 20, offset: pageParam }),
    getNextPageParam: (lastPage) => {
      const { offset, limit, hasMore } = lastPage.data;
      return hasMore ? offset + limit : undefined;
    },
    initialPageParam: 0,
  });

  // Flatten all pages into a single array
  const deletedSessions: ChatSession[] = data?.pages.flatMap((page) => page.data.sessions) || [];
  const totalCount = data?.pages[0]?.data?.total || 0;

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const restoreBulkMutation = useMutation({
    mutationFn: (ids: string[]) => sessionsApi.restoreBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', 'deleted'] });
      setSelectedDeletedIds([]);
    },
  });

  const deletePermanentBulkMutation = useMutation({
    mutationFn: (ids: string[]) => sessionsApi.deletePermanentBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', 'deleted'] });
      setSelectedDeletedIds([]);
    },
  });

  const handleSelectAll = () => {
    if (selectedDeletedIds.length === deletedSessions.length) {
      setSelectedDeletedIds([]);
    } else {
      setSelectedDeletedIds(deletedSessions.map((s) => s.id));
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedDeletedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="bg-base-100 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/sessions')}
                className="btn btn-ghost btn-sm btn-circle"
                title="Back to sessions"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div className="flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-8 w-8"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <h1 className="text-3xl font-bold text-base-content">Trash</h1>
              </div>
            </div>
            <div className="text-sm text-base-content/70">
              {totalCount} deleted session{totalCount !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading && (
          <div className="text-center py-12">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="mt-2 text-base-content/70">Loading deleted sessions...</p>
          </div>
        )}

        {error && (
          <div className="alert alert-error">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{error instanceof Error ? error.message : 'Failed to load deleted sessions'}</span>
          </div>
        )}

        {!isLoading && !error && deletedSessions.length === 0 && (
          <div className="text-center py-12 bg-base-100 rounded-lg shadow">
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-base-content">Trash is empty</h3>
            <p className="mt-1 text-sm text-base-content/70">
              No deleted sessions found.
            </p>
          </div>
        )}

        {!isLoading && !error && deletedSessions.length > 0 && (
          <>
            {/* Bulk actions bar */}
            {selectedDeletedIds.length > 0 && (
              <div className="bg-primary/10 border border-primary rounded-md px-4 py-3 mb-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center space-x-4">
                  <span className="text-sm font-medium">
                    {selectedDeletedIds.length} session{selectedDeletedIds.length !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={() => setSelectedDeletedIds([])}
                    className="btn btn-ghost btn-xs"
                  >
                    Clear selection
                  </button>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => restoreBulkMutation.mutate(selectedDeletedIds)}
                    className="btn btn-success btn-sm"
                    disabled={restoreBulkMutation.isPending}
                  >
                    {restoreBulkMutation.isPending ? 'Restoring...' : 'Restore selected'}
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Permanently delete ${selectedDeletedIds.length} session${
                            selectedDeletedIds.length !== 1 ? 's' : ''
                          }? This cannot be undone.`
                        )
                      ) {
                        deletePermanentBulkMutation.mutate(selectedDeletedIds);
                      }
                    }}
                    className="btn btn-error btn-sm"
                    disabled={deletePermanentBulkMutation.isPending}
                  >
                    {deletePermanentBulkMutation.isPending ? 'Deleting...' : 'Delete permanently'}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-base-100 shadow overflow-hidden sm:rounded-md">
              {/* Select all header */}
              <div className="px-4 py-3 border-b border-base-300 bg-base-200/50">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={deletedSessions.length > 0 && selectedDeletedIds.length === deletedSessions.length}
                    onChange={handleSelectAll}
                  />
                  <span className="text-sm font-medium">
                    Select all ({deletedSessions.length} loaded)
                  </span>
                </label>
              </div>

              <ul className="divide-y divide-base-300">
                {deletedSessions.map((session) => (
                  <li key={session.id}>
                    <div className="px-4 py-4 sm:px-6 hover:bg-base-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-sm"
                            checked={selectedDeletedIds.includes(session.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleSelect(session.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Link to={`/session/${session.id}`} className="flex-1 min-w-0 cursor-pointer group">
                            <p className="text-sm font-medium text-primary truncate group-hover:underline" title={session.userRequest}>
                              {truncateSessionName(session.userRequest, 80)}
                            </p>
                            <p className="mt-1 text-sm text-base-content/70">
                              {session.repositoryUrl || 'No repository'}
                            </p>
                          </Link>
                        </div>
                        <div className="ml-4 flex-shrink-0 flex items-center space-x-4">
                          <div className="text-right">
                            <div className="text-sm text-base-content/70">
                              Deleted {new Date(session.deletedAt!).toLocaleDateString()}
                            </div>
                            <div className="text-xs text-base-content/60">
                              {new Date(session.deletedAt!).toLocaleTimeString()}
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => restoreBulkMutation.mutate([session.id])}
                              className="btn btn-ghost btn-xs btn-circle text-success"
                              title="Restore session"
                              disabled={restoreBulkMutation.isPending}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                className="h-5 w-5"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Permanently delete this session? This cannot be undone.')) {
                                  deletePermanentBulkMutation.mutate([session.id]);
                                }
                              }}
                              className="btn btn-ghost btn-xs btn-circle text-error"
                              title="Delete permanently"
                              disabled={deletePermanentBulkMutation.isPending}
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
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Infinite scroll trigger */}
              <div ref={observerTarget} className="py-4 text-center">
                {isFetchingNextPage && (
                  <span className="loading loading-spinner loading-md text-primary"></span>
                )}
                {!hasNextPage && deletedSessions.length > 0 && (
                  <p className="text-sm text-base-content/70">No more sessions to load</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
