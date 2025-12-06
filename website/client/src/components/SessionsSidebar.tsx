import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { sessionsApi, githubApi } from '@/lib/api';
import { useAuthStore, useSessionLastPageStore, useSessionsSidebarStore } from '@/lib/store';
import type { ChatSession, GitHubRepository } from '@/shared';
import { truncateSessionName } from '@/lib/utils';
import type { ImageAttachment } from './ChatInput';

// Helper to get the session URL with last visited page
function getSessionUrl(sessionId: string, getLastPage: (id: string) => string): string {
  const lastPage = getLastPage(sessionId);
  if (lastPage === 'chat') {
    return `/session/${sessionId}`;
  }
  return `/session/${sessionId}/${lastPage}`;
}

export default function SessionsSidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { sessionId: currentSessionId } = useParams();
  const user = useAuthStore((state) => state.user);
  const { getLastPage } = useSessionLastPageStore();
  const { isExpanded, toggle } = useSessionsSidebarStore();

  // Chat input state
  const [input, setInput] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [baseBranch] = useState('main');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch sessions
  const { data, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    refetchInterval: (query) => {
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

  // Sort repositories alphabetically
  const sortedRepositories = [...repositories].sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  // Filter repositories based on search
  const filteredRepositories = sortedRepositories.filter((repo) => {
    if (!repoSearchQuery.trim()) return true;
    const searchTerms = repoSearchQuery.toLowerCase().trim().split(/\s+/);
    const repoName = repo.fullName.toLowerCase();
    return searchTerms.every(term => repoName.includes(term));
  });

  // Load last selected repo from localStorage
  const [hasLoadedFromStorage, setHasLoadedFromStorage] = useState(false);
  useEffect(() => {
    if (repositories.length > 0 && !hasLoadedFromStorage) {
      const lastSelectedRepo = localStorage.getItem('lastSelectedRepo');
      if (lastSelectedRepo) {
        const repoExists = repositories.some(repo => repo.cloneUrl === lastSelectedRepo);
        if (repoExists) {
          setSelectedRepo(lastSelectedRepo);
        }
      }
      setHasLoadedFromStorage(true);
    }
  }, [repositories, hasLoadedFromStorage]);

  // Save selected repo to localStorage
  useEffect(() => {
    if (hasLoadedFromStorage) {
      if (selectedRepo) {
        localStorage.setItem('lastSelectedRepo', selectedRepo);
      } else {
        localStorage.removeItem('lastSelectedRepo');
      }
    }
  }, [selectedRepo, hasLoadedFromStorage]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => sessionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  // Handle submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if ((!input.trim() && images.length === 0) || !user?.claudeAuth) return;

    let userRequestParam: string | any[];

    if (images.length > 0) {
      const contentBlocks: any[] = [];
      if (input.trim()) {
        contentBlocks.push({ type: 'text', text: input.trim() });
      }
      images.forEach((image) => {
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data },
        });
      });
      userRequestParam = contentBlocks;
    } else {
      userRequestParam = input.trim();
    }

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

  // Handle paste for images
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const newImages: ImageAttachment[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          try {
            const base64Data = await fileToBase64(file);
            newImages.push({
              id: `${Date.now()}-${i}`,
              data: base64Data,
              mediaType: file.type,
              fileName: `pasted-image-${Date.now()}.png`,
            });
          } catch (error) {
            console.error('Failed to read pasted image:', error);
          }
        }
      }
    }

    if (newImages.length > 0) {
      setImages([...images, ...newImages]);
    }
  };

  // Helper to resize and convert file to base64
  const resizeImage = (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const maxDimension = user?.imageResizeMaxDimension || 1024;

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDimension || height > maxDimension) {
          const aspectRatio = width / height;
          if (width > height) {
            width = maxDimension;
            height = width / aspectRatio;
          } else {
            height = maxDimension;
            width = height * aspectRatio;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Failed to create blob'));
          },
          file.type || 'image/png',
          0.95
        );
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  };

  const fileToBase64 = async (file: File): Promise<string> => {
    const resizedBlob = await resizeImage(file);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(resizedBlob);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newImages: ImageAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        try {
          const base64Data = await fileToBase64(file);
          newImages.push({
            id: `${Date.now()}-${i}`,
            data: base64Data,
            mediaType: file.type,
            fileName: file.name,
          });
        } catch (error) {
          console.error('Failed to read file:', error);
        }
      }
    }

    setImages([...images, ...newImages]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Close repo dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isRepoDropdownOpen && !target.closest('.sidebar-repo-dropdown')) {
        setIsRepoDropdownOpen(false);
        setRepoSearchQuery('');
      }
    };

    if (isRepoDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isRepoDropdownOpen]);

  const hasGithubAuth = !!user?.githubAccessToken;
  const hasClaudeAuth = !!user?.claudeAuth;

  return (
    <div
      className={`flex flex-col bg-base-100 border-r border-base-300 transition-all duration-300 h-full ${
        isExpanded ? 'w-80' : 'w-12'
      }`}
    >
      {/* Header with toggle button */}
      <div className="flex items-center justify-between p-2 border-b border-base-300">
        {isExpanded && (
          <span className="font-medium text-sm text-base-content/80 px-2">My Sessions</span>
        )}
        <button
          onClick={toggle}
          className="btn btn-ghost btn-sm btn-square"
          title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {isExpanded ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>

      {isExpanded ? (
        <>
          {/* New session input */}
          <div className="p-3 border-b border-base-300">
            <form onSubmit={handleSubmit}>
              {/* Image previews */}
              {images.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {images.map((image) => (
                    <div key={image.id} className="relative group">
                      <img
                        src={`data:${image.mediaType};base64,${image.data}`}
                        alt={image.fileName}
                        className="h-10 w-10 object-cover rounded border border-base-300"
                      />
                      <button
                        type="button"
                        onClick={() => setImages(images.filter(img => img.id !== image.id))}
                        className="absolute -top-1 -right-1 bg-error text-error-content rounded-full w-4 h-4 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  placeholder="Start a new session..."
                  rows={2}
                  className="textarea textarea-bordered textarea-sm w-full resize-none pr-20"
                  disabled={!hasClaudeAuth}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      const textarea = e.currentTarget;
                      if (textarea.selectionStart === textarea.value.length) {
                        e.preventDefault();
                        handleSubmit(e);
                      }
                    }
                  }}
                />

                {/* Action buttons */}
                <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!hasClaudeAuth}
                    className="btn btn-ghost btn-xs btn-circle"
                    title="Attach image"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path fillRule="evenodd" d="M1.5 6a2.25 2.25 0 012.25-2.25h16.5A2.25 2.25 0 0122.5 6v12a2.25 2.25 0 01-2.25 2.25H3.75A2.25 2.25 0 011.5 18V6zM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0021 18v-1.94l-2.69-2.689a1.5 1.5 0 00-2.12 0l-.88.879.97.97a.75.75 0 11-1.06 1.06l-5.16-5.159a1.5 1.5 0 00-2.12 0L3 16.061zm10.125-7.81a1.125 1.125 0 112.25 0 1.125 1.125 0 01-2.25 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    type="submit"
                    disabled={!hasClaudeAuth || (!input.trim() && images.length === 0)}
                    className="btn btn-primary btn-xs btn-circle"
                    title="Create session"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Repository selector */}
              {hasGithubAuth && !isLoadingRepos && repositories.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <div className="relative sidebar-repo-dropdown flex-1">
                    <button
                      type="button"
                      onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                      className="btn btn-xs btn-ghost normal-case w-full justify-between font-normal text-base-content/70"
                    >
                      <span className="truncate text-left">
                        {selectedRepo
                          ? sortedRepositories.find((r) => r.cloneUrl === selectedRepo)?.fullName || 'Select repo'
                          : 'No repository'}
                      </span>
                      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {isRepoDropdownOpen && (
                      <div className="absolute top-full left-0 mt-1 w-full max-h-48 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                        <div className="p-1.5 sticky top-0 bg-base-100 border-b border-base-300">
                          <input
                            type="text"
                            placeholder="Search..."
                            value={repoSearchQuery}
                            onChange={(e) => setRepoSearchQuery(e.target.value)}
                            className="input input-bordered input-xs w-full"
                            autoFocus
                          />
                        </div>
                        <div className="overflow-y-auto max-h-32">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRepo('');
                              setIsRepoDropdownOpen(false);
                              setRepoSearchQuery('');
                            }}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-base-200 ${!selectedRepo ? 'bg-primary/10 font-semibold' : ''}`}
                          >
                            No repository
                          </button>
                          {filteredRepositories.map((repo) => (
                            <button
                              key={repo.id}
                              type="button"
                              onClick={() => {
                                setSelectedRepo(repo.cloneUrl);
                                setIsRepoDropdownOpen(false);
                                setRepoSearchQuery('');
                              }}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-base-200 ${selectedRepo === repo.cloneUrl ? 'bg-primary/10 font-semibold' : ''}`}
                            >
                              {repo.fullName}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Status indicators */}
              {(!hasGithubAuth || !hasClaudeAuth) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {!hasClaudeAuth && (
                    <Link to="/settings" className="badge badge-warning badge-xs gap-0.5">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Add Credentials
                    </Link>
                  )}
                  {!hasGithubAuth && (
                    <Link to="/settings" className="badge badge-warning badge-xs gap-0.5">
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                      </svg>
                      GitHub
                    </Link>
                  )}
                </div>
              )}
            </form>
          </div>

          {/* Sessions list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <span className="loading loading-spinner loading-sm text-primary"></span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 px-4">
                <svg
                  className="mx-auto h-8 w-8 text-base-content/30"
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
                <p className="mt-2 text-xs text-base-content/50">No sessions yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-base-300">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className={`group ${currentSessionId === session.id ? 'bg-primary/10' : 'hover:bg-base-200'}`}
                  >
                    <Link
                      to={getSessionUrl(session.id, getLastPage)}
                      className="block px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${currentSessionId === session.id ? 'text-primary font-medium' : 'text-base-content'}`}>
                            {truncateSessionName(session.userRequest, 40)}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {session.status === 'running' && (
                              <span className="loading loading-spinner loading-xs text-info"></span>
                            )}
                            <span
                              className={`badge badge-xs ${
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
                            <span className="text-[10px] text-base-content/50">
                              {new Date(session.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteMutation.mutate(session.id);
                          }}
                          className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete session"
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer with links */}
          <div className="border-t border-base-300 p-2">
            <div className="flex items-center justify-between">
              <Link
                to="/sessions"
                className="btn btn-ghost btn-xs text-base-content/70"
              >
                View All
              </Link>
              <Link
                to="/trash"
                className="btn btn-ghost btn-xs text-base-content/70"
                title="View deleted sessions"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                Trash
              </Link>
            </div>
          </div>
        </>
      ) : (
        /* Collapsed state - show icons only */
        <div className="flex-1 flex flex-col items-center py-2 gap-1">
          {/* New session button */}
          <button
            onClick={() => {
              toggle();
              setTimeout(() => textareaRef.current?.focus(), 100);
            }}
            className="btn btn-ghost btn-sm btn-square"
            title="New session"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>

          {/* Sessions indicator */}
          <div className="divider my-1 w-6"></div>

          {isLoading ? (
            <span className="loading loading-spinner loading-xs text-primary"></span>
          ) : (
            <button
              onClick={toggle}
              className="btn btn-ghost btn-sm btn-square relative"
              title={`${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 13h8v8H3v-8zm0-10h8v8H3V3zm10 0h8v8h-8V3zm0 10h8v8h-8v-8z"/>
              </svg>
              {sessions.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 badge badge-primary badge-xs">
                  {sessions.length > 99 ? '99+' : sessions.length}
                </span>
              )}
            </button>
          )}

          {/* Running sessions indicator */}
          {sessions.some(s => s.status === 'running') && (
            <div className="mt-1" title="Running session">
              <span className="loading loading-spinner loading-xs text-info"></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
