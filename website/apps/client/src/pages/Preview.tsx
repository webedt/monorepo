import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi, githubApi } from '@/lib/api';
import SessionLayout from '@/components/SessionLayout';
import { useEmbedded } from '@/contexts/EmbeddedContext';
import type { GitHubPullRequest } from '@webedt/shared';
import { useState, useEffect, useRef, useCallback } from 'react';

const AUTO_REFRESH_INTERVAL = 5; // seconds
const MAX_AUTO_REFRESH_ATTEMPTS = 60; // stop after 60 attempts (5 minutes)

// Internal presentation component
function PreviewContent({ previewUrl }: { previewUrl: string | null }) {
  const [iframeKey, setIframeKey] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [autoRefreshAttempts, setAutoRefreshAttempts] = useState(0);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false); // Disabled by default
  const [showCopied, setShowCopied] = useState(false);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const handleRefresh = useCallback(() => {
    setIframeKey(prev => prev + 1);
  }, []);

  // Start auto-refresh countdown when there's an error
  const startAutoRefresh = useCallback(() => {
    if (autoRefreshAttempts >= MAX_AUTO_REFRESH_ATTEMPTS) {
      // Stop auto-refresh after max attempts
      setHasError(false);
      setCountdown(0);
      return;
    }

    setCountdown(AUTO_REFRESH_INTERVAL);

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Time to refresh
          if (countdownRef.current) {
            clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          setAutoRefreshAttempts(a => a + 1);
          handleRefresh();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [autoRefreshAttempts, handleRefresh]);

  // Stop auto-refresh
  const stopAutoRefresh = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setHasError(false);
    setCountdown(0);
    setAutoRefreshAttempts(0);
  }, []);

  // Listen for messages from the iframe (if same-origin or if we can inject a script)
  // For cross-origin, we detect errors via fetch probe
  useEffect(() => {
    if (!previewUrl) return;

    // Check status when URL changes or iframe refreshes
    const checkStatus = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        // Try to fetch the preview URL to check if it's available
        // Use no-cors mode to avoid CORS errors in console - we only care if the server responds
        await fetch(previewUrl, {
          method: 'HEAD',
          mode: 'no-cors',
          credentials: 'omit',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // With no-cors mode, we get an opaque response (type: 'opaque')
        // If we get here without error, the server responded - assume it's working
        stopAutoRefresh();
      } catch (error: any) {
        // Network errors mean server is down or unreachable
        if (error.name === 'AbortError' || error.message?.includes('network') || error.message?.includes('Failed to fetch')) {
          setHasError(true);
        } else {
          // Other errors - assume server is working
          stopAutoRefresh();
        }
      }
    };

    // Small delay before checking to let the iframe attempt to load
    const checkTimeout = setTimeout(checkStatus, 1000);

    return () => {
      clearTimeout(checkTimeout);
    };
  }, [previewUrl, iframeKey, stopAutoRefresh]);

  // Start countdown when error is detected and auto-refresh is enabled
  useEffect(() => {
    if (hasError && countdown === 0 && !countdownRef.current && autoRefreshEnabled) {
      startAutoRefresh();
    }
  }, [hasError, countdown, startAutoRefresh, autoRefreshEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, []);

  if (!previewUrl) {
    return (
      <div className="h-full bg-base-300 flex flex-col">
        {/* Main preview area - No preview available */}
        <div className="flex-1 relative bg-gradient-to-br from-base-200 to-base-300 flex items-center justify-center">
          {/* Placeholder content */}
          <div className="text-center space-y-6">
            {/* Large icon */}
            <div className="w-32 h-32 mx-auto rounded-full bg-base-100/10 backdrop-blur-sm border-2 border-base-content/20 flex items-center justify-center">
              <svg className="w-16 h-16 text-base-content/40" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </div>

            {/* Text */}
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold text-base-content/60">No Preview Available</h2>
              <p className="text-base-content/40">Connect a repository to see the preview</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-base-300 flex flex-col">
      {/* URL bar at the top */}
      <div className="bg-base-200 border-b border-base-300 px-4 py-2 flex items-center gap-2">
        <svg className="w-4 h-4 text-base-content/60 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
        <div className="relative flex-1 min-w-0">
          <button
            onClick={() => {
              navigator.clipboard.writeText(previewUrl);
              setShowCopied(true);
              setTimeout(() => setShowCopied(false), 1500);
            }}
            className="text-sm text-base-content/80 hover:text-primary truncate w-full hover:underline text-left cursor-pointer"
            title="Click to copy URL"
          >
            {previewUrl}
          </button>
          {showCopied && (
            <span className="absolute left-0 -bottom-6 bg-base-300 text-xs px-2 py-1 rounded shadow-lg z-10">
              Copied!
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Auto-refresh toggle */}
          <label className="flex items-center gap-1 cursor-pointer" title={autoRefreshEnabled ? "Auto-refresh enabled (click to disable)" : "Auto-refresh disabled (click to enable)"}>
            <input
              type="checkbox"
              className="toggle toggle-xs toggle-primary"
              checked={autoRefreshEnabled}
              onChange={(e) => {
                setAutoRefreshEnabled(e.target.checked);
                if (!e.target.checked) {
                  stopAutoRefresh();
                }
              }}
            />
            <span className="text-xs text-base-content/60">Auto</span>
          </label>
          {/* Countdown indicator */}
          {countdown > 0 && (
            <span
              className="text-xs text-warning font-mono min-w-[1.5rem] text-center cursor-pointer hover:text-error"
              title="Click to stop auto-refresh"
              onClick={stopAutoRefresh}
            >
              {countdown}s
            </span>
          )}
          <button
            onClick={() => {
              stopAutoRefresh();
              handleRefresh();
            }}
            className={`btn btn-ghost btn-xs gap-1 ${countdown > 0 ? 'animate-pulse' : ''}`}
            title={countdown > 0 ? `Auto-refreshing in ${countdown}s (click to refresh now)` : 'Refresh preview'}
          >
            <svg className={`w-3 h-3 ${countdown > 0 ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
        <a
          href={previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-xs gap-1 flex-shrink-0"
          title="Open in new tab"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {/* Main preview area - Full-window iframe */}
      <div className="flex-1 relative">
        <iframe
          key={iframeKey}
          src={previewUrl}
          title="Repository Preview"
          className="w-full h-full border-2 border-red-300/50"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          onError={() => {
            // Network-level error (e.g., DNS failure)
            setHasError(true);
          }}
        />
      </div>
    </div>
  );
}

interface PreviewProps {
  isEmbedded?: boolean;
}

export default function Preview({ isEmbedded: isEmbeddedProp = false }: PreviewProps) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Check if we're embedded via context (from split view) or prop
  const { isEmbedded: isEmbeddedContext } = useEmbedded();
  const isEmbedded = isEmbeddedProp || isEmbeddedContext;

  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [prLoading, setPrLoading] = useState<'create' | 'auto' | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSuccess, setPrSuccess] = useState<string | null>(null);

  // Load session details to get preview URL
  const { data: sessionData, isLoading } = useQuery({
    queryKey: ['session-details', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
  });

  const session = sessionData?.data;
  const previewUrl = (session as any)?.previewUrl || null;

  const updateMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      sessionsApi.update(id, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-details', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-for-layout', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      setEditingTitle(false);
      setEditTitle('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sessionsApi.delete(id),
    onSuccess: () => {
      navigate('/sessions');
    },
  });

  // Query to check for existing PR
  const { data: prData, refetch: refetchPr } = useQuery({
    queryKey: ['pr', session?.repositoryOwner, session?.repositoryName, session?.branch],
    queryFn: async () => {
      if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch) {
        return null;
      }
      const response = await githubApi.getPulls(
        session.repositoryOwner,
        session.repositoryName,
        session.branch,
        session.baseBranch || undefined
      );
      return response.data as GitHubPullRequest[];
    },
    enabled: !!session?.repositoryOwner && !!session?.repositoryName && !!session?.branch,
    refetchOnWindowFocus: false,
  });

  const existingPr = prData?.find((pr: GitHubPullRequest) => pr.state === 'open');
  const mergedPr = prData?.find((pr: GitHubPullRequest) => pr.merged === true);

  const handleCreatePR = async () => {
    if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch || !session?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('create');
    setPrError(null);
    setPrSuccess(null);

    try {
      // First, generate PR content (title and description)
      const prContent = await githubApi.generatePRContent(
        session.repositoryOwner,
        session.repositoryName,
        {
          head: session.branch,
          base: session.baseBranch,
          userRequest: session.userRequest,
        }
      );

      // Then create the PR with the generated content
      const response = await githubApi.createPull(
        session.repositoryOwner,
        session.repositoryName,
        {
          title: prContent.data.title,
          head: session.branch,
          base: session.baseBranch,
          body: prContent.data.body,
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
    if (!session?.repositoryOwner || !session?.repositoryName || !session?.branch || !session?.baseBranch) {
      setPrError('Missing repository information');
      return;
    }

    setPrLoading('auto');
    setPrError(null);
    setPrSuccess(null);

    try {
      // First, generate PR content (title and description)
      const prContent = await githubApi.generatePRContent(
        session.repositoryOwner,
        session.repositoryName,
        {
          head: session.branch,
          base: session.baseBranch,
          userRequest: session.userRequest,
        }
      );

      // Then run auto PR with the generated content
      const response = await githubApi.autoPR(
        session.repositoryOwner,
        session.repositoryName,
        session.branch,
        {
          base: session.baseBranch,
          title: prContent.data.title,
          body: prContent.data.body,
          sessionId: sessionId && sessionId !== 'new' ? sessionId : undefined,
        }
      );
      setPrSuccess(`Auto PR completed! PR #${response.data.pr?.number} merged successfully.`);
      refetchPr();

      // If session was soft-deleted, redirect to sessions list after a short delay
      if (sessionId && sessionId !== 'new') {
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to complete Auto PR';
      if (errorMsg.includes('conflict')) {
        setPrError('Merge conflict detected. Please resolve conflicts manually.');
      } else {
        setPrError(errorMsg);
      }
      refetchPr();
    } finally {
      setPrLoading(null);
    }
  };

  const handleEditTitle = () => {
    if (session) {
      setEditTitle(session.userRequest);
      setEditingTitle(true);
    }
  };

  const handleSaveTitle = () => {
    if (sessionId && sessionId !== 'new' && editTitle.trim()) {
      updateMutation.mutate({ id: sessionId, title: editTitle.trim() });
    }
  };

  const handleCancelEdit = () => {
    setEditingTitle(false);
    setEditTitle('');
  };

  const handleDeleteSession = () => {
    if (sessionId && sessionId !== 'new') {
      deleteMutation.mutate(sessionId);
    }
  };

  // Create title actions (Edit and Delete buttons) for the title line
  const titleActions = session && (
    <>
      <button
        onClick={handleEditTitle}
        className="btn btn-ghost btn-xs btn-circle"
        title="Edit session title"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      </button>
      <button
        onClick={handleDeleteSession}
        className="btn btn-ghost btn-xs btn-circle text-error"
        title="Delete session"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
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
    </>
  );

  // Create PR actions for the branch line
  const prActions = session && session.branch && session.baseBranch && session.repositoryOwner && session.repositoryName && (
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

      {/* Auto PR button - hide when PR already merged */}
      {!existingPr && !mergedPr && (
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

  // Wrap content conditionally - when embedded, skip SessionLayout wrapper
  const Wrapper = isEmbedded ?
    ({ children }: { children: React.ReactNode }) => <div className="h-full flex flex-col overflow-hidden bg-base-200">{children}</div> :
    ({ children }: { children: React.ReactNode }) => (
      <SessionLayout
        titleActions={titleActions}
        prActions={prActions}
        session={session}
      >
        {children}
      </SessionLayout>
    );

  return (
    <Wrapper>
      {isLoading ? (
        <div className="h-full bg-base-300 flex items-center justify-center">
          <div className="text-center space-y-4">
            <span className="loading loading-spinner loading-lg text-primary"></span>
            <p className="text-base-content/60">Loading preview...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Alerts Area */}
          {session && (
            <div className="bg-base-100 border-b border-base-300 p-4 flex-shrink-0">
              <div className="max-w-7xl mx-auto space-y-2">
                {/* Title editing mode */}
                {editingTitle && (
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="flex-1 input input-bordered input-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTitle();
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                    />
                    <button
                      onClick={handleSaveTitle}
                      className="btn btn-success btn-sm"
                      disabled={updateMutation.isPending}
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="btn btn-ghost btn-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* PR Status Messages */}
                {prSuccess && (
                  <div className="alert alert-success">
                    <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="text-sm">{prSuccess}</span>
                    <button onClick={() => setPrSuccess(null)} className="btn btn-ghost btn-xs">Dismiss</button>
                  </div>
                )}

                {prError && (
                  <div className="alert alert-error">
                    <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="text-sm">{prError}</span>
                    <button onClick={() => setPrError(null)} className="btn btn-ghost btn-xs">Dismiss</button>
                  </div>
                )}
              </div>
            </div>
          )}

          <PreviewContent previewUrl={previewUrl} />
        </>
      )}
    </Wrapper>
  );
}

// Exported for split view - session-aware preview pane
interface PreviewPaneProps {
  sessionId?: string;
}

export function PreviewPane({ sessionId: sessionIdProp }: PreviewPaneProps = {}) {
  const { sessionId: sessionIdParam } = useParams<{ sessionId?: string }>();
  const sessionId = sessionIdProp ?? sessionIdParam;

  // Load session details to get preview URL
  const { data: sessionData, isLoading } = useQuery({
    queryKey: ['session-details', sessionId],
    queryFn: () => {
      if (!sessionId || sessionId === 'new') {
        throw new Error('Invalid session ID');
      }
      return sessionsApi.get(sessionId);
    },
    enabled: !!sessionId && sessionId !== 'new',
  });

  const session = sessionData?.data;
  const previewUrl = (session as any)?.previewUrl || null;

  if (isLoading) {
    return (
      <div className="h-full bg-base-300 flex items-center justify-center">
        <div className="text-center space-y-4">
          <span className="loading loading-spinner loading-lg text-primary"></span>
          <p className="text-base-content/60">Loading preview...</p>
        </div>
      </div>
    );
  }

  return <PreviewContent previewUrl={previewUrl} />;
}
