import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { githubApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import type { GitHubRepository } from '@webedt/shared';

export default function QuickChatSetup() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // Repository and branch state
  const [selectedRepo, setSelectedRepo] = useState('');
  const [branch, setBranch] = useState('main');

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
  const fetchBranches = async () => {
    if (!selectedRepo) return;

    const match = selectedRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!match) return;

    const [, owner, repo] = match;

    setIsLoadingBranches(true);
    try {
      const response = await githubApi.getBranches(owner, repo);
      const branchNames = response.data.map((b: any) => b.name);
      setBranches(branchNames);
      setIsBranchDropdownOpen(true);
    } catch (error) {
      console.error('Failed to fetch branches:', error);
      alert('Failed to fetch branches. Please try again.');
    } finally {
      setIsLoadingBranches(false);
    }
  };

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

  const handleStart = () => {
    // Navigate to chat page with pre-selected settings
    navigate('/session/new', {
      state: {
        preSelectedSettings: {
          repositoryUrl: selectedRepo || undefined,
          branch: branch || undefined,
          locked: true, // Lock these settings
        }
      }
    });
  };

  return (
    <div className="min-h-screen bg-base-200 flex items-start justify-center px-4 pt-20">
      <div className="max-w-4xl w-full">
        <div className="bg-base-100 rounded-2xl shadow-xl p-8">
          {/* Title and Description */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4 text-primary">
              <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
              </svg>
            </div>
            <h1 className="text-4xl font-bold text-base-content mb-2">
              Start Chat
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
                  <span className="truncate">
                    {isLoadingRepos ? 'Loading...' : selectedRepo
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
            <div>
              <label className="label pb-2">
                <span className="label-text font-semibold">Base Branch</span>
              </label>
              <div className="relative branch-dropdown">
                <button
                  type="button"
                  onClick={() => {
                    if (!isBranchDropdownOpen && selectedRepo && branches.length === 0) {
                      fetchBranches();
                    } else {
                      setIsBranchDropdownOpen(!isBranchDropdownOpen);
                    }
                  }}
                  className="relative flex items-center justify-between w-full h-12 px-4 border border-base-300 rounded-lg hover:border-base-content/20 transition-colors disabled:opacity-50 bg-transparent text-left"
                  disabled={!selectedRepo || isLoadingBranches}
                >
                  <span className="truncate">
                    {isLoadingBranches ? 'Loading...' : branch || 'main'}
                  </span>
                  {isLoadingBranches ? (
                    <span className="loading loading-spinner loading-sm ml-2 flex-shrink-0"></span>
                  ) : (
                    <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
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
                              setBranch(branchName);
                              setIsBranchDropdownOpen(false);
                              setBranchSearchQuery('');
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-base-200 ${branch === branchName ? 'bg-primary/10 font-semibold' : ''}`}
                          >
                            {branchName}
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-xs text-base-content/50 text-center">
                          {branches.length === 0 ? 'No branches loaded' : 'No branches found'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action button */}
          <div className="flex justify-center pt-4">
            <button
              onClick={handleStart}
              className="btn btn-primary px-12"
            >
              Start Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
