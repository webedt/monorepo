import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { githubApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { GitHubRepository } from '@webedt/shared';

type ActivityType = 'chat' | 'code' | 'images' | 'sound' | 'scene' | 'preview';

interface Activity {
  id: ActivityType;
  title: string;
  icon: JSX.Element;
}

const activities: Activity[] = [
  {
    id: 'chat',
    title: 'Chat',
    icon: (
      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
      </svg>
    ),
  },
  {
    id: 'code',
    title: 'Code',
    icon: (
      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
      </svg>
    ),
  },
  {
    id: 'images',
    title: 'Images and Animations',
    icon: (
      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-3.5l-3-4 4-5 3 4 2-2.5 4 5H10z"/>
      </svg>
    ),
  },
  {
    id: 'sound',
    title: 'Sound and Music',
    icon: (
      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 3v9.28c-.47-.17-.97-.28-1.5-.28C8.01 12 6 14.01 6 16.5S8.01 21 10.5 21c2.31 0 4.2-1.75 4.45-4H15V6h4V3h-7z"/>
      </svg>
    ),
  },
  {
    id: 'scene',
    title: 'Scene and Object Editor',
    icon: (
      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5zM3 21.5h8v-8H3v8zm2-6h4v4H5v-4z"/>
      </svg>
    ),
  },
  {
    id: 'preview',
    title: 'Preview',
    icon: (
      <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
      </svg>
    ),
  },
];

export default function NewSession() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // Repository and branch state
  const [selectedRepo, setSelectedRepo] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');

  // Repository search state
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [isRepoDropdownOpen, setIsRepoDropdownOpen] = useState(false);

  // Branch selector state
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [isBranchDropdownOpen, setIsBranchDropdownOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  const hasGithubAuth = !!user?.githubAccessToken;

  // Load repositories
  const { data: reposData, isLoading: isLoadingRepos } = useQuery({
    queryKey: ['repos'],
    queryFn: githubApi.getRepos,
    enabled: hasGithubAuth,
  });

  const repositories: GitHubRepository[] = reposData?.data || [];

  // Sort repositories alphabetically by fullName
  const sortedRepositories = [...repositories].sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  );

  // Filter repositories based on fuzzy search with space-separated terms
  const filteredRepositories = sortedRepositories.filter((repo) => {
    if (!repoSearchQuery.trim()) return true;

    const searchTerms = repoSearchQuery.toLowerCase().trim().split(/\s+/);
    const repoName = repo.fullName.toLowerCase();

    return searchTerms.every(term => repoName.includes(term));
  });

  // Filter branches based on fuzzy search with space-separated terms
  const filteredBranches = branches.filter((branchName) => {
    if (!branchSearchQuery.trim()) return true;

    const searchTerms = branchSearchQuery.toLowerCase().trim().split(/\s+/);
    const branchLower = branchName.toLowerCase();

    return searchTerms.every(term => branchLower.includes(term));
  });

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

  // Fetch branches for the selected repository
  const fetchBranches = async (repoCloneUrl: string) => {
    if (!repoCloneUrl) return;

    const match = repoCloneUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return;

    const [, owner, repo] = match;

    setIsLoadingBranches(true);
    try {
      const response = await githubApi.getBranches(owner, repo);
      const branchNames = response.data.map((b: any) => b.name);
      setBranches(branchNames);
    } catch (error) {
      console.error('Failed to fetch branches:', error);
      setBranches([]);
    } finally {
      setIsLoadingBranches(false);
    }
  };

  // Auto-fetch branches and set default branch when repository changes
  useEffect(() => {
    if (selectedRepo && hasLoadedFromStorage) {
      const selectedRepoData = sortedRepositories.find((r) => r.cloneUrl === selectedRepo);
      if (selectedRepoData) {
        setBaseBranch(selectedRepoData.defaultBranch || 'main');
        fetchBranches(selectedRepo);
      }
    } else if (!selectedRepo) {
      setBranches([]);
      setBaseBranch('main');
    }
  }, [selectedRepo, hasLoadedFromStorage]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (isRepoDropdownOpen && !target.closest('.repo-dropdown')) {
        setIsRepoDropdownOpen(false);
        setRepoSearchQuery('');
      }

      if (isBranchDropdownOpen && !target.closest('.branch-dropdown')) {
        setIsBranchDropdownOpen(false);
        setBranchSearchQuery('');
      }
    };

    if (isRepoDropdownOpen || isBranchDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isRepoDropdownOpen, isBranchDropdownOpen]);

  const handleActivityClick = (activityId: ActivityType) => {
    // Navigate to /session/new/{section} for all activities
    const sectionMap: Record<ActivityType, string> = {
      chat: 'chat',
      code: 'code',
      images: 'images',
      sound: 'sound',
      scene: 'scene-editor',
      preview: 'preview',
    };

    const section = sectionMap[activityId];
    const route = `/session/new/${section}`;

    // Navigate with pre-selected settings
    navigate(route, {
      state: {
        preSelectedSettings: {
          repositoryUrl: selectedRepo || undefined,
          locked: true, // Lock these settings
        }
      }
    });
  };

  return (
    <div className="min-h-screen bg-base-200 flex items-start justify-center px-4 pt-8">
      <div className="max-w-5xl w-full">
        <div className="text-center mb-4">
          <h1 className="text-3xl font-bold text-base-content mb-2">Start a New Session</h1>
          <p className="text-sm text-base-content/70">Configure your workspace and choose an activity to begin.</p>
        </div>

        <div className="bg-base-100 rounded-2xl shadow-xl p-4 mb-4">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Repository Selector */}
            <div className="flex-1">
              <label className="label py-1">
                <span className="label-text font-semibold text-sm">Repository</span>
              </label>
              <div className="relative repo-dropdown">
                <button
                  type="button"
                  onClick={() => setIsRepoDropdownOpen(!isRepoDropdownOpen)}
                  className="relative flex items-center justify-between w-full h-9 px-3 text-sm border border-base-300 rounded-lg hover:border-base-content/20 transition-colors disabled:opacity-50 bg-transparent text-left"
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
                        className="input input-bordered input-sm w-full"
                        autoFocus
                      />
                    </div>
                    <div className="overflow-y-auto max-h-64">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRepo('');
                          setIsRepoDropdownOpen(false);
                          setRepoSearchQuery('');
                        }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${!selectedRepo ? 'bg-primary/10 font-semibold' : ''}`}
                        title="Session won't be saved to a repository"
                      >
                        <div>
                          <div>No repository</div>
                          <div className="text-xs text-base-content/50">Session only (not saved)</div>
                        </div>
                      </button>
                      {filteredRepositories.length > 0 ? (
                        filteredRepositories.map((repo) => (
                          <button
                            key={repo.id}
                            type="button"
                            onClick={() => {
                              setSelectedRepo(repo.cloneUrl);
                              setIsRepoDropdownOpen(false);
                              setRepoSearchQuery('');
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${selectedRepo === repo.cloneUrl ? 'bg-primary/10 font-semibold' : ''}`}
                          >
                            {repo.fullName}
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-xs text-base-content/50 text-center">
                          No repositories found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Base Branch Selector */}
            <div className="flex-1">
              <label className="label py-1">
                <span className="label-text font-semibold text-sm">Base Branch</span>
              </label>
              <div className="relative branch-dropdown">
                <button
                  type="button"
                  onClick={() => setIsBranchDropdownOpen(!isBranchDropdownOpen)}
                  className="relative flex items-center justify-between w-full h-9 px-3 text-sm border border-base-300 rounded-lg hover:border-base-content/20 transition-colors disabled:opacity-50 bg-transparent text-left"
                  disabled={!selectedRepo || isLoadingBranches}
                >
                  <span className="truncate flex items-center gap-2">
                    {isLoadingBranches ? (
                      <>
                        <span className="loading loading-spinner loading-xs"></span>
                        Loading...
                      </>
                    ) : baseBranch || 'main'}
                  </span>
                  <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isBranchDropdownOpen && (
                  <div className="absolute top-full left-0 mt-2 w-full max-h-80 bg-base-100 rounded-lg shadow-xl border border-base-300 overflow-hidden z-50">
                    <div className="p-2 sticky top-0 bg-base-100 border-b border-base-300">
                      <input
                        type="text"
                        placeholder="Search branches..."
                        value={branchSearchQuery}
                        onChange={(e) => setBranchSearchQuery(e.target.value)}
                        className="input input-bordered input-sm w-full"
                        autoFocus
                      />
                    </div>
                    <div className="overflow-y-auto max-h-64">
                      {filteredBranches.length > 0 ? (
                        filteredBranches.map((branchName) => (
                          <button
                            key={branchName}
                            type="button"
                            onClick={() => {
                              setBaseBranch(branchName);
                              setIsBranchDropdownOpen(false);
                              setBranchSearchQuery('');
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${baseBranch === branchName ? 'bg-primary/10 font-semibold' : ''}`}
                          >
                            {branchName}
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-xs text-base-content/50 text-center flex items-center justify-center gap-2">
                          {isLoadingBranches ? (
                            <>
                              <span className="loading loading-spinner loading-xs"></span>
                              Loading branches...
                            </>
                          ) : 'No branches found'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Activity Selection */}
        <div className="bg-base-100 rounded-2xl shadow-xl p-4">
          <h2 className="text-xl font-bold text-center mb-4">What would you like to do?</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {activities.map((activity) => (
              <button
                key={activity.id}
                onClick={() => handleActivityClick(activity.id)}
                className="flex flex-col items-center justify-center p-4 bg-base-200 hover:bg-base-300 rounded-lg transition-all hover:scale-105 active:scale-95 border-2 border-transparent hover:border-primary"
              >
                <div className="text-primary mb-2">
                  {activity.icon}
                </div>
                <h3 className="text-sm font-semibold text-center">{activity.title}</h3>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
