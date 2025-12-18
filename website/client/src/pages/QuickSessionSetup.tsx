import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { githubApi } from '@/lib/api';
import { useAuthStore, useRecentReposStore } from '@/lib/store';
import type { GitHubRepository } from '@/shared';

type ActivityType = 'code' | 'images' | 'sound' | 'scene' | 'preview';

interface ActivityInfo {
  id: ActivityType;
  title: string;
  route: string;
  icon: JSX.Element;
}

const activityInfo: Record<ActivityType, ActivityInfo> = {
  code: {
    id: 'code',
    title: 'Code',
    route: '/code',
    icon: (
      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
      </svg>
    ),
  },
  images: {
    id: 'images',
    title: 'Images and Animations',
    route: '/images',
    icon: (
      <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
      </svg>
    ),
  },
  sound: {
    id: 'sound',
    title: 'Sound and Music',
    route: '/sound',
    icon: (
      <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
      </svg>
    ),
  },
  scene: {
    id: 'scene',
    title: 'Scene and Object Editor',
    route: '/scene-editor',
    icon: (
      <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
      </svg>
    ),
  },
  preview: {
    id: 'preview',
    title: 'Preview',
    route: '/preview',
    icon: (
      <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
      </svg>
    ),
  },
};

export default function QuickSessionSetup() {
  const navigate = useNavigate();
  const { activity } = useParams<{ activity: ActivityType }>();
  const user = useAuthStore((state) => state.user);

  // Repository state
  const [selectedRepo, setSelectedRepo] = useState('');

  // Repository search state
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);

  // Keyboard navigation state
  const [repoHighlightedIndex, setRepoHighlightedIndex] = useState(-1);
  const repoListRef = useRef<HTMLDivElement>(null);

  const hasGithubAuth = !!user?.githubAccessToken;

  // Validate activity
  const currentActivity = activity && activityInfo[activity] ? activityInfo[activity] : null;

  // Load repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: hasGithubAuth,
  });

  const repositories: GitHubRepository[] = reposData?.data || [];

  // Recent repos store
  const { recentRepoUrls, addRecentRepo, removeRecentRepo } = useRecentReposStore();

  // Sort repositories alphabetically by fullName
  const sortedRepositories = [...repositories].sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  // Get recent repos that still exist in the repositories list
  const recentRepos = recentRepoUrls
    .map(url => repositories.find(r => r.cloneUrl === url))
    .filter((r): r is GitHubRepository => r !== undefined);

  // Get non-recent repos (those not in the recent list)
  const nonRecentRepos = sortedRepositories.filter(
    repo => !recentRepoUrls.includes(repo.cloneUrl)
  );

  // Filter function for repos based on fuzzy search
  const matchesSearch = (repo: GitHubRepository) => {
    if (!repoSearchQuery.trim()) return true;
    const searchTerms = repoSearchQuery.toLowerCase().trim().split(/\s+/);
    const repoName = repo.fullName.toLowerCase();
    return searchTerms.every(term => repoName.includes(term));
  };

  // Filter recent and non-recent repos separately
  const filteredRecentRepos = recentRepos.filter(matchesSearch);
  const filteredNonRecentRepos = nonRecentRepos.filter(matchesSearch);

  // Combined filtered repos for keyboard navigation (recent first, then non-recent)
  const filteredRepositories = [...filteredRecentRepos, ...filteredNonRecentRepos];

  // Load last selected repo from localStorage when repositories are loaded
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

  // Save selected repo to localStorage whenever it changes
  useEffect(() => {
    if (hasLoadedFromStorage) {
      if (selectedRepo) {
        localStorage.setItem('lastSelectedRepo', selectedRepo);
      } else {
        localStorage.removeItem('lastSelectedRepo');
      }
    }
  }, [selectedRepo, hasLoadedFromStorage]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (isRepoDropdownOpen && !target.closest('.repo-dropdown')) {
        setIsRepoDropdownOpen(false);
        setRepoSearchQuery('');
        setRepoHighlightedIndex(-1);
      }
    };

    if (isRepoDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isRepoDropdownOpen]);

  // Reset highlighted index when search query or dropdown state changes
  useEffect(() => {
    setRepoHighlightedIndex(-1);
  }, [repoSearchQuery, isRepoDropdownOpen]);

  // Scroll highlighted item into view for repos
  useEffect(() => {
    if (repoHighlightedIndex >= 0 && repoListRef.current) {
      const items = repoListRef.current.querySelectorAll('[data-repo-item]');
      const item = items[repoHighlightedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [repoHighlightedIndex]);

  // Handle keyboard navigation for repo dropdown
  const handleRepoKeyDown = (e: React.KeyboardEvent) => {
    // Total items: "No repository" option + filtered repositories
    const totalItems = 1 + filteredRepositories.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      setRepoHighlightedIndex((prev) => {
        const next = prev < totalItems - 1 ? prev + 1 : 0; // wrap to beginning
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setRepoHighlightedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : totalItems - 1; // wrap to end
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      // If nothing highlighted, select first item
      const indexToSelect = repoHighlightedIndex >= 0 ? repoHighlightedIndex : 0;
      if (indexToSelect === 0) {
        // "No repository" option
        setSelectedRepo('');
      } else {
        const repo = filteredRepositories[indexToSelect - 1];
        if (repo) {
          setSelectedRepo(repo.cloneUrl);
        }
      }
      setIsRepoDropdownOpen(false);
      setRepoSearchQuery('');
      setRepoHighlightedIndex(-1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsRepoDropdownOpen(false);
      setRepoSearchQuery('');
      setRepoHighlightedIndex(-1);
    }
  };

  const handleStart = () => {
    if (!currentActivity) return;

    // Navigate to the activity page with pre-selected settings
    navigate(currentActivity.route, {
      state: {
        preSelectedSettings: {
          repositoryUrl: selectedRepo || undefined,
        }
      }
    });
  };

  if (!currentActivity) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-base-content mb-4">Invalid Activity</h1>
          <p className="text-base-content/70 mb-6">The activity you requested does not exist.</p>
          <button onClick={() => navigate('/sessions')} className="btn btn-primary">
            Go to Sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200 flex items-start justify-center px-4 pt-20">
      <div className="max-w-4xl w-full">
        <div className="bg-base-100 rounded-2xl shadow-xl p-8">
          {/* Title and Description */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4 text-primary">
              {currentActivity.icon}
            </div>
            <h1 className="text-4xl font-bold text-base-content mb-2">
              Start {currentActivity.title}
            </h1>
            <p className="text-base-content/70">Configure your workspace to begin.</p>
          </div>

          {/* Single Row: Repository and Branch */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Repository Selector */}
            <div>
              <label className="label pb-2">
                <span className="label-text font-semibold">Repository</span>
              </label>
              <div className="relative repo-dropdown">
                <button
                  type="button"
                  onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                  className="relative flex items-center justify-between w-full h-12 px-4 border border-base-300 rounded-lg hover:border-base-content/20 transition-colors disabled:opacity-50 bg-transparent text-left"
                  disabled={!hasGithubAuth || isLoadingRepos}
                >
                  <span className="truncate flex items-center gap-2">
                    {isLoadingRepos ? (
                      <>
                        <span className="loading loading-spinner loading-xs"></span>
                        Loading...
                      </>
                    ) : selectedRepo
                      ? sortedRepositories.find((r) => r.cloneUrl === selectedRepo)?.fullName || 'No repository'
                      : 'No repository'}
                  </span>
                  <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isRepoDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-full max-h-80 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                    <div className="p-2 sticky top-0 bg-base-100 border-b border-base-300">
                      <input
                        type="text"
                        placeholder="Search repositories..."
                        value={repoSearchQuery}
                        onChange={(e) => setRepoSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape' || e.key === 'Enter') {
                            e.preventDefault();
                            handleRepoKeyDown(e);
                          }
                        }}
                        className="input input-bordered input-sm w-full"
                        autoFocus
                      />
                    </div>
                    <div className="overflow-y-auto max-h-64" ref={repoListRef}>
                      {/* No repository option */}
                      <button
                        type="button"
                        data-repo-item
                        onClick={() => {
                          setSelectedRepo('');
                          setIsRepoDropdownOpen(false);
                          setRepoSearchQuery('');
                          setRepoHighlightedIndex(-1);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-primary focus:bg-primary hover:text-primary-content focus:text-primary-content focus:outline-none ${!selectedRepo ? 'bg-primary/20 font-semibold' : ''} ${repoHighlightedIndex === 0 ? 'bg-primary text-primary-content' : ''}`}
                        title="Session won't be saved to a repository"
                      >
                        <div>
                          <div>No repository</div>
                          <div className="text-xs text-base-content/50">Session only (not saved)</div>
                        </div>
                      </button>

                      {/* Recent repositories section */}
                      {filteredRecentRepos.length > 0 && (
                        <>
                          <div className="px-4 py-1 text-xs font-semibold text-base-content/50 bg-base-200 border-y border-base-300">
                            Recent
                          </div>
                          {filteredRecentRepos.map((repo, index) => (
                            <div
                              key={`recent-${repo.id}`}
                              className={`flex items-center group hover:bg-primary focus-within:bg-primary ${repoHighlightedIndex === index + 1 ? 'bg-primary' : ''} ${selectedRepo === repo.cloneUrl ? 'bg-primary/20' : ''}`}
                            >
                              <button
                                type="button"
                                data-repo-item
                                onClick={() => {
                                  setSelectedRepo(repo.cloneUrl);
                                  addRecentRepo(repo.cloneUrl);
                                  setIsRepoDropdownOpen(false);
                                  setRepoSearchQuery('');
                                  setRepoHighlightedIndex(-1);
                                }}
                                className={`flex-1 text-left px-4 py-2 text-sm focus:outline-none group-hover:text-primary-content ${repoHighlightedIndex === index + 1 ? 'text-primary-content' : ''} ${selectedRepo === repo.cloneUrl ? 'font-semibold' : ''}`}
                              >
                                {repo.fullName}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  removeRecentRepo(repo.cloneUrl);
                                }}
                                className="px-2 py-1 mr-2 text-base-content/40 hover:text-error hover:bg-error/10 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove from recent"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </>
                      )}

                      {/* All other repositories section */}
                      {filteredNonRecentRepos.length > 0 && (
                        <>
                          {filteredRecentRepos.length > 0 && (
                            <div className="px-4 py-1 text-xs font-semibold text-base-content/50 bg-base-200 border-y border-base-300">
                              All Repositories
                            </div>
                          )}
                          {filteredNonRecentRepos.map((repo, index) => {
                            // Calculate the correct highlight index accounting for "No repo" (1) + recent repos
                            const highlightIndex = 1 + filteredRecentRepos.length + index;
                            return (
                              <button
                                key={repo.id}
                                type="button"
                                data-repo-item
                                onClick={() => {
                                  setSelectedRepo(repo.cloneUrl);
                                  addRecentRepo(repo.cloneUrl);
                                  setIsRepoDropdownOpen(false);
                                  setRepoSearchQuery('');
                                  setRepoHighlightedIndex(-1);
                                }}
                                className={`w-full text-left px-4 py-2 text-sm hover:bg-primary focus:bg-primary hover:text-primary-content focus:text-primary-content focus:outline-none ${repoHighlightedIndex === highlightIndex ? 'bg-primary text-primary-content' : ''} ${selectedRepo === repo.cloneUrl ? 'bg-primary/20 font-semibold' : ''}`}
                              >
                                {repo.fullName}
                              </button>
                            );
                          })}
                        </>
                      )}

                      {/* No results message */}
                      {filteredRecentRepos.length === 0 && filteredNonRecentRepos.length === 0 && (
                        <div className="p-4 text-xs text-base-content/50 text-center">
                          No repositories found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action button */}
          <div className="flex justify-center pt-4 relative">
            <button
              onClick={handleStart}
              disabled={isLoadingRepos}
              className="btn btn-primary px-12 disabled:opacity-50"
            >
              {isLoadingRepos ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Loading...
                </>
              ) : (
                'Start Session'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
